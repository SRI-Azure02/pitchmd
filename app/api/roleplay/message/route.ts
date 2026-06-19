import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { getSnowflakeClient } from '@/lib/snowflake';
import {
  checkInput,
  checkOutput,
  buildBalanceInjection,
  type ComplianceRule,
  type ComplianceViolation,
} from '@/lib/compliance-filter';
import { retrieveRelevantChunks, buildRagSystemBlock } from '@/lib/rag-retrieval';

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
  const segment     = physician.SEGMENT_NAME            ?? 'Standard';
  const attitudinal = physician.ATTITUDINAL_DESCRIPTION ?? 'Professional and evidence-focused';

  const mindsetSection = mindsetDescription
    ? `\n${mindsetDescription}\n\nIMPORTANT: The HCP MINDSET above is your PRIMARY behavioral directive. It overrides any generic instructions. Every response MUST authentically reflect the mindset traits listed above. Do not blend in generic "balanced" physician behavior — commit fully to the mindset.`
    : '';

  // Call history — last 3 AI summaries from SYNTHETIC_CALL_JOURNAL
  const callNotes: any[] = physician.CALL_NOTES ?? [];
  const callHistorySection = callNotes.length > 0
    ? `\nPAST INTERACTIONS WITH THIS REP (most recent first — use to inform your attitude and recall commitments):\n` +
      callNotes.map((n: any) => `- ${n.CALL_DATE ?? 'Unknown date'}: ${n.AI_SUMMARY ?? '(no summary)'}`).join('\n')
    : '';

  // Open loopback tasks — commitments the rep made to this physician
  const openTasks: any[] = physician.OPEN_TASKS ?? [];
  const tasksSection = openTasks.length > 0
    ? `\nOPEN COMMITMENTS THE REP MADE TO YOU (they promised these — you can ask about them):\n` +
      openTasks.map((t: any) => `- ${t.TASK_TEXT}`).join('\n')
    : '';

  // Recent promotional activity
  const recentActivity: any[] = physician.RECENT_ACTIVITY ?? [];
  const activitySection = recentActivity.length > 0
    ? `\nRECENT PROMOTIONAL TOUCHPOINTS (for context — you may remember or be indifferent):\n` +
      recentActivity.map((a: any) => `- ${a.TRANSACTION_DATE} via ${a.PROMOTION_CHANNEL}: "${a.MESSAGE_DELIVERED}"`).join('\n')
    : '';

  return `You are roleplaying as ${name}, a ${specialty} physician${state ? ` based in ${state}` : ''}.

PHYSICIAN PROFILE:
- Name: ${name}
- Specialty: ${specialty}
- Patient Segment: ${segment}
- Attitudinal Profile: ${attitudinal}
${mindsetSection}${callHistorySection}${tasksSection}${activitySection}
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

        const { messages, physician, username, mindsetDescription, sessionId, screenContent, screenContentIsNew } = (await request.json()) as {
          messages: Array<{ role: string; content: string; internal?: boolean }>;
          physician: any;
          username: string;
          mindsetDescription?: string;
          sessionId?: string;
          screenContent?: string;
          screenContentIsNew?: boolean;
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
        const baseSystemPrompt = buildSystemPrompt(physician, username, mindsetDescription);

        // ── Phase 3: Input Firewall ────────────────────────────────────────────
        // Check the rep's message BEFORE calling Claude.
        // A blocked input never reaches the model — the redirect is returned
        // immediately and logged as 'blocked'.
        const repText = messages.filter(m => !m.internal).slice(-1)[0]?.content ?? '';
        let repTurnLogged = false; // guard against double-logging
        // Captured here so Phase 4 can gate RAG on compliance status.
        // 'clean' = no violations → physician converses naturally, no PI injection.
        // 'flagged' = soft violation → inject PI so physician can challenge the claim.
        // 'blocked' messages never reach Phase 4 (we return early below).
        // repComplianceStatus drives Phase 4 RAG gating. 'rewrite_needed' is an
        // output-filter concept but checkInput can technically return it — treat it
        // as 'flagged' so RAG still fires and the physician can challenge the claim.
        let repComplianceStatus: 'clean' | 'flagged' | 'blocked' = 'clean';

        try {
          const rules = await getComplianceRules();
          if (rules.length > 0 && repText) {
            const inputCheck = checkInput(repText, rules);
            // 'rewrite_needed' is an output-filter concept; treat it as 'flagged'
            // so Phase 4 RAG fires and the physician can challenge the claim.
            repComplianceStatus = inputCheck.status === 'rewrite_needed' ? 'flagged' : inputCheck.status;

            if (inputCheck.status === 'blocked' && inputCheck.primaryViolation) {
              const v = inputCheck.primaryViolation;
              console.log(`[compliance:input] BLOCKED by ${v.rule_code}`);

              // Phase 6: escalation pattern upsert
              sf.upsertCompliancePattern(session.userId, v.rule_code)
                .catch(e => console.error('[escalation] upsert error:', e?.message));

              if (sessionId) {
                repTurnLogged = true;
                sf.logComplianceTurn({
                  sessionId,
                  appUserId: session.userId,
                  physicianId: physician.PHYSICIAN_ID ?? null,
                  turnIndex: messages.length - 1,
                  speaker: 'rep',
                  rawText: repText,
                  overallStatus: 'blocked',
                  complianceFlags: [{ rule_code: v.rule_code, rule_type: v.rule_type, action: 'blocked' }],
                }).catch(e => console.error('[compliance] rep block log error:', e?.message));
              }

              safeEnqueue({
                type: 'input_blocked',
                rule_code: v.rule_code,
                rule_type: v.rule_type,
                message: v.redirect_message,
              });
              safeClose();
              return;
            }

            if (inputCheck.status === 'flagged') {
              // Notify the client so a visible amber warning appears in the chat
              // alongside the physician's response. The rep must see training feedback
              // even for non-blocking violations.
              const primaryFlag = inputCheck.primaryViolation;
              safeEnqueue({
                type: 'rep_flagged',
                rule_code:  primaryFlag?.rule_code  ?? 'UNKNOWN',
                rule_type:  primaryFlag?.rule_type  ?? 'unknown',
                rule_name:  primaryFlag?.rule_name  ?? 'Compliance notice',
                message:    primaryFlag?.redirect_message
                  ?? 'Your message contained content that may be outside approved promotional guidelines. The physician has been prompted to address this.',
              });

              if (sessionId) {
                repTurnLogged = true;
                sf.logComplianceTurn({
                  sessionId,
                  appUserId: session.userId,
                  physicianId: physician.PHYSICIAN_ID ?? null,
                  turnIndex: messages.length - 1,
                  speaker: 'rep',
                  rawText: repText,
                  overallStatus: 'flagged',
                  complianceFlags: inputCheck.violations.map(v2 => ({
                    rule_code: v2.rule_code, rule_type: v2.rule_type, action: v2.action,
                  })),
                }).catch(e => console.error('[compliance] rep flag log error:', e?.message));
              }
            }
          }
        } catch (inputFilterErr: any) {
          console.error('[compliance:input] filter error (fail open):', inputFilterErr?.message);
        }

        // Log clean rep turn only if not already logged above
        if (sessionId && repText && !repTurnLogged) {
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

        // ── Phase 4: RAG context retrieval ───────────────────────────────────
        // PI context is injected ONLY when the rep's turn was compliance-flagged.
        // For clean turns the physician converses naturally as a real HCP would —
        // no PI reference unless the rep has said something non-compliant.
        // This also skips the opening turn (repText empty = __begin_roleplay__).
        let ragSystemBlock = '';
        if (repText && repComplianceStatus === 'flagged') {
          try {
            const ragChunks = await retrieveRelevantChunks(repText, sf);
            ragSystemBlock = buildRagSystemBlock(ragChunks);
            if (ragChunks.length > 0) {
              console.log(`[rag] ${ragChunks.length} chunks retrieved for flagged turn (top similarity: ${ragChunks[0]?.similarity?.toFixed(3) ?? 'n/a'})`);
            }
          } catch (ragErr: any) {
            console.error('[rag] retrieval error (fail open):', ragErr?.message);
          }
        }

        // Screen content block — injected every turn once the rep shares their screen.
        // First send: physician is prompted to acknowledge and react.
        // Subsequent turns: content stays available as background reference.
        const screenContentBlock = screenContent
          ? screenContentIsNew
            ? `\n\nSHARED SCREEN CONTENT (NEW):\nThe pharmaceutical representative has just shared their screen with you. Here is what it shows:\n---\n${screenContent}\n---\nIn your NEXT response, acknowledge what the rep has shared and react authentically — show interest, skepticism, ask a question about the data, or raise a clinical concern. Do not ignore this content.`
            : `\n\nSHARED SCREEN CONTENT (SESSION REFERENCE):\nThe representative shared the following content earlier in this visit. It remains available as context — reference it naturally if it becomes relevant to the conversation, but do not re-acknowledge it as new.\n---\n${screenContent}\n---`
          : '';

        // Final system prompt = base + RAG context + screen context (if present)
        const systemPrompt = [baseSystemPrompt, ragSystemBlock, screenContentBlock].filter(Boolean).join('');

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
        let complianceStatus: 'clean' | 'flagged' | 'blocked' = 'clean';
        let complianceFlags: ComplianceViolation[] = [];

        try {
          const rules = await getComplianceRules();

          if (rules.length > 0) {
            const filterResult = checkOutput(output, rules);
            complianceFlags = filterResult.violations;

            if (filterResult.status === 'blocked' && filterResult.primaryViolation) {
              // Training tool: do NOT replace the physician persona's response with
              // a canned safety redirect.  Blocking breaks the training scenario by
              // substituting a compliance-speak message (often containing all-caps
              // brand names like "VENCLEXTA") instead of authentic physician dialogue.
              // Log the flag for monitoring but let the physician respond naturally.
              complianceStatus = 'flagged';
              console.log(`[compliance] BLOCK suppressed (physician persona) — rule: ${filterResult.primaryViolation.rule_code} — flagging only`);
              sf.upsertCompliancePattern(session.userId, filterResult.primaryViolation.rule_code)
                .catch(e => console.error('[escalation] upsert error:', e?.message));

            } else if (filterResult.status === 'rewrite_needed') {
              // ── REWRITE: re-generate with balance injection (up to 2 attempts)
              //
              // Fair-balance obligations apply to PROMOTIONAL content from the rep,
              // not to natural physician dialogue. Only enforce a balance rewrite
              // when the rep's preceding turn was itself non-compliant (flagged or
              // blocked). If the rep said something clean, the physician mentioning
              // the drug name is normal conversation — log it but don't substitute text.
              if (repComplianceStatus === 'clean') {
                // Fair-balance obligations apply to the rep's promotional content,
                // not to natural physician dialogue. If the rep's turn was clean,
                // suppress the rewrite and log for monitoring only.
                complianceStatus = 'flagged';
                console.log(`[compliance] rewrite_needed suppressed — rep turn was clean (${filterResult.violations.map(v => v.rule_code).join(', ')})`);
              } else {
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
          // 120 s = the "up to two minutes" scenario window.  Must be non-null so
          // that the client's roleplayingRef gate opens regardless of whether the
          // physician has a VOICE_MODEL in the DB.  Without a non-null value here
          // *and* a null VOICE_MODEL, roleplayingRef.current never becomes true,
          // which silences the avatar and keeps the mic permanently disabled.
          sessionDuration: 120,
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
            overallStatus: complianceStatus,
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
