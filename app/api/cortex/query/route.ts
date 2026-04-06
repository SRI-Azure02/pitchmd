import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

const FLUSH_PAD = ' '.repeat(1024);

// Matches ANY [EMOTION:xxx] tag the agent may emit — not just the whitelisted
// set — so unrecognised emotions still route correctly to the roleplay path.
const EMOTION_TAG_REGEX = /\[EMOTION:[^\]]+\]/i;

const SESSION_DURATION_REGEX = /\[SESSION_DURATION:(\d+)\]/;
const VOICE_MODEL_REGEX = /\[VOICE_MODEL:([^\]]+)\]/;
const PHYSICIAN_ID_REGEX = /PHYSICIAN_ID:\s*([A-Z0-9]+)/;

const EVAL_KEYWORDS = [
  'OVERALL_SCORE', 'CLINICAL_KNOWLEDGE_SCORE', 'OBJECTION_HANDLING_SCORE',
  'FIELD_READINESS', 'COACHING_PRIORITY', 'RepEval', 'REPEVAL',
  'overall_score', 'field_ready',
];

/**
 * Extract physician list / selection text (no agent planning)
 */
function extractSelectionContent(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return (
        t.startsWith('|') ||                // markdown table rows
        t.startsWith('Welcome') ||
        t.startsWith('Select') ||
        t.startsWith('Type') ||
        t.startsWith('Just type')
        // Note: numbered lists deliberately excluded — agent planning steps
        // like "1. First, fetch the physician list..." also match \d+\. and
        // should NOT be shown to the user.
      );
    })
    .join('\n')
    .trim();
}

// Patterns that identify agent planning/thinking text rather than physician dialogue.
// These appear in the Cortex Agent's internal reasoning steps before it generates
// the actual physician response.
const PLANNING_PATTERNS: Array<string | RegExp> = [
  // Physician metadata fields (structured data from agent's context retrieval)
  'PHYSICIAN_ID:', 'VOICE_MODEL:', 'SEGMENT_NAME:',
  'ATTITUDINAL_DESCRIPTION:', 'ATTITUDINAL_TYPE:', 'SPECIALTY:',
  // Agent meta-language (self-narration of what it's about to do)
  'I need to respond', 'respond to that in character', 'in character',
  'The rep has already', 'the rep has already',
  'respond in character',
  'I have the physician profile',
  'physician profile',
  'risk-averse',         // catches "given she's risk-averse", "based on risk-averse", etc.
  'risk averse',
  'my response should',
  'I will respond',
  'as the physician',
  'the sales rep',
  'I already gave',      // "I already gave a first in-character message"
  'continue in character',
  'given she',           // "given she's risk-averse and conservative"
  'given his',
  'given their',
  'Now I need to',       // "Now I need to continue in character"
  'fetching the data',
  // Parenthetical reasoning notes the agent sometimes prefixes
  /^\[EMOTION:[^\]]+\]\s*\(/,   // starts with emotion tag + "("
  /^\[EMOTION:[^\]]+\]\s*-/,    // starts with emotion tag + "- " (dash-prefixed planning note)
  /^\[EMOTION:[^\]]+\]\s*Wait/, // starts with emotion tag + "Wait"
];

function isAgentPlanningBlock(block: string): boolean {
  return PLANNING_PATTERNS.some((p) =>
    typeof p === 'string' ? block.includes(p) : p.test(block),
  );
}

/**
 * Find the character index in `text` where genuine physician roleplay dialogue
 * starts — i.e., the first [EMOTION:] tag that is NOT a planning block.
 *
 * Requires MIN_LOOKAHEAD chars of body content after the tag before making a
 * decision: this prevents false-positive classification when planning keywords
 * (e.g. "risk-averse", "in character") appear a few tokens after the tag.
 *
 * Returns -1 if no qualifying block has been found yet (need more tokens).
 */
const ROLEPLAY_LOOKAHEAD = 150; // chars of body required before classifying

function findRoleplayStart(text: string): number {
  const re = /\[EMOTION:[^\]]+\]/gi;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const bodyStart = start + match[0].length;

    // Not enough content after tag yet — wait for more tokens
    if (text.length - bodyStart < ROLEPLAY_LOOKAHEAD) continue;

    // Check the full block (up to 500 chars) for planning patterns
    const block = text.slice(start, Math.min(start + 500, text.length));
    if (!isAgentPlanningBlock(block)) {
      return start;
    }
    // This was a planning block — keep scanning for the next EMOTION tag
  }
  return -1;
}

