import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, AppSession } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

const ADMIN_EMAILS = (process.env.COMPLIANCE_ADMIN_EMAILS ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function isAdmin(session: AppSession): boolean {
  return (
    ADMIN_EMAILS.includes(session.email?.toLowerCase()    ?? '__none__') ||
    ADMIN_EMAILS.includes(session.username?.toLowerCase() ?? '__none__') ||
    ADMIN_EMAILS.includes(session.userId?.toLowerCase()   ?? '__none__')
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountId } = await params;
  try {
    const sf = getSnowflakeClient();
    const rows = await sf.executeQuery(
      `SELECT FLOW_DATA AS "flowData", SET_BY AS "setBy", SET_AT AS "setAt"
       FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_ACCOUNT_DYNAMIC_DEFAULT
       WHERE ACCOUNT_ID = :1
       LIMIT 1`,
      { '1': { type: 'TEXT', value: accountId } }
    );
    if (!rows.length) return NextResponse.json({ default: null });
    const row = rows[0] as { flowData: unknown; setBy: string; setAt: string };
    // Snowflake VARIANT is returned as a JSON string via REST API — parse it
    const flowData = typeof row.flowData === 'string' ? JSON.parse(row.flowData) : row.flowData;
    return NextResponse.json({ default: flowData, setBy: row.setBy, setAt: row.setAt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GET dynamic/default]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(session))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { accountId } = await params;
  const body = await request.json() as { flowData: unknown };
  const setBy: string = session.userId ?? session.username ?? session.email ?? 'unknown';

  try {
    const sf = getSnowflakeClient();
    await sf.executeQuery(
      `MERGE INTO CORTEX_TESTING.PUBLIC.SYNTHETIC_ACCOUNT_DYNAMIC_DEFAULT AS t
       USING (SELECT :1 AS ACCOUNT_ID) AS s ON t.ACCOUNT_ID = s.ACCOUNT_ID
       WHEN MATCHED THEN
         UPDATE SET FLOW_DATA = PARSE_JSON(:2), SET_BY = :3, SET_AT = CURRENT_TIMESTAMP()
       WHEN NOT MATCHED THEN
         INSERT (ACCOUNT_ID, FLOW_DATA, SET_BY, SET_AT)
         VALUES (:1, PARSE_JSON(:2), :3, CURRENT_TIMESTAMP())`,
      {
        '1': { type: 'TEXT', value: accountId },
        '2': { type: 'TEXT', value: JSON.stringify(body.flowData) },
        '3': { type: 'TEXT', value: setBy },
      }
    );
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST dynamic/default]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
