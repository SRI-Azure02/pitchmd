import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

function isAdmin(email?: string, username?: string, userId?: string): boolean {
  const adminList = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return adminList.includes(email?.toLowerCase() ?? '__none__')
      || adminList.includes(username?.toLowerCase() ?? '__none__')
      || adminList.includes(userId?.toLowerCase() ?? '__none__');
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session.email, session.username, session.userId))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sf = getSnowflakeClient();
    const docs = await sf.getComplianceDocuments();
    return NextResponse.json({ documents: docs });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load documents' }, { status: 500 });
  }
}
