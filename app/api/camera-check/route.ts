import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ faceDetected: false });

  let body: { frame: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const { frame } = body;
  if (!frame) return NextResponse.json({ faceDetected: false });

  const anthropic = new Anthropic({ apiKey });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } },
          { type: 'text', text: 'Does this image contain a human face? Reply with only "yes" or "no".' },
        ],
      }],
    });
    const answer = ((response.content[0] as any)?.text ?? '').toLowerCase().trim();
    return NextResponse.json({ faceDetected: answer.startsWith('yes') });
  } catch {
    return NextResponse.json({ faceDetected: false });
  }
}
