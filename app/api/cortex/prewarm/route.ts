/**
 * FIX 4: Pre-warm the Snowflake Cortex Agent connection.
 *
 * Snowflake Cortex Agent has a cold-start penalty when the session has been
 * idle.  Calling this endpoint when the user selects a physician (before they
 * type their first message) warms the TCP connection and triggers any
 * Snowflake-side caching, shaving several seconds off TTFT on the first real
 * turn.
 *
 * The request sends a trivial single-token message so the agent returns almost
 * instantly — we don't care about the response content, only that the round
 * trip has happened.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

export async function POST(request: NextRequest) {
  // Auth check — only warm for authenticated sessions
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const account = process.env.SNOWFLAKE_ACCOUNT!;
  const pat = process.env.SNOWFLAKE_PAT || process.env.SNOWFLAKE_PASSWORD!;
  const agentUrl = `https://${account}.snowflakecomputing.com/api/v2/databases/CORTEX_TESTING/schemas/PUBLIC/agents/PITCHMD:run`;

  try {
    // Fire a minimal message — just enough to establish the connection and
    // warm Snowflake's routing layer.  We abort after 8 s regardless of
    // whether the agent has responded; the warm-up benefit is in the
    // connection establishment, not the response.
    const timeoutMs = Number(process.env.CORTEX_PREWARM_TIMEOUT_MS ?? 8_000);
    const controller = new AbortController();
    const warmupTimeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pat}`,
        Accept: 'text/event-stream',
        'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        stream: true,
        role: 'APP_SVC_ROLE',
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(warmupTimeout));

    // Drain a small amount of the response body so the TCP connection is
    // fully established (some proxies don't flush until the body is read).
    if (res.body) {
      const reader = res.body.getReader();
      // Read up to ~512 bytes then cancel — we don't need the actual content.
      const { done, value } = await reader.read();
      if (!done && value) { /* intentionally discard */ }
      reader.cancel().catch(() => {});
    }

    console.log('[prewarm] Snowflake connection warmed, status:', res.status);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // AbortError is expected when the 8 s timeout fires — that's fine.
    if (err?.name === 'AbortError') {
      console.log('[prewarm] timed out (expected) — connection warmed');
      return NextResponse.json({ ok: true, note: 'timeout' });
    }
    console.warn('[prewarm] warm-up failed:', err?.message);
    // Non-fatal — don't surface errors to the client for a best-effort call
    return NextResponse.json({ ok: false, reason: err?.message }, { status: 200 });
  }
}
