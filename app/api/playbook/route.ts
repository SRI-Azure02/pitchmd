import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';
import Anthropic from '@anthropic-ai/sdk';

// Allow up to 3 minutes — 5 parallel Snowflake queries + Claude inference
export const maxDuration = 180;

interface PlaybookJSON {
  rep_brief: string;
  opening_strategy: string;
  key_messages: string[];
  anticipated_objections: { objection: string; suggested_response: string }[];
  closing_ask: string;
  follow_up_items: string[];
  tone_guidance: string;
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { physicianId } = await request.json() as { physicianId: string };
  if (!physicianId) {
    return NextResponse.json({ error: 'physicianId is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });

  try {
    const sf = getSnowflakeClient();
    const userId = session.userId;

    // ── 1. Parallel data fetch ─────────────────────────────────────────────
    const [physicianRows, rxRows, activityRows, callNoteRows, taskRows] = await Promise.all([

      // Physician profile + segment
      sf.executeQuery(`
        SELECT
          pc.PHYSICIAN_FIRST_NAME, pc.PHYSICIAN_LAST_NAME,
          pc.PHYSICIAN_SPECIALTY, pc.PHYSICIAN_STATE,
          pc.PHYSICIAN_YEARS_IN_PRACTICE, pc.PHYSICIAN_GENDER,
          ps.SEGMENT_NAME, ps.ATTITUDINAL_DESCRIPTION, ps.TREATMENT_PREFERENCES
        FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS pc
        LEFT JOIN CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_SEGMENT ps
          ON pc.PHYSICIAN_ID = ps.PHYSICIAN_ID
        WHERE pc.PHYSICIAN_ID = :1
      `, { '1': { type: 'TEXT', value: physicianId } }),

      // Rx trend — last 12 weeks, all brands
      sf.executeQuery(`
        SELECT BRAND, FRIDAY_WEEK_ENDING_DATE, PRESCRIPTIONS_WRITTEN
        FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_RX
        WHERE PHYSICIAN_ID = :1
          AND FRIDAY_WEEK_ENDING_DATE >= DATEADD(week, -12, CURRENT_DATE())
        ORDER BY FRIDAY_WEEK_ENDING_DATE ASC
      `, { '1': { type: 'TEXT', value: physicianId } }),

      // Recent promotional activity — last 90 days
      sf.executeQuery(`
        SELECT PROMOTION_CHANNEL, MESSAGE_DELIVERED, TRANSACTION_DATE
        FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_ACTIVITY
        WHERE PHYSICIAN_ID = :1
          AND TRANSACTION_DATE >= DATEADD(day, -90, CURRENT_DATE())
        ORDER BY TRANSACTION_DATE DESC
        LIMIT 10
      `, { '1': { type: 'TEXT', value: physicianId } }),

      // Last 5 call notes (AI summary only — no full transcript)
      sf.getRecentCallNotesByPhysician(userId, physicianId, 5),

      // Open loop-back tasks
      sf.getOpenTasksByPhysician(userId, physicianId),
    ]);

    // ── 2. Format context blocks ───────────────────────────────────────────
    const p = physicianRows[0] ?? {};
    const physicianName = p.PHYSICIAN_FIRST_NAME && p.PHYSICIAN_LAST_NAME
      ? `Dr. ${p.PHYSICIAN_FIRST_NAME} ${p.PHYSICIAN_LAST_NAME}`
      : 'the physician';

    const rxTrendText = rxRows.length > 0
      ? rxRows.map((r: any) =>
          `  - Week ending ${r.FRIDAY_WEEK_ENDING_DATE}: ${r.BRAND} = ${r.PRESCRIPTIONS_WRITTEN} scripts`
        ).join('\n')
      : '  No Rx data available.';

    const activityText = activityRows.length > 0
      ? activityRows.map((a: any) =>
          `  - ${a.TRANSACTION_DATE} via ${a.PROMOTION_CHANNEL}: "${a.MESSAGE_DELIVERED}"`
        ).join('\n')
      : '  No recent promotional activity on record.';

    const callNotesText = callNoteRows.length > 0
      ? callNoteRows.map((n: any, i: number) =>
          `  ${i + 1}. ${n.CALL_DATE}: ${n.AI_SUMMARY ?? '(no summary)'}`
        ).join('\n')
      : '  No call notes on record.';

    const tasksText = taskRows.length > 0
      ? taskRows.map((t: any, i: number) =>
          `  ${i + 1}. ${t.TASK_TEXT}`
        ).join('\n')
      : '  None.';

    // ── 3. Build prompt ────────────────────────────────────────────────────
    const prompt = `You are a pharmaceutical sales strategy assistant. Generate a structured pre-call playbook for a sales rep preparing to visit the physician below.

PHYSICIAN PROFILE:
  Name: ${physicianName}
  Specialty: ${p.PHYSICIAN_SPECIALTY ?? 'Unknown'} | State: ${p.PHYSICIAN_STATE ?? 'Unknown'}
  Segment: ${p.SEGMENT_NAME ?? 'Unknown'}
  Attitudinal Profile: ${p.ATTITUDINAL_DESCRIPTION ?? 'Not available'}
  Treatment Preferences: ${p.TREATMENT_PREFERENCES ?? 'Not available'}
  Years in Practice: ${p.PHYSICIAN_YEARS_IN_PRACTICE ?? 'Unknown'}

RX TREND (last 12 weeks):
${rxTrendText}

RECENT PROMOTIONAL ACTIVITY (last 90 days):
${activityText}

RECENT CALL NOTES (last 5, AI summaries):
${callNotesText}

OPEN FOLLOW-UP COMMITMENTS:
${tasksText}

Return ONLY a valid JSON object with this exact structure. No markdown fences. No text before { or after }.

{
  "rep_brief": "<2-3 sentences describing this physician and the current relationship state based on the data above>",
  "opening_strategy": "<how to open the conversation given their segment, history, and recent activity>",
  "key_messages": ["<message 1 tailored to this physician's segment and preferences>", "<message 2>", "<message 3>"],
  "anticipated_objections": [
    {"objection": "<likely objection based on attitudinal profile>", "suggested_response": "<how to respond>"}
  ],
  "closing_ask": "<the specific commitment or next step to aim for in this visit>",
  "follow_up_items": ["<item 1 to address from open tasks or prior calls>"],
  "tone_guidance": "<communication style and approach tailored to this physician's attitudinal profile and segment>"
}`;

    // ── 4. Claude call ─────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = (msg.content[0] as any)?.text?.trim() ?? '';
    let playbook: PlaybookJSON;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON object found in response');
      playbook = JSON.parse(match[0]);
    } catch (parseErr: any) {
      console.error('[playbook] JSON parse failed. Raw:', raw.slice(0, 300));
      return NextResponse.json(
        { error: 'Failed to parse playbook from AI response' },
        { status: 500 },
      );
    }

    return NextResponse.json({ playbook, physicianName });

  } catch (err: any) {
    console.error('[playbook] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
