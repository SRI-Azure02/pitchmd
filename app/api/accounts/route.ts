import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sf = getSnowflakeClient();

    // Group affiliations by account, joining physician chars for location + specialty
    const rows = await sf.executeQuery(`
      SELECT
        a.ACCOUNT_ID                                                        AS "accountId",
        a.ACCOUNT_NAME                                                      AS "accountName",
        COUNT(DISTINCT a.PHYSICIAN_ID)                                      AS "hcpCount",
        LISTAGG(DISTINCT pc.PHYSICIAN_STATE, ', ')
          WITHIN GROUP (ORDER BY pc.PHYSICIAN_STATE)                        AS "states",
        LISTAGG(DISTINCT pc.PHYSICIAN_SPECIALTY, ', ')
          WITHIN GROUP (ORDER BY pc.PHYSICIAN_SPECIALTY)                    AS "specialtyMix"
      FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_AFFILIATIONS a
      LEFT JOIN CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS pc
        ON a.PHYSICIAN_ID = pc.PHYSICIAN_ID
      GROUP BY a.ACCOUNT_ID, a.ACCOUNT_NAME
      ORDER BY "hcpCount" DESC
      LIMIT 200
    `);

    return NextResponse.json({ accounts: rows });
  } catch (err: any) {
    console.error('[/api/accounts]', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}
