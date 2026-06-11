import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { pickAnamPersona } from '@/lib/avatar/anam-personas';

// ── Anam echo-mode session token ────────────────────────────────────────────
//
// Exchanges the server-held ANAM_API_KEY for a short-lived session token that
// the browser SDK uses to start a stream. We never expose the API key
// client-side. The persona is chosen from the gender-matched pool using two
// signals: PHYSICIAN_GENDER (DB field) and physician first name (fallback).
//
// Request:  { gender?: string | null, firstName?: string | null, physicianName?: string }
// Response: { sessionToken: string, personaId: string }

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anam not configured — set ANAM_API_KEY' }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    gender?: string | null;
    firstName?: string | null;
    physicianName?: string;
  };

  const { gender = null, firstName = null } = body;

  // Log what we received so gender-detection issues are visible in server logs.
  console.log(`[anam] session-token request — gender="${gender ?? 'null'}" firstName="${firstName ?? 'null'}"`);

  // Gender-based random persona assignment.
  // pickAnamPersona uses PHYSICIAN_GENDER as primary signal and first name
  // as fallback — see lib/avatar/types.ts normalizeGender for full logic.
  const personaId = pickAnamPersona(gender, firstName);
  console.log(`[anam] selected personaId: ${personaId}`);

  const res = await fetch('https://api.anam.ai/v1/auth/session-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    // Pre-created persona: only the UUID is needed — Anam resolves the attached
    // avatar face and voice model server-side.
    body: JSON.stringify({ personaConfig: { personaId } }),
  });

  const rawText = await res.text();
  console.log(`[anam] POST /auth/session-token (persona ${personaId}) → HTTP ${res.status}: ${rawText.slice(0, 200)}`);

  if (!res.ok) {
    console.error('[anam] session-token error:', rawText);
    return NextResponse.json(
      { error: `Anam session-token failed (HTTP ${res.status})`, details: rawText },
      { status: res.status },
    );
  }

  let resBody: any;
  try { resBody = JSON.parse(rawText); } catch { resBody = {}; }

  const sessionToken: string | undefined = resBody.sessionToken ?? resBody.token;
  if (!sessionToken) {
    console.error('[anam] session-token: no token field in response:', rawText);
    return NextResponse.json(
      { error: 'Anam session-token: no token in response', details: rawText },
      { status: 500 },
    );
  }

  return NextResponse.json({ sessionToken, personaId });
}
