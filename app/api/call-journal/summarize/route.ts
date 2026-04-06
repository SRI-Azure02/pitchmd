import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';
import { validateInput, SummarizeInputSchema } from '@/lib/validate';
import { checkRateLimit, rateLimitResponse, AI_LIGHT_LIMIT } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: 60 summaries per minute per user
  const rl = checkRateLimit(`summarize:${session.userId}`, AI_LIGHT_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs) as unknown as NextResponse;

  const rawBody = await request.json();
  const { data, errorResponse } = validateInput(SummarizeInputSchema, rawBody);
  if (errorResponse) return errorResponse;
  const { transcript } = data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: `Summarize the following pharmaceutical sales call note in one concise sentence. Focus on the key outcome and any follow-up action:\n\n${transcript}`,
      }],
    });
    const summary = (msg.content[0] as any)?.text?.trim() ?? '';
    return NextResponse.json({ summary });
  } catch (err: any) {
    console.error('[call-journal/summarize] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
