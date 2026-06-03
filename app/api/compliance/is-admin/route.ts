import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ isAdmin: false });

  // COMPLIANCE_ADMIN_EMAILS accepts either email addresses or usernames
  // (comma-separated). Matching on both covers stub auth mode (where email
  // is always demo@demo.local) and real auth mode.
  const adminList = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

  const isAdmin =
    adminList.includes(session.email?.toLowerCase()    ?? '__none__') ||
    adminList.includes(session.username?.toLowerCase() ?? '__none__') ||
    adminList.includes(session.userId?.toLowerCase()   ?? '__none__');

  return NextResponse.json({ isAdmin, debug: { email: session.email, username: session.username } });
}
