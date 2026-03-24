import { NextRequest, NextResponse } from 'next/server';
import { getSnowflakeClient } from '@/lib/snowflake';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const appUserId = session.userId;

  try {
    const client = getSnowflakeClient();

    const evaluation =
      await client.queryLatestEvaluationByAppUser(appUserId);

    if (!evaluation) {
      return NextResponse.json(
        { error: 'No evaluation found for this user' },
        { status: 404 }
      );
    }

    const physicianId = evaluation.PHYSICIAN_ID;
    const segmentName = evaluation.SEGMENT_NAME;

    const physicianName =
      evaluation.PHYSICIAN_FIRST_NAME &&
      evaluation.PHYSICIAN_LAST_NAME
        ? `${evaluation.PHYSICIAN_FIRST_NAME} ${evaluation.PHYSICIAN_LAST_NAME}`
        : physicianId;

    const [
      historyWithPhysician,
      historyAllPhysicians,
      segmentMedian,
    ] = await Promise.all([
      physicianId
        ? client.queryEvaluationHistory(appUserId, physicianId)
        : Promise.resolve([]),

      client.queryEvaluationHistoryAllPhysicians(appUserId),

      segmentName
        ? client.querySegmentMedianScoresForUser(
            appUserId,
            segmentName
          )
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      evaluation,
      physicianName,
      historyWithPhysician,
      historyAllPhysicians,
      segmentMedian,
    });
  } catch (error: any) {
    console.error(
      '[evaluation] error:',
      error?.response?.data || error?.message
    );

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch evaluation' },
      { status: 500 }
    );
  }
}
