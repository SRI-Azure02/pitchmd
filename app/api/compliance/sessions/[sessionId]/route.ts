import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

function isComplianceAdmin(session: { email?: string; username?: string; userId?: string }): boolean {
  const adminList = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return adminList.includes(session.email?.toLowerCase()    ?? '__none__') ||
         adminList.includes(session.username?.toLowerCase() ?? '__none__') ||
         adminList.includes(session.userId?.toLowerCase()   ?? '__none__');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isComplianceAdmin(session))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sf = getSnowflakeClient();
    const turns = await sf.getComplianceSessionTurns(sessionId);
    return NextResponse.json({ turns });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load session' }, { status: 500 });
  }
}
