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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session.email, session.username, session.userId))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sf = getSnowflakeClient();
    await sf.deleteDocument(docId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Delete failed' }, { status: 500 });
  }
}
