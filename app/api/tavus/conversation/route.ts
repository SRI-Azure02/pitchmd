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
let cachedPersonaId: string | null = process.env.TAVUS_PERSONA_ID ?? null;

async function getOrCreatePersona(apiKey: string): Promise<string> {
  if (cachedPersonaId) return cachedPersonaId;

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
  console.log(`[tavus] created persona ${cachedPersonaId} — add TAVUS_PERSONA_ID=${cachedPersonaId} to .env.local to skip this on cold starts`);
  return cachedPersonaId;
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

  let personaId: string;
  try {
    personaId = await getOrCreatePersona(apiKey);
  } catch (err: any) {
    console.error('[tavus] persona error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // Create a conversation — only API call needed on warm instances
  const convRes = await fetch('https://tavusapi.com/v2/conversations', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_id: personaId,
      replica_id: replicaId,
      conversation_name: `${physicianName} — ${new Date().toISOString()}`,
    }),
  });
  const conv = await convRes.json();
  if (!conv.conversation_id) {
    console.error('[tavus] conversation creation failed:', conv);
    return NextResponse.json({ error: 'Failed to create Tavus conversation', details: conv }, { status: 500 });
  }

  return NextResponse.json({
    conversationId: conv.conversation_id,
    conversationUrl: conv.conversation_url,
    replicaId,
  });
}
