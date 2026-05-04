import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

/** Returns all distinct brand names from SYNTHETIC_RX for client-side STT correction. */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sf = getSnowflakeClient();
    const brands = await sf.getAllBrands();
    return NextResponse.json({ brands });
  } catch (err: any) {
    console.error('[brands] error:', err?.message ?? String(err));
    return NextResponse.json({ error: 'Failed to fetch brands' }, { status: 500 });
  }
}
