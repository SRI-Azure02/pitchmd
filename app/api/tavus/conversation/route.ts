import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { normalizeGender } from '@/lib/avatar/types';

// ── Replica pools ─────────────────────────────────────────────────────────────
const MALE_REPLICAS   = ['r92debe21318', 're6220ec0195'];
const FEMALE_REPLICAS = ['r291e545fd67', 'r9c55f9312fb'];

/**
 * Pick a Tavus replica matching the physician's gender.
 * Uses the same normalizeGender logic as the Anam session-token route so that
 * both providers always select the same gender from the same DB signals:
 *   primary  → PHYSICIAN_GENDER ('M' | 'F')
 *   fallback → physician first name
 */
function pickReplica(
  gender: string | null | undefined,
  firstName?: string | null,
): string {
  const pool = normalizeGender(gender, firstName) === 'female'
    ? FEMALE_REPLICAS
    : MALE_REPLICAS;
  console.log(`[tavus] PHYSICIAN_GENDER="${gender ?? 'null'}" firstName="${firstName ?? ''}" → ${pool === FEMALE_REPLICAS ? 'female' : 'male'} replica pool`);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Persona management ────────────────────────────────────────────────────────
//
// The persona ID is read exclusively from the TAVUS_PERSONA_ID env var.
// This is cluster-safe: env vars are available on every replica and every
// serverless cold start without needing a shared in-memory cache.
//
// If TAVUS_PERSONA_ID is not set, we create a persona on the first request and
// log the ID prominently — the operator must then set the env var so future
// cold starts/replicas reuse the same persona.

async function createPersona(apiKey: string): Promise<string> {
  const res = await fetch('https://tavusapi.com/v2/personas', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona_name: 'PitchMD Echo', pipeline_mode: 'echo' }),
  });
  const rawText = await res.text();
  console.log(`[tavus] POST /personas → HTTP ${res.status}: ${rawText}`);
  let persona: any;
  try { persona = JSON.parse(rawText); } catch { persona = {}; }
  if (!persona.persona_id) throw new Error(`Persona creation failed (${res.status}): ${rawText}`);
  console.warn(
    `[tavus] ⚠ TAVUS_PERSONA_ID not set — created new persona ${persona.persona_id}. ` +
    `Set TAVUS_PERSONA_ID=${persona.persona_id} in your environment to avoid creating ` +
    `a new persona on every cold start.`,
  );
  return persona.persona_id as string;
}

async function getOrCreatePersona(apiKey: string): Promise<string> {
  const envPersonaId = process.env.TAVUS_PERSONA_ID;
  if (envPersonaId) return envPersonaId;
  return createPersona(apiKey);
}

// ── Conversation creation ─────────────────────────────────────────────────────
async function createConversation(
  apiKey: string,
  personaId: string,
  replicaId: string,
  conversationName: string,
): Promise<{ conversation_id: string; conversation_url: string }> {
  const payload = { persona_id: personaId, replica_id: replicaId, conversation_name: conversationName };
  console.log('[tavus] POST /conversations payload:', JSON.stringify(payload));

  const res = await fetch('https://tavusapi.com/v2/conversations', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  console.log(`[tavus] POST /conversations → HTTP ${res.status}: ${rawText}`);

  let body: any;
  try { body = JSON.parse(rawText); } catch { body = { _raw: rawText }; }

  if (!body.conversation_id) {
    throw Object.assign(
      new Error(`Tavus /conversations returned HTTP ${res.status}`),
      { status: res.status, tavusBody: body },
    );
  }
  return body;
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Tavus not configured — set TAVUS_API_KEY' }, { status: 500 });
  }

  const { physicianName, gender, firstName } =
    await request.json() as { physicianName: string; gender: string | null; firstName?: string | null };

  const replicaId = pickReplica(gender, firstName);
  const convName = `${physicianName} — ${new Date().toISOString()}`;

  // ── Step 1: Get or create persona ─────────────────────────────────────────
  let personaId: string;
  try {
    personaId = await getOrCreatePersona(apiKey);
  } catch (err: any) {
    console.error('[tavus] persona error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // ── Step 2: Create conversation; retry with fresh persona if it fails ──────
  let conv: { conversation_id: string; conversation_url: string };
  try {
    conv = await createConversation(apiKey, personaId, replicaId, convName);
  } catch (firstErr: any) {
    const firstStatus: number = firstErr.status ?? 0;
    const firstBody = firstErr.tavusBody;
    console.warn('[tavus] first attempt failed. status:', firstStatus, 'body:', JSON.stringify(firstBody));

    // 402 = quota exhausted — retrying won't help; surface a clear message immediately.
    if (firstStatus === 402) {
      return NextResponse.json(
        { error: 'Tavus free-tier quota exhausted — upgrade your plan at platform.tavus.io to continue using the avatar.' },
        { status: 402 },
      );
    }

    // Other failures may indicate a stale persona — create a fresh one and retry once.
    try {
      personaId = await createPersona(apiKey);
    } catch (personaErr: any) {
      console.error('[tavus] persona re-creation failed:', personaErr.message);
      return NextResponse.json({ error: personaErr.message }, { status: 500 });
    }

    try {
      conv = await createConversation(apiKey, personaId, replicaId, convName);
    } catch (retryErr: any) {
      const retryStatus: number = retryErr.status ?? 0;
      const retryBody = retryErr.tavusBody;
      console.error('[tavus] retry also failed. status:', retryStatus, 'body:', JSON.stringify(retryBody));
      const retryMessage = retryStatus === 402
        ? 'Tavus free-tier quota exhausted — upgrade your plan at platform.tavus.io'
        : `Tavus conversation creation failed (HTTP ${retryStatus})`;
      return NextResponse.json({ error: retryMessage, details: retryBody }, { status: 500 });
    }
  }

  return NextResponse.json({
    conversationId: conv.conversation_id,
    conversationUrl: conv.conversation_url,
    replicaId,
  });
}
