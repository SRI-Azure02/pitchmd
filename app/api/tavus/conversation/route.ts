import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

// ── Replica pools ────────────────────────────────────────────────────────────
const MALE_REPLICAS   = ['r92debe21318', 're6220ec0195'];
const FEMALE_REPLICAS = ['rf4e9d9790f0', 'r291e545fd67', 'r9c55f9312fb'];

function pickReplica(isFemale: boolean): string {
  const pool = isFemale ? FEMALE_REPLICAS : MALE_REPLICAS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Common female first names to cover the synthetic physician dataset (and beyond).
const FEMALE_NAMES = new Set([
  'allison','alice','alicia','amanda','amy','andrea','angela','anna','anne','ashley',
  'barbara','beth','betty','beverly','bonnie','brenda','brittany',
  'carol','caroline','catherine','charlotte','cheryl','christina','christine','claire','claudia',
  'dana','deborah','debra','diana','diane','donna','dorothy',
  'elena','eleanor','elizabeth','emily','emma','evelyn',
  'frances','gloria','grace',
  'hannah','heather','helen','holly',
  'irene',
  'jacqueline','jane','janet','jennifer','jessica','joan','joyce','judy','julia','julie',
  'karen','katherine','kathleen','kathy','katie','kelly','kim','kimberly',
  'laura','lauren','linda','lisa','lori','lucy',
  'margaret','maria','marie','marilyn','martha','mary','megan','melissa','meredith','michelle','morgan',
  'nancy','natalie','nicole',
  'olivia',
  'pamela','patricia','paula',
  'rachel','rebecca','renee','rita','robin','rose','ruth',
  'samantha','sandra','sara','sarah','sharon','sheila','shirley','stephanie','sue','susan','suzanne',
  'tammy','teresa','theresa','tiffany','tina','tracy',
  'valerie','victoria','virginia',
  'wendy',
]);

function isFemaleFirstName(firstName: string): boolean {
  return FEMALE_NAMES.has(firstName.toLowerCase().trim());
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Tavus not configured — set TAVUS_API_KEY' }, { status: 500 });
  }

  const { physicianName, physicianFirstName } =
    await request.json() as { physicianName: string; physicianFirstName: string };

  const replicaId = pickReplica(isFemaleFirstName(physicianFirstName));

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
    replicaId, // for debugging
  });
}
