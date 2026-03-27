import { NextRequest, NextResponse } from 'next/server';
import { getSnowflakeClient } from '@/lib/snowflake';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appUserId = session.userId;
  const physicianId = request.nextUrl.searchParams.get('physicianId');

  if (!physicianId) {
    return NextResponse.json(
      { error: 'physicianId query parameter is required' },
      { status: 400 }
    );
  }

  try {
    const client = getSnowflakeClient();

    // Aggregated result: median scores, mode field readiness,
    // majority boolean indicators — scoped to this user + physician.
    const evaluation = await client.queryAggregatedEvaluationByPhysician(
      appUserId,
      physicianId
    );

    if (!evaluation) {
      return NextResponse.json(
        { error: 'No evaluation found for this user and physician' },
        { status: 404 }
      );
    }

    const physicianName =
      evaluation.PHYSICIAN_FIRST_NAME && evaluation.PHYSICIAN_LAST_NAME
        ? `${evaluation.PHYSICIAN_FIRST_NAME} ${evaluation.PHYSICIAN_LAST_NAME}`
        : physicianId;

    // Individual session scores for the trend line chart
    const historyWithPhysician = await client.queryEvaluationHistory(
      appUserId,
      physicianId
    );

    return NextResponse.json({
      evaluation,
      physicianName,
      historyWithPhysician,
      sessionCount: evaluation.SESSION_COUNT ?? 1,
    });
  } catch (error: any) {
    console.error('[evaluation] error:', error?.response?.data || error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch evaluation' },
      { status: 500 }
    );
  }
}
