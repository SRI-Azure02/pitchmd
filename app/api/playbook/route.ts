import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, rateLimitResponse, AI_HEAVY_LIMIT } from '@/lib/rate-limit';


interface PlaybookJSON {
  physician_brief: string;
  opening_points: string[];
  key_messages: string[];
  anticipated_objections: { objection: string; responses: string[] }[];
  closing_ask: string;
}

interface BrandShare {
  brand: string;
  current_share: number;
  direction: 'up' | 'down' | 'flat';
  change: number;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Rate limit: 20 playbook generations per minute per user
    const rl = checkRateLimit(`playbook:${session.userId}`, AI_HEAVY_LIMIT);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs) as unknown as NextResponse;

    const { physicianId } = await request.json() as { physicianId: string };
    if (!physicianId) {
      return NextResponse.json({ error: 'physicianId is required' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });

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

      // Recent promotional activity — last 90 days, top 5 for the card + prompt
      sf.executeQuery(`
        SELECT PROMOTION_CHANNEL, MESSAGE_DELIVERED, TRANSACTION_DATE
        FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_ACTIVITY
        WHERE PHYSICIAN_ID = :1
          AND TRANSACTION_DATE >= DATEADD(day, -90, CURRENT_DATE())
        ORDER BY TRANSACTION_DATE DESC
        LIMIT 5
      `, { '1': { type: 'TEXT', value: physicianId } }),

      // Last 5 call notes (AI summary only — no full transcript)
      sf.getRecentCallNotesByPhysician(userId, physicianId, 5),

      // Open loop-back tasks
      sf.getOpenTasksByPhysician(userId, physicianId),
    ]);

    // ── 2a. Compute market share (most recent 4 weeks vs prior 4 weeks) ───
    const allWeeks = [...new Set((rxRows as any[]).map(r => r.FRIDAY_WEEK_ENDING_DATE as string))].sort().reverse();
    const currentWeekSet = new Set(allWeeks.slice(0, 4));
    const priorWeekSet   = new Set(allWeeks.slice(4, 8));

    const sumScripts = (rows: any[], weekSet: Set<string>) => {
      const totals: Record<string, number> = {};
      for (const r of rows) {
        if (weekSet.has(r.FRIDAY_WEEK_ENDING_DATE)) {
          totals[r.BRAND] = (totals[r.BRAND] ?? 0) + Number(r.PRESCRIPTIONS_WRITTEN);
        }
      }
      return totals;
    };

    const currentScripts = sumScripts(rxRows as any[], currentWeekSet);
    const priorScripts   = sumScripts(rxRows as any[], priorWeekSet);
    const currentTotal   = Object.values(currentScripts).reduce((a, b) => a + b, 0) || 1;
    const priorTotal     = Object.values(priorScripts).reduce((a, b) => a + b, 0) || 1;

    const allBrands = [...new Set((rxRows as any[]).map(r => r.BRAND as string))];
    const marketShare: BrandShare[] = allBrands.map(brand => {
      const cur      = currentScripts[brand] ?? 0;
      const prior    = priorScripts[brand]   ?? 0;
      const curShare = (cur   / currentTotal) * 100;
      const priShare = (prior / priorTotal)   * 100;
      const delta    = curShare - priShare;
      return {
        brand,
        current_share: Math.round(curShare * 10) / 10,
        direction: (Math.abs(delta) < 0.1 ? 'flat' : delta > 0 ? 'up' : 'down') as 'flat' | 'up' | 'down',
        change: Math.round(Math.abs(delta) * 10) / 10,
      };
    }).sort((a, b) => b.current_share - a.current_share);

    // ── 2. Format context blocks ───────────────────────────────────────────
    const p = physicianRows[0] ?? {};
    const physicianName = p.PHYSICIAN_FIRST_NAME && p.PHYSICIAN_LAST_NAME
      ? `Dr. ${p.PHYSICIAN_FIRST_NAME} ${p.PHYSICIAN_LAST_NAME}`
      : 'the physician';

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
    const marketShareContext = marketShare.length > 0
      ? marketShare.map(b =>
          `  ${b.brand}: ${b.current_share}% share (${b.direction === 'up' ? '↑' : b.direction === 'down' ? '↓' : '→'} ${b.direction === 'flat' ? 'flat' : b.change + 'pp'} vs prior 4 weeks)`
        ).join('\n')
      : '  No Rx data available.';

    const prompt = `You are a pharmaceutical sales strategy assistant. Generate a focused pre-call playbook for a sales rep visiting the physician below. Be specific and actionable — avoid generic language.

PHYSICIAN PROFILE:
  Name: ${physicianName}
  Specialty: ${p.PHYSICIAN_SPECIALTY ?? 'Unknown'} | State: ${p.PHYSICIAN_STATE ?? 'Unknown'}
  Segment: ${p.SEGMENT_NAME ?? 'Unknown'}
  Attitudinal Profile: ${p.ATTITUDINAL_DESCRIPTION ?? 'Not available'}
  Treatment Preferences: ${p.TREATMENT_PREFERENCES ?? 'Not available'}
  Years in Practice: ${p.PHYSICIAN_YEARS_IN_PRACTICE ?? 'Unknown'}

MARKET SHARE — most recent 4 weeks:
${marketShareContext}

RECENT PROMOTIONAL ACTIVITY (last 90 days):
${activityText}

RECENT CALL NOTES (last 5, AI summaries):
${callNotesText}

OPEN FOLLOW-UP COMMITMENTS:
${tasksText}

Return ONLY a valid JSON object. No markdown fences. No text before { or after }.

Keep all content terse — no filler words, no elaborate sentences. Plain, direct language only.

Field rules:
- physician_brief: One phrase, ≤12 words. Prescribing stance + relationship status.
- opening_points: 2 bullets. Each ≤10 words. Verb first. Reference a specific data point (call note, task, activity, or share trend).
- key_messages: 3 bullets. Each ≤12 words. Clinical/product point tailored to this physician's segment. No generic claims.
- anticipated_objections: 2 objections from their attitudinal profile. Objection ≤8 words. 2 response bullets each, ≤12 words per bullet.
- closing_ask: ≤12 words. Name the exact commitment (sample, trial, meeting, etc.).

{
  "physician_brief": "<one phrase, ≤12 words>",
  "opening_points": ["<≤10 words>", "<≤10 words>"],
  "key_messages": ["<≤12 words>", "<≤12 words>", "<≤12 words>"],
  "anticipated_objections": [
    {"objection": "<≤8 words>", "responses": ["<≤12 words>", "<≤12 words>"]}
  ],
  "closing_ask": "<≤12 words>"
}`;

    // ── 4. Claude call ─────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = (msg.content[0] as any)?.text?.trim() ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('[playbook] No JSON found in AI response. Raw:', raw.slice(0, 300));
      return NextResponse.json({ error: 'Failed to parse playbook from AI response' }, { status: 500 });
    }
    const playbook: PlaybookJSON = JSON.parse(match[0]);

    const openTasks = (taskRows as any[]).map((t: any) => t.TASK_TEXT as string);
    const recentActivity = (activityRows as any[]).map((a: any) => ({
      date:    a.TRANSACTION_DATE as string,
      channel: a.PROMOTION_CHANNEL as string,
      message: a.MESSAGE_DELIVERED as string,
    }));
    return NextResponse.json({ playbook, physicianName, marketShare, openTasks, recentActivity });

  } catch (err: any) {
    console.error('[playbook] error:', err?.message ?? String(err));
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 });
  }
}
