import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { pickAnamPersona } from '@/lib/avatar/anam-personas';

// ── Anam echo-mode session token ────────────────────────────────────────────
//
// Exchanges the server-held ANAM_API_KEY for a short-lived session token that
// the browser SDK uses to start a stream. We never expose the API key client
// side. The persona is chosen server-side from the gender-matched pool so the
// avatar face + voice model (pre-configured in Anam Lab) match the AI agent.
//
// Request:  { gender?: string | null, physicianName?: string }
// Response: { sessionToken: string, personaId: string }

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anam not configured — set ANAM_API_KEY' }, { status: 500 });
  }

  const { gender } =
    (await request.json().catch(() => ({}))) as { gender?: string | null; physicianName?: string };

  // Gender-based random persona assignment (mirrors the Tavus replica logic).
  const personaId = pickAnamPersona(gender);

  const res = await fetch('https://api.anam.ai/v1/auth/session-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    // Pre-created persona: only the UUID is needed — Anam resolves the attached
    // avatar face and voice model server-side.
    body: JSON.stringify({ personaConfig: { personaId } }),
  });

  const rawText = await res.text();
  console.log(`[anam] POST /auth/session-token (persona ${personaId}) → HTTP ${res.status}`);

  if (!res.ok) {
    console.error('[anam] session-token error:', rawText);
    return NextResponse.json(
      { error: `Anam session-token failed (HTTP ${res.status})`, details: rawText },
      { status: res.status },
    );
  }

  let body: any;
  try { body = JSON.parse(rawText); } catch { body = {}; }

  const sessionToken: string | undefined = body.sessionToken ?? body.token;
  if (!sessionToken) {
    console.error('[anam] session-token: no token field in response:', rawText);
    return NextResponse.json(
      { error: 'Anam session-token: no token in response', details: rawText },
      { status: 500 },
    );
  }

  return NextResponse.json({ sessionToken, personaId });
}
