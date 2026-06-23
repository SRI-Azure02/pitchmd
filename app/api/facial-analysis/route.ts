import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import Anthropic from '@anthropic-ai/sdk';

export interface FacialAnalysisResult {
  confidence: number;    // 0–10
  nervousness: number;   // 0–10
  engagement: number;    // 0–10
  summary: string;
  observations: string[];
  frameCount: number;
}

const MAX_FRAMES = 8;

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });

  let body: { frames: string[] };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

  const { frames } = body;
  if (!Array.isArray(frames) || frames.length === 0) {
    return NextResponse.json({ error: 'No frames provided' }, { status: 400 });
  }

  // Cap to MAX_FRAMES, evenly sampled if more were sent
  const sampled = frames.length <= MAX_FRAMES
    ? frames
    : Array.from({ length: MAX_FRAMES }, (_, i) =>
        frames[Math.round(i * (frames.length - 1) / (MAX_FRAMES - 1))]
      );

  const anthropic = new Anthropic({ apiKey });

  // Build multi-image message — all frames in one call for temporal context
  const imageBlocks: Anthropic.ImageBlockParam[] = sampled.map((b64, i) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
  }));

  const frameLabels = sampled
    .map((_, i) => `Frame ${i + 1}`)
    .join(', ');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `These are ${sampled.length} still frames (${frameLabels}) captured at regular intervals during a pharmaceutical sales training session. The person on camera is a sales representative practising a physician detailing call.

Analyse their facial expressions across all frames and return ONLY valid JSON in this exact shape — no prose, no markdown fences:

{
  "confidence": <integer 0-10>,
  "nervousness": <integer 0-10>,
  "engagement": <integer 0-10>,
  "summary": "<2-3 sentence coaching narrative>",
  "observations": ["<observation 1>", "<observation 2>", "<observation 3>"]
}

Scoring guide:
- confidence: 10 = strong eye contact, upright posture, composed expression; 0 = averted gaze, slumped, visibly uncertain
- nervousness: 10 = frequent tension, furrowed brow, lip compression, rapid micro-expressions; 0 = fully relaxed throughout
- engagement: 10 = animated, attentive, expressive reactions to conversation; 0 = flat affect, distracted, disengaged

The summary should be constructive coaching feedback (2–3 sentences). The observations array must contain exactly 3 short, specific, actionable bullet points.

If image quality is too poor to assess, return all scores as 5 and note the limitation in the summary.`,
            },
          ],
        },
      ],
    });

    const raw = ((response.content[0] as any)?.text ?? '').trim();

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: any;
    try { parsed = JSON.parse(cleaned); }
    catch {
      console.error('[facial-analysis] JSON parse failed:', raw.slice(0, 200));
      return NextResponse.json({ error: 'Model returned unparseable response' }, { status: 500 });
    }

    const result: FacialAnalysisResult = {
      confidence:   Math.min(10, Math.max(0, Math.round(Number(parsed.confidence  ?? 5)))),
      nervousness:  Math.min(10, Math.max(0, Math.round(Number(parsed.nervousness ?? 5)))),
      engagement:   Math.min(10, Math.max(0, Math.round(Number(parsed.engagement  ?? 5)))),
      summary:      typeof parsed.summary === 'string' ? parsed.summary : '',
      observations: Array.isArray(parsed.observations) ? parsed.observations.slice(0, 3).map(String) : [],
      frameCount:   sampled.length,
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[facial-analysis] Claude error:', err?.message);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
