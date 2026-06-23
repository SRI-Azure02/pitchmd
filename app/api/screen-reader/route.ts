import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
  }

  let body: { image: string; mediaType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { image, mediaType = 'image/jpeg' } = body;
  if (!image) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }

  // Validate media type
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const safeMediaType = allowed.includes(mediaType) ? mediaType : 'image/jpeg';

  const anthropic = new Anthropic({ apiKey });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: safeMediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: image,
              },
            },
            {
              type: 'text',
              text: `You are helping a pharmaceutical sales representative share on-screen content with a physician during a detailing visit simulation.

Analyze this screenshot and extract all relevant content. Focus on:
- Drug names, brand names, generic names
- Clinical data, efficacy/safety figures, study results
- Slide titles, key messages, bullet points
- Charts, graphs, tables — describe their key data points
- Any text visible on screen

Return a concise but complete summary of the screen content that a physician could react to. Keep it under 300 words. Do not describe the interface chrome (browser tabs, OS elements) — focus only on the clinical/sales content being presented.

If no relevant clinical or sales content is visible, say: "No clinical content detected on screen."`,
            },
          ],
        },
      ],
    });

    const content = (response.content[0] as { type: string; text: string }).text ?? '';
    return NextResponse.json({ content });
  } catch (err: any) {
    console.error('[screen-reader] Claude error:', err?.message);
    return NextResponse.json({ error: 'Failed to read screen content' }, { status: 500 });
  }
}
