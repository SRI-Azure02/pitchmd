import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';
import { validateInput, EvalSubmitInputSchema } from '@/lib/validate';
import { checkRateLimit, rateLimitResponse, AI_HEAVY_LIMIT } from '@/lib/rate-limit';


export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 20 evaluations per minute per user
  const rl = checkRateLimit(`eval:${session.userId}`, AI_HEAVY_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs) as unknown as NextResponse;

  const rawBody = await request.json();
  const { data, errorResponse } = validateInput(EvalSubmitInputSchema, rawBody);
  if (errorResponse) return errorResponse;
  const { physicianId, transcript } = data;

  const client = getSnowflakeClient();
  console.log(`[repeval] START — physician=${physicianId}, user=${session.username}, transcriptLen=${transcript.length}`);

  try {
    // Await REPEVAL directly — the HTTP connection stays open until
    // the stored proc finishes (60–240 s typical). The client shows a
    // "generating" message and awaits this response; no DB polling needed.
    await client.callRepEval(physicianId, transcript, session.username);
    console.log(`[repeval] COMPLETE — physician=${physicianId}, user=${session.username}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || 'REPEVAL failed';
    console.error(`[repeval] ERROR — physician=${physicianId}:`, msg, err?.response?.data || '');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
