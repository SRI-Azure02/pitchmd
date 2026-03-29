import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// ── Replica pools ─────────────────────────────────────────────────────────────
const MALE_REPLICAS   = ['r92debe21318', 're6220ec0195'];
const FEMALE_REPLICAS = ['r291e545fd67', 'r9c55f9312fb'];

function pickReplica(gender: string | null | undefined): string {
  const pool =
    typeof gender === 'string' && gender.toLowerCase().startsWith('f')
      ? FEMALE_REPLICAS
      : MALE_REPLICAS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Persona cache ─────────────────────────────────────────────────────────────
// A single echo-mode persona is reused across all sessions so we only pay
// for one API call (conversation creation) instead of two per session.
// Set TAVUS_PERSONA_ID in .env.local to skip creation entirely on cold starts.
// If the env-pinned persona has been deleted, the route will auto-create a new
// one and log the replacement ID so .env.local can be updated.
let cachedPersonaId: string | null = process.env.TAVUS_PERSONA_ID ?? null;

async function createPersona(apiKey: string): Promise<string> {
  const res = await fetch('https://tavusapi.com/v2/personas', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_name: 'PitchMD Echo',
      pipeline_mode: 'echo',
      // replica_id is set per-conversation so a single persona works for all genders
    }),
  });
  const persona = await res.json();
  if (!persona.persona_id) throw new Error(`Persona creation failed: ${JSON.stringify(persona)}`);

  cachedPersonaId = persona.persona_id;
  console.log(`[tavus] created persona ${cachedPersonaId} — update TAVUS_PERSONA_ID=${cachedPersonaId} in .env.local`);
  return cachedPersonaId;
}

async function getOrCreatePersona(apiKey: string): Promise<string> {
  if (cachedPersonaId) return cachedPersonaId;
  return createPersona(apiKey);
}

// ── Conversation creation (with one retry on stale persona) ───────────────────
async function createConversation(
  apiKey: string,
  personaId: string,
  replicaId: string,
  conversationName: string,
): Promise<{ conversation_id: string; conversation_url: string }> {
  const res = await fetch('https://tavusapi.com/v2/conversations', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_id: personaId,
      replica_id: replicaId,
      conversation_name: conversationName,
    }),
  });
  const body = await res.json();
  if (!body.conversation_id) {
    throw Object.assign(
      new Error(`Tavus conversation creation failed: ${JSON.stringify(body)}`),
      { tavusBody: body },
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

  const { physicianName, gender } =
    await request.json() as { physicianName: string; gender: string | null };

  const replicaId = pickReplica(gender);
  const convName = `${physicianName} — ${new Date().toISOString()}`;

  // Get (or create) a persona, then create the conversation.
  // If conversation creation fails with the cached/env persona (e.g. it was
  // deleted), invalidate the cache, create a fresh persona, and retry once.
  let personaId: string;
  try {
    personaId = await getOrCreatePersona(apiKey);
  } catch (err: any) {
    console.error('[tavus] persona creation error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  let conv: { conversation_id: string; conversation_url: string };
  try {
    conv = await createConversation(apiKey, personaId, replicaId, convName);
  } catch (firstErr: any) {
    console.warn('[tavus] conversation creation failed — persona may be stale, retrying with new persona:', firstErr.message);
    // Invalidate the cached persona (it may have been deleted) and create a fresh one.
    cachedPersonaId = null;
    try {
      personaId = await createPersona(apiKey);
      conv = await createConversation(apiKey, personaId, replicaId, convName);
    } catch (retryErr: any) {
      console.error('[tavus] retry also failed:', retryErr.message);
      return NextResponse.json(
        { error: 'Failed to create Tavus conversation', details: (retryErr as any).tavusBody ?? retryErr.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    conversationId: conv.conversation_id,
    conversationUrl: conv.conversation_url,
    replicaId,
  });
}
