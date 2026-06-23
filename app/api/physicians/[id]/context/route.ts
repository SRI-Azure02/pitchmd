import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: physicianId } = await params;
    if (!physicianId) return NextResponse.json({ error: 'physicianId is required' }, { status: 400 });

    const sf     = getSnowflakeClient();
    const userId = session.userId;

    const [callNoteRows, taskRows, activityRows] = await Promise.all([
      sf.getRecentCallNotesByPhysician(userId, physicianId, 3),
      sf.getOpenTasksByPhysician(userId, physicianId),
      sf.executeQuery(`
        SELECT PROMOTION_CHANNEL, MESSAGE_DELIVERED, TRANSACTION_DATE
        FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_ACTIVITY
        WHERE PHYSICIAN_ID = :1
          AND TRANSACTION_DATE >= DATEADD(day, -90, CURRENT_DATE())
        ORDER BY TRANSACTION_DATE DESC
        LIMIT 5
      `, { '1': { type: 'TEXT', value: physicianId } }),
    ]);

    return NextResponse.json({
      callNotes:      callNoteRows,
      openTasks:      taskRows,
      recentActivity: activityRows,
    });
  } catch (err: any) {
    console.error('[physician-context]', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 });
  }
}