/**
 * Find the first [EMOTION:] block that is genuine physician dialogue
 * (i.e. does not contain internal planning metadata).
 * Returns null when every block is planning text — caller should suppress.
 */
function extractRoleplay(text: string): string | null {
  const re = /\[EMOTION:[^\]]+\]/gi;
  const matches = [...text.matchAll(re)];

  if (matches.length === 0) {
    const trimmed = text.trim();
    return trimmed || null;
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const block = text.slice(start, end).trim();

    if (!isAgentPlanningBlock(block)) {
      // Ignore trivially short fragments (e.g. "[EMOTION:neutral] or")
      const bodyOnly = block.replace(/\[EMOTION:[^\]]+\]/gi, '').trim();
      if (bodyOnly.length < 15) continue;
      return block;
    }
  }

  // All blocks were planning text — suppress
  console.log('[cortex] suppressing pure planning response');
  return null;
}

/**
 * Keep physician responses short (rep-first pacing).
 * Merges fragments after title abbreviations (Dr., Mr., Mrs., Ms., Prof.)
 * so "I'm Dr." + "Smith." stays as one sentence rather than being cut.
 *
 * FIX 2: Authoritative truncation for the committed message text sent in the
 * `done` event (used for TTS and final chat history).  The client independently
 * truncates the live streaming bubble for visual feedback only — that content is
 * discarded when the `done` event fires and replaced by this server-truncated
 * text.  The two truncation sites operate on separate code paths and do NOT
 * double-truncate the same content.
 */
