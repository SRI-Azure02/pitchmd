import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { getSnowflakeClient } from '@/lib/snowflake';
import {
  checkOutput,
  buildBalanceInjection,
  type ComplianceRule,
  type ComplianceViolation,
} from '@/lib/compliance-filter';

const FLUSH_PAD = ' '.repeat(1024);

// ── Module-level compliance rules cache ──────────────────────────────────────
// Serverless functions are warm for ~5 min; this avoids a Snowflake round-trip
// on every single message while still picking up rule changes within ~5 min.
let _rulesCache: ComplianceRule[] | null = null;
let _rulesCacheTime = 0;
const RULES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getComplianceRules(): Promise<ComplianceRule[]> {
  const now = Date.now();
  if (_rulesCache && now - _rulesCacheTime < RULES_CACHE_TTL_MS) {
    return _rulesCache;
  }
  try {
    const sf = getSnowflakeClient();
    const rows = await sf.getActiveComplianceRules();
    _rulesCache = rows as ComplianceRule[];
    _rulesCacheTime = now;
    console.log(`[compliance] rules loaded: ${_rulesCache.length}`);
    return _rulesCache;
  } catch (err: any) {
    console.error('[compliance] failed to load rules — fail open:', err?.message);
    return _rulesCache ?? []; // serve stale cache or empty (fail open)
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  physician: any,
  username: string,
  mindsetDescription?: string | null,
): string {
  const name        = `Dr. ${physician.FIRST_NAME} ${physician.LAST_NAME}`;
  const specialty   = physician.SPECIALTY ?? 'General Practice';
  const state       = physician.STATE     ?? '';
  const segment     = physician.SEGMENT_NAME           ?? 'Standard';
  const attitudinal = physician.ATTITUDINAL_DESCRIPTION ?? 'Professional and evidence-focused';

  const mindsetSection = mindsetDescription
    ? `\n${mindsetDescription}\n\nIMPORTANT: The HCP MINDSET above is your PRIMARY behavioral directive. It overrides any generic instructions. Every response MUST authentically reflect the mindset traits listed above. Do not blend in generic "balanced" physician behavior — commit fully to the mindset.`
    : '';

  return `You are roleplaying as ${name}, a ${specialty} physician${state ? ` based in ${state}` : ''}.

PHYSICIAN PROFILE:
- Name: ${name}
- Specialty: ${specialty}
- Patient Segment: ${segment}
- Attitudinal Profile: ${attitudinal}
${mindsetSection}
SCENARIO:
${username} is a pharmaceutical sales representative visiting you for a brief office call. You have up to two minutes for this visit. Engage with them realistically and consistently based on your profile above.

GLOBAL FORMAT GUARANTEE (NON-NEGOTIABLE):
Every response you speak AS THE PHYSICIAN must begin with exactly ONE emotion tag:
[EMOTION:neutral]
[EMOTION:curious]
[EMOTION:skeptical]
[EMOTION:frustrated]
[EMOTION:dismissive]
[EMOTION:impressed]
[EMOTION:urgent]

RULES:
- The emotion tag MUST be the very first token in every message — no exceptions.
- Never explain the emotion tag to the user.
- Stay in character as the physician at all times.
- Keep responses concise — 1 to 2 sentences maximum.
- React authentically based on your profile${mindsetDescription ? ' and the HCP mindset directives' : ''}.
- Do not hallucinate clinical data, drug efficacy figures, or study results.
- If the rep makes a strong clinical point, show genuine engagement.
- Push back, ask probing questions, or express enthusiasm depending on the rep's quality.
- When the user says "done", "end", or "goodbye", give a brief natural closing line.`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const send = (data: object) =>
    encoder.encode(JSON.stringify(data) + FLUSH_PAD + '\n');

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (payload: object) => {
        if (!closed) controller.enqueue(send(payload));
      };
      const safeClose = () => {
        if (!closed) { closed = true; controller.close(); }
      };

      try {
        const session = await getSessionFromRequest(request);
        if (!session) {
          safeEnqueue({ type: 'error', message: 'Unauthorized' });
          safeClose();
          return;
        }

        const { messages, physician, username, mindsetDescription, sessionId } = (await request.json()) as {
          messages: Array<{ role: string; content: string; internal?: boolean }>;
          physician: any;
          username: string;
          mindsetDescription?: string;
          sessionId?: string;
        };

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          console.error('[roleplay] ANTHROPIC_API_KEY not set');
          safeEnqueue({ type: 'error', message: 'Anthropic API key not configured' });
          safeClose();
          return;
        }

        const anthropic = new Anthropic({ apiKey });
        const sf = getSnowflakeClient();
        const systemPrompt = buildSystemPrompt(physician, username, mindsetDescription);

        // ── Compliance logging: rep turn (fire-and-forget) ────────────────────
        const repText = messages.filter(m => !m.internal).slice(-1)[0]?.content ?? '';
        if (sessionId && repText) {
          sf.logComplianceTurn({
            sessionId,
            appUserId: session.userId,
            physicianId: physician.PHYSICIAN_ID ?? null,
            turnIndex: messages.length - 1,
            speaker: 'rep',
            rawText: repText,
            overallStatus: 'clean',
          }).catch(err => console.error('[compliance] rep log error:', err?.message));
        }

        // Map to Anthropic format.
        const anthropicMessages = messages
          .filter((m) => m.content?.trim())
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.internal
              ? '(Begin the roleplay session by greeting the rep. Mention that you have up to two minutes for this visit.)'
              : m.content,
          }));

        safeEnqueue({ type: 'status', message: 'Connecting...' });

        // ── Primary Claude call (streaming for UX) ────────────────────────────
        const claudeStream = anthropic.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          system: systemPrompt,
          messages: anthropicMessages,
        });

        let fullText = '';
        claudeStream.on('text', (token: string) => {
          fullText += token;
          safeEnqueue({ type: 'chunk', text: token });
        });
        await claudeStream.finalMessage();

        // Guarantee emotion tag is present
        let output = fullText.trim();
        if (!/^\[EMOTION:/i.test(output)) output = `[EMOTION:neutral] ${output}`;

        // ── Phase 2: Output Compliance Filter ────────────────────────────────
        // Runs after streaming completes. The `done` event (sent below) carries
        // the FINAL canonical text — if the filter rewrites or blocks, the
        // client sees the corrected version even though chunks may have streamed.
        let complianceStatus: string = 'clean';
        let complianceFlags: ComplianceViolation[] = [];

        try {
          const rules = await getComplianceRules();

          if (rules.length > 0) {
            const filterResult = checkOutput(output, rules);
            complianceFlags = filterResult.violations;

            if (filterResult.status === 'blocked' && filterResult.primaryViolation) {
              // ── BLOCK: substitute redirect message ─────────────────────────
              const redirect = filterResult.primaryViolation.redirect_message!;
              output = `/^\[EMOTION:/i.test(redirect)` ? redirect : `[EMOTION:neutral] ${redirect}`;
              if (!/^\[EMOTION:/i.test(output)) output = `[EMOTION:neutral] ${redirect}`;
              complianceStatus = 'blocked';
              console.log(`[compliance] BLOCKED by ${filterResult.primaryViolation.rule_code}`);

            } else if (filterResult.status === 'rewrite_needed') {
              // ── REWRITE: re-generate with balance injection (up to 2 attempts)
              const balanceInjection = buildBalanceInjection(filterResult.violations);
              const rewriteSystemPrompt = systemPrompt + balanceInjection;
              let rewriteSucceeded = false;

              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  const regenMsg = await anthropic.messages.create({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 250,
                    system: rewriteSystemPrompt,
                    messages: anthropicMessages,
                  });
                  const regenText = ((regenMsg.content[0] as any)?.text ?? '').trim();
                  const regenOutput = /^\[EMOTION:/i.test(regenText)
                    ? regenText
                    : `[EMOTION:neutral] ${regenText}`;

                  // Verify re-generation passes the filter
                  const recheck = checkOutput(regenOutput, rules);
                  if (recheck.status === 'clean' || recheck.status === 'flagged') {
                    output = regenOutput;
                    complianceStatus = 'flagged'; // was non-compliant, now corrected
                    rewriteSucceeded = true;
                    console.log(`[compliance] rewrite succeeded (attempt ${attempt + 1}) — ${filterResult.violations.map(v => v.rule_code).join(', ')}`);
                    break;
                  }
                } catch (regenErr: any) {
                  console.error(`[compliance] rewrite attempt ${attempt + 1} failed:`, regenErr?.message);
                }
              }

              if (!rewriteSucceeded) {
                // Fallback: use safe fallback message from first violation
                const fallback = filterResult.primaryViolation?.fallback
                  ?? "I would recommend reviewing the full VENCLEXTA Prescribing Information for the complete benefit-risk profile.";
                output = `[EMOTION:neutral] ${fallback}`;
                complianceStatus = 'flagged';
                console.log(`[compliance] rewrite fallback used — ${filterResult.violations.map(v => v.rule_code).join(', ')}`);
              }

            } else if (filterResult.status === 'flagged') {
              complianceStatus = 'flagged';
              console.log(`[compliance] flagged (warning) — ${filterResult.violations.map(v => v.rule_code).join(', ')}`);
            }
          }
        } catch (filterErr: any) {
          // Filter errors must never break the session — fail open
          console.error('[compliance] filter error (fail open):', filterErr?.message);
        }

        console.log('[roleplay] done, first 200:', output.slice(0, 200));

        // ── Send final output ─────────────────────────────────────────────────
        // The `done` text is what the client renders as the final message,
        // overwriting the streamed chunks — so the corrected version always wins.
        safeEnqueue({
          type: 'done',
          text: output,
          sessionDuration: null,
          voiceModel: physician.VOICE_MODEL ?? null,
          physicianId: physician.PHYSICIAN_ID ?? null,
          isEvaluation: false,
          suppressed: false,
          wasStreamed: true,
        });

        // ── Compliance logging: persona turn (fire-and-forget) ───────────────
        if (sessionId && output) {
          sf.logComplianceTurn({
            sessionId,
            appUserId: session.userId,
            physicianId: physician.PHYSICIAN_ID ?? null,
            turnIndex: messages.length,
            speaker: 'persona',
            rawText: output,
            overallStatus: complianceStatus as 'clean' | 'flagged' | 'blocked',
            complianceFlags: complianceFlags.map(v => ({
              rule_code: v.rule_code,
              rule_type: v.rule_type,
              action:    v.action,
            })),
          }).catch(err => console.error('[compliance] persona log error:', err?.message));
        }

        safeClose();

      } catch (err: any) {
        const detail = err?.status ? `HTTP ${err.status}: ${err?.message}` : (err?.message ?? String(err));
        console.error('[roleplay] error:', detail);
        safeEnqueue({ type: 'error', message: `Claude API error: ${detail}` });
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
