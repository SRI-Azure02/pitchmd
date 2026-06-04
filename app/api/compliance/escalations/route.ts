import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

function isAdmin(email?: string, username?: string, userId?: string): boolean {
  const list = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email?.toLowerCase() ?? '__none__')
      || list.includes(username?.toLowerCase() ?? '__none__')
      || list.includes(userId?.toLowerCase() ?? '__none__');
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session.email, session.username, session.userId))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const sf = getSnowflakeClient();
    const alerts = await sf.getEscalationAlerts();
    return NextResponse.json({ alerts });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load escalations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session.email, session.username, session.userId))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { patternId } = await request.json() as { patternId: string };
  if (!patternId) return NextResponse.json({ error: 'patternId required' }, { status: 400 });
  try {
    const sf = getSnowflakeClient();
    await sf.acknowledgeEscalation(patternId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to acknowledge' }, { status: 500 });
  }
}
