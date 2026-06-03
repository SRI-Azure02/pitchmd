import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

function isComplianceAdmin(email: string | undefined): boolean {
  const adminEmails = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return adminEmails.includes(email?.toLowerCase() ?? '');
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isComplianceAdmin(session.email))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  try {
    const sf = getSnowflakeClient();
    const { sessions, total } = await sf.getComplianceSessions(pageSize, offset);
    return NextResponse.json({ sessions, total, page, pageSize });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load sessions' }, { status: 500 });
  }
}
