import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

function isComplianceAdmin(email: string | undefined): boolean {
  const adminEmails = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return adminEmails.includes(email?.toLowerCase() ?? '');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isComplianceAdmin(session.email))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sf = getSnowflakeClient();
    await sf.markSessionReviewed(params.sessionId, session.email ?? session.username);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to mark reviewed' }, { status: 500 });
  }
}
