import { NextRequest, NextResponse } from 'next/server';
import { getSnowflakeClient } from '@/lib/snowflake';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appUserId = session.userId;

  try {
    const client = getSnowflakeClient();

    const [summary, trend] = await Promise.all([
      client.queryOverallPerformance(appUserId),
      client.queryPerformanceTrend(appUserId),
    ]);

    if (!summary) {
      return NextResponse.json(
        { error: 'No evaluation data found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ summary, trend });
  } catch (error: any) {
    console.error('[performance] error:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch performance data' },
      { status: 500 }
    );
  }
}
