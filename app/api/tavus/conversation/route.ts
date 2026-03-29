import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// ── Replica pools ────────────────────────────────────────────────────────────
const MALE_REPLICAS   = ['r92debe21318', 're6220ec0195'];
const FEMALE_REPLICAS = ['rf4e9d9790f0', 'r291e545fd67', 'r9c55f9312fb'];

function pickReplica(gender: string | null | undefined): string {
  const pool =
    typeof gender === 'string' && gender.toLowerCase().startsWith('f')
      ? FEMALE_REPLICAS
      : MALE_REPLICAS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Route ────────────────────────────────────────────────────────────────────
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

  // Create an echo-mode persona (our app drives dialogue via Claude; Tavus handles video + TTS)
  const personaRes = await fetch('https://tavusapi.com/v2/personas', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_name: `PitchMD - ${physicianName}`,
      pipeline_mode: 'echo',
      default_replica_id: replicaId,
    }),
  });
  const persona = await personaRes.json();
  if (!persona.persona_id) {
    console.error('[tavus] persona creation failed:', persona);
    return NextResponse.json({ error: 'Failed to create Tavus persona', details: persona }, { status: 500 });
  }

  // Create a conversation for this session
  const convRes = await fetch('https://tavusapi.com/v2/conversations', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_id: persona.persona_id,
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
