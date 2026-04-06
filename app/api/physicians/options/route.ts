import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

/**
 * Returns the distinct filter-option values for physician list dropdowns.
 * Cheap lightweight query — safe to call on every component mount.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getSnowflakeClient();
    const options = await client.getPhysicianFilterOptions(session.userId);
    return NextResponse.json(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[physicians/options] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
