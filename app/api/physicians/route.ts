import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;

  // Pagination
  const page     = Math.max(1, Number(sp.get('page')     ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? 25)));

  // Search / filter / sort
  const search    = sp.get('search')    ?? undefined;
  const sortBy    = sp.get('sortBy')    ?? undefined;
  const sortDir   = sp.get('sortDir') === 'desc' ? 'desc' : 'asc';
  const segment   = sp.get('segment')   ?? undefined;
  const specialty = sp.get('specialty') ?? undefined;

  try {
    const client = getSnowflakeClient();
    const { rows, totalCount } = await client.queryAllPhysiciansWithScores(
      session.userId,
      { page, pageSize, search, sortBy, sortDir, segment, specialty },
    );
    return NextResponse.json({ physicians: rows, totalCount, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[physicians] Snowflake error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