function shortenRoleplay(text: string): string {
  const emotion = text.match(EMOTION_TAG_REGEX)?.[0] ?? '[EMOTION:neutral]';
  const body = text.replace(EMOTION_TAG_REGEX, '').trim();

  // Split naïvely on sentence-ending punctuation + whitespace
  const rawParts = body.split(/(?<=[.!?])\s+/).filter(Boolean);

  // Re-merge fragments that follow a title abbreviation
  const TITLE_ABBREV = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc)\s*\.$/i;
  const sentences: string[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (TITLE_ABBREV.test(part) && i + 1 < rawParts.length) {
      // Glue this fragment to the next part and let the loop re-evaluate
      rawParts[i + 1] = `${part} ${rawParts[i + 1]}`;
    } else {
      sentences.push(part);
    }
  }

  const kept = sentences.length > 2 ? sentences.slice(0, 2) : sentences;
  return `${emotion} ${kept.join(' ')}`.trim();
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const send = (data: object) =>
    encoder.encode(JSON.stringify(data) + FLUSH_PAD + '\n');

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (payload: object) => {
        if (closed) return;
        controller.enqueue(send(payload));
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      try {
        const session = await getSessionFromRequest(request);
        if (!session) {
          safeEnqueue({ type: 'error', message: 'Unauthorized' });
          safeClose();
          return;
        }

        const { messages } = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
        };

        // Emit immediately so Next.js flushes HTTP headers to the client
        // before the (potentially slow) Snowflake call begins.
        safeEnqueue({ type: 'status', message: 'Connecting...' });

        const account = process.env.SNOWFLAKE_ACCOUNT!;
        const pat =
          process.env.SNOWFLAKE_PAT ||
          process.env.SNOWFLAKE_PASSWORD!;

        const agentUrl = `https://${account}.snowflakecomputing.com/api/v2/databases/CORTEX_TESTING/schemas/PUBLIC/agents/PITCHMD:run`;

        const formattedMessages = messages.map((m) => ({
          role: m.role,
          content: [{ type: 'text', text: m.content }],
        }));

        // When the user says "done" / "end" the agent must:
        //   1. Generate closing physician line   (~5s)
        //   2. Call REPEVAL → runs EVALUATE_SALES_REP (Claude 3.5 Sonnet)  (~60–90s)
        //   3. Call REPEVAL_LOOKUP               (~5s)
        //   4. Stream results back               (~5s)
        // Total can easily exceed 120s. Give evaluation turns 5 minutes.
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        const isEndTurn = ['done', 'end', 'finish', 'bye', 'have a good day'].some(
          (kw) => lastUserMsg?.content.trim().toLowerCase().includes(kw),
        );
        const timeoutMs = isEndTurn ? 300_000 : 120_000;

        const res = await fetch(agentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pat}`,
            Accept: 'text/event-stream',
            'X-Snowflake-Authorization-Token-Type':
              'PROGRAMMATIC_ACCESS_TOKEN',
          },
          body: JSON.stringify({
            messages: formattedMessages,
            stream: true,
            role: 'APP_SVC_ROLE',
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error(`[cortex] Snowflake returned ${res.status}:`, errText.slice(0, 300));
          safeEnqueue({ type: 'error', message: `Snowflake error ${res.status}` });
          safeClose();
          return;
        }

        if (!res.body) {
          safeEnqueue({ type: 'error', message: 'Empty response from Snowflake' });
          safeClose();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        let sseBuffer = '';
        let fullText = '';

        // FIX 1: Incremental streaming state
        // Once we identify the start of genuine roleplay dialogue we switch to
        // streaming mode and forward every subsequent token to the client as a
        // `chunk` event.  This eliminates the full-LLM-generation wait before
        // the user sees the first word of the physician's response.
        let streamingMode = false;
        let streamingStartIdx = -1; // char index in fullText where roleplay starts
        let evalDetected = false;   // once true, streaming is suppressed (eval path)

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;

            try {
              const parsed = JSON.parse(payload);
              if (typeof parsed.text !== 'string') continue;

              const token = parsed.text;
              fullText += token;

              // Check for eval keywords as tokens arrive — if detected,
              // disable streaming mode (eval responses are never streamed).
              if (!evalDetected) {
                evalDetected = EVAL_KEYWORDS.some((kw) => fullText.includes(kw));
                if (evalDetected && streamingMode) {
                  streamingMode = false; // abort any accidental streaming
                }
              }

              if (evalDetected) continue; // buffer-only path for eval responses

              if (streamingMode) {
                // FIX 1: Forward every new token directly to the browser
                safeEnqueue({ type: 'chunk', text: token });
              } else {
                // Pre-streaming: check whether we can now identify the roleplay start
                const startIdx = findRoleplayStart(fullText);
                if (startIdx !== -1) {
                  streamingMode = true;
                  streamingStartIdx = startIdx;
                  // Flush everything accumulated so far from the roleplay start
                  safeEnqueue({ type: 'chunk', text: fullText.slice(startIdx) });
                  console.log('[cortex] streaming started at char', startIdx);
                }
              }
            } catch { /* malformed SSE token — skip */ }
          }
        }

        // ── Post-stream processing (same as before) ────────────────────────────

        // Log raw agent output
        const isEvalLog = EVAL_KEYWORDS.some((kw) => fullText.includes(kw));
        if (isEvalLog) {
          console.log('[cortex] EVALUATION fullText (full):\n', fullText);
        } else {
          console.log('[cortex] raw fullText (first 800 chars):', fullText.slice(0, 800));
        }

        // Extract metadata from full accumulated text BEFORE any stripping
        const sessionDurationMatch = fullText.match(SESSION_DURATION_REGEX);
        const sessionDuration = sessionDurationMatch
          ? Number(sessionDurationMatch[1])
          : null;

        const voiceModelMatch = fullText.match(VOICE_MODEL_REGEX);
        const voiceModel = voiceModelMatch ? voiceModelMatch[1].trim() : null;

        const physicianIdMatch = fullText.match(PHYSICIAN_ID_REGEX);
        const physicianId = physicianIdMatch ? physicianIdMatch[1].trim() : null;

        const isEvaluation = EVAL_KEYWORDS.some((kw) => fullText.includes(kw));

        // Build display text
        let output: string;
        let suppressed = false;

        if (isEvaluation) {
          output = 'Your evaluation is ready.';
        } else if (EMOTION_TAG_REGEX.test(fullText)) {
          const roleplayText = extractRoleplay(fullText);
          if (roleplayText === null) {
            suppressed = true;
            output = '';
          } else {
            output = roleplayText;
            if (!EMOTION_TAG_REGEX.test(output)) {
              output = `[EMOTION:neutral] ${output}`;
            }
            // FIX 2: shortenRoleplay still runs for TTS / fallback, but the
            // client renders from streamed chunks (already truncated to 2
            // sentences client-side) so this only matters for non-streamed paths.
            output = shortenRoleplay(output);
          }
        } else {
          output = extractSelectionContent(fullText);
        }

        // Emit done with metadata.
        // wasStreamed=true tells the client it already has the display text from
        // chunk events and should use its accumulated streamingContent rather
        // than event.text (which is still included for TTS / planning fallback).
        safeEnqueue({
          type: 'done',
          text: output,
          sessionDuration,
          voiceModel,
          physicianId,
          isEvaluation,
          suppressed,
          wasStreamed: streamingMode, // FIX 1: client uses this to decide rendering
        });
        safeClose();
      } catch (err: any) {
        console.error('[cortex] error:', err?.message);
        safeEnqueue({ type: 'error', message: 'Failed to reach Cortex Agent' });
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
