import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { SnowflakeClient } from '@/lib/snowflake';

// Allow up to 6 minutes — REPEVAL does Cortex LLM inference and can take 2–4 min.
export const maxDuration = 360;

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { physicianId, transcript } = await request.json();

  if (!physicianId || !transcript) {
    return NextResponse.json(
      { error: 'Missing required fields: physicianId, transcript' },
      { status: 400 },
    );
  }

  const client = new SnowflakeClient();
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
