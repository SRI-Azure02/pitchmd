import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Missing or invalid date (expected YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    const sf = getSnowflakeClient();
    const rows = await sf.queryActivityByDate(date, session.userId);
    return NextResponse.json({ physicians: rows });
  } catch (err: any) {
    console.error('[call-journal/activity] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
