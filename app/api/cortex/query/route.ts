import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

const FLUSH_PAD = ' '.repeat(1024);

const EMOTION_TAG_REGEX =
  /\[EMOTION:(neutral|curious|skeptical|frustrated|dismissive|impressed|urgent)\]/i;

const SESSION_DURATION_REGEX = /\[SESSION_DURATION:(\d+)\]/;
const VOICE_MODEL_REGEX = /\[VOICE_MODEL:([^\]]+)\]/;

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
        t.startsWith('|') ||                // markdown table
        /^\d+\.\s/.test(t) ||               // numbered list
        t.startsWith('Welcome') ||
        t.startsWith('Select') ||
        t.startsWith('Type') ||
        t.startsWith('Just type')
      );
    })
    .join('\n')
    .trim();
}

/**
 * Extract roleplay starting at first EMOTION tag
 */
function extractRoleplay(text: string): string {
  const match = text.match(EMOTION_TAG_REGEX);
  if (!match || match.index === undefined) return text.trim();
  return text.slice(match.index).trim();
}

/**
 * Keep physician responses short (rep-first pacing)
 */
function shortenRoleplay(text: string): string {
  const emotion = text.match(EMOTION_TAG_REGEX)?.[0] ?? '[EMOTION:neutral]';
  const body = text.replace(EMOTION_TAG_REGEX, '').trim();

  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
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
          signal: AbortSignal.timeout(120_000), // 2-minute hard timeout
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

        let buffer = '';
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;

            try {
              const parsed = JSON.parse(payload);
              if (typeof parsed.text === 'string') {
                fullText += parsed.text;
              }
            } catch {}
          }
        }

        // ── Extract metadata from full accumulated text BEFORE any stripping ──
        // extractRoleplay() slices from [EMOTION:] onwards, which discards
        // [SESSION_DURATION:] and [VOICE_MODEL:] that appear before it.
        // We must capture these values from fullText now and pass them
        // explicitly in the done event so the client can act on them.
        const sessionDurationMatch = fullText.match(SESSION_DURATION_REGEX);
        const sessionDuration = sessionDurationMatch
          ? Number(sessionDurationMatch[1])
          : null;

        const voiceModelMatch = fullText.match(VOICE_MODEL_REGEX);
        const voiceModel = voiceModelMatch ? voiceModelMatch[1].trim() : null;

        // ── Detect evaluation response BEFORE stripping ───────────────────────
        // Keyword-matching on the stripped output would miss all eval fields
        // because extractSelectionContent / shortenRoleplay discard them.
        const isEvaluation = EVAL_KEYWORDS.some((kw) => fullText.includes(kw));

        // ── Build display text ────────────────────────────────────────────────
        let output: string;
        if (isEvaluation) {
          // EvaluationPanel fetches fresh data from Snowflake; the text value
          // is only shown as a chat bubble, so keep it short.
          output = 'Your evaluation is ready.';
        } else if (EMOTION_TAG_REGEX.test(fullText)) {
          output = extractRoleplay(fullText);
          if (!EMOTION_TAG_REGEX.test(output)) {
            output = `[EMOTION:neutral] ${output}`;
          }
          output = shortenRoleplay(output);
        } else {
          output = extractSelectionContent(fullText);
        }

        // ── Emit done with metadata attached ─────────────────────────────────
        // sessionDuration and voiceModel are null for non-roleplay responses
        // (physician list), so the client can safely gate on their presence.
        safeEnqueue({
          type: 'done',
          text: output,
          sessionDuration,   // number | null — drives countdown timer
          voiceModel,        // string | null — drives ElevenLabs voice ID
          isEvaluation,      // boolean — detected before stripping
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