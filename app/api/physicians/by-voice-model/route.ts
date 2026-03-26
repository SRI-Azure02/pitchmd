import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { SnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const voiceModel = request.nextUrl.searchParams.get('model');
  if (!voiceModel) {
    return NextResponse.json({ error: 'Missing model param' }, { status: 400 });
  }

  try {
    const client = new SnowflakeClient();
    const physicianId = await client.getPhysicianByVoiceModel(voiceModel);
    return NextResponse.json({ physicianId });
  } catch (err: any) {
    console.error('[physicians/by-voice-model] error:', err?.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
