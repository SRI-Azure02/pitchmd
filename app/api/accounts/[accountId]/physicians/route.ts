import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountId } = await params;
  const repId: string =
    (session as any).userId ?? (session as any).username ?? (session as any).email ?? 'unknown';

  try {
    const sf = getSnowflakeClient();

    const rows = await sf.executeQuery(`
      SELECT
        pc.PHYSICIAN_ID         AS "physicianId",
        pc.PHYSICIAN_FIRST_NAME AS "firstName",
        pc.PHYSICIAN_LAST_NAME  AS "lastName",
        pc.PHYSICIAN_SPECIALTY  AS "specialty",
        pc.PHYSICIAN_CITY       AS "city",
        pc.PHYSICIAN_STATE      AS "state",
        ps.SEGMENT_NAME         AS "segment",
        ev.FIELD_READINESS      AS "fieldReadiness",
        ev.OVERALL_SCORE        AS "overallScore"
      FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_AFFILIATIONS a
      JOIN CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS pc
        ON a.PHYSICIAN_ID = pc.PHYSICIAN_ID
      LEFT JOIN CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_SEGMENT ps
        ON pc.PHYSICIAN_ID = ps.PHYSICIAN_ID
      LEFT JOIN CORTEX_TESTING.ML.REPEVAL_RESULTS ev
        ON pc.PHYSICIAN_ID = ev.PHYSICIAN_ID
        AND ev.APP_USER_ID = :2
      WHERE a.ACCOUNT_ID = :1
      ORDER BY pc.PHYSICIAN_LAST_NAME, pc.PHYSICIAN_FIRST_NAME
    `, {
      '1': { type: 'TEXT', value: accountId },
      '2': { type: 'TEXT', value: repId },
    });

    return NextResponse.json({ physicians: rows });
  } catch (err: any) {
    console.error('[/api/accounts/[accountId]/physicians]', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}
