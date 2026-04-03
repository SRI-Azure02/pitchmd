import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const date = searchParams.get('date');
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  const iso = /^\d{4}-\d{2}-\d{2}$/;

  try {
    const sf = getSnowflakeClient();

    // Range mode — returns dates with activity for calendar highlighting
    if (from && to) {
      if (!iso.test(from) || !iso.test(to)) {
        return NextResponse.json({ error: 'Invalid from/to (expected YYYY-MM-DD)' }, { status: 400 });
      }
      const dates = await sf.queryActivityDates(from, to);
      return NextResponse.json({ dates });
    }

    // Single-date mode — returns physicians with activity on that date
    if (!date || !iso.test(date)) {
      return NextResponse.json({ error: 'Missing or invalid date (expected YYYY-MM-DD)' }, { status: 400 });
    }
    const rows = await sf.queryActivityByDate(date, session.userId);
    return NextResponse.json({ physicians: rows });
  } catch (err: any) {
    console.error('[call-journal/activity] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
