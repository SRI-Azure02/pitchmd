import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { transcript } = await request.json() as { transcript: string };
  if (!transcript?.trim()) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

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
