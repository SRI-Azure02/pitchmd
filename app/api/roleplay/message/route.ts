import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

const FLUSH_PAD = ' '.repeat(1024);

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

  // Mindset section overrides or supplements the attitudinal profile.
  // When present it takes precedence — the mindset is more granular and
  // specific than the attitudinal description.
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

        const { messages, physician, username, mindsetDescription } = (await request.json()) as {
          messages: Array<{ role: string; content: string; internal?: boolean }>;
          physician: any;
          username: string;
          mindsetDescription?: string;
        };

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          console.error('[roleplay] ANTHROPIC_API_KEY not set');
          safeEnqueue({ type: 'error', message: 'Anthropic API key not configured' });
          safeClose();
          return;
        }

        const anthropic = new Anthropic({ apiKey });
        const systemPrompt = buildSystemPrompt(physician, username, mindsetDescription);

        // Map to Anthropic format.
        // Internal messages (the silent "begin roleplay" trigger) are replaced
        // with a neutral seed phrase so Claude knows to open as the physician.
        const anthropicMessages = messages
          .filter((m) => m.content?.trim())
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.internal ? '(Begin the roleplay session by greeting the rep. Mention that you have up to two minutes for this visit.)' : m.content,
          }));

        safeEnqueue({ type: 'status', message: 'Connecting...' });

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
        if (!/^\[EMOTION:/i.test(output)) {
          output = `[EMOTION:neutral] ${output}`;
        }

        console.log('[roleplay] done, first 200:', output.slice(0, 200));

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
