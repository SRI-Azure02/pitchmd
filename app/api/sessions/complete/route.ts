import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId, physicianId } = await request.json() as {
    sessionId?: string;
    physicianId?: string;
  };

  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  try {
    const sf = getSnowflakeClient();
    await sf.logTrainingCompletion({
      sessionId,
      appUserId:     session.userId,
      physicianId:   physicianId ?? null,
      acknowledgedBy: session.email ?? session.username,
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to log completion' }, { status: 500 });
  }
}
