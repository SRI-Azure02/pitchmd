/**
 * POST /api/intelligence/query
 *
 * Natural-language to SQL pipeline for Territory Intelligence.
 * 1. Claude Haiku generates a SQL query from the user's question.
 * 2. SQL is validated and executed against Snowflake.
 * 3. If zero rows and a physician name was mentioned, runs phonetic disambiguation.
 * 4. Claude Haiku streams a narrative summary of the results.
 *
 * Response: text/event-stream SSE
 */
import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Soundex + Levenshtein for phonetic physician name disambiguation ──────────

function soundex(s: string): string {
  const MAP: Record<string, string> = {
    B:'1',F:'1',P:'1',V:'1',C:'2',G:'2',J:'2',K:'2',Q:'2',S:'2',X:'2',Z:'2',
    D:'3',T:'3',L:'4',M:'5',N:'5',R:'6'
  };
  const u = s.toUpperCase().replace(/[^A-Z]/g,'');
  if (!u) return '0000';
  let r = u[0], prev = MAP[u[0]] ?? '0';
  for (let i = 1; i < u.length && r.length < 4; i++) {
    const c = MAP[u[i]] ?? '0';
    if (c !== '0' && c !== prev) r += c;
    prev = c;
  }
  return r.padEnd(4, '0');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// ── Schema description for Claude ─────────────────────────────────────────────

const SCHEMA_BLOCK = `
Tables (use fully-qualified names as shown):
- CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS (alias pc): PHYSICIAN_ID(TEXT), PHYSICIAN_FIRST_NAME(TEXT), PHYSICIAN_LAST_NAME(TEXT), PHYSICIAN_SPECIALTY(TEXT), PHYSICIAN_CITY(TEXT), PHYSICIAN_STATE(TEXT), PHYSICIAN_GENDER(TEXT), PHYSICIAN_YEARS_IN_PRACTICE(NUMBER)
- CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_SEGMENT (alias ps): PHYSICIAN_ID(TEXT), SEGMENT_NAME(TEXT), ATTITUDINAL_DESCRIPTION(TEXT), TREATMENT_PREFERENCES(TEXT)
- CORTEX_TESTING.PUBLIC.SYNTHETIC_RX (alias rx): PHYSICIAN_ID(TEXT), BRAND(TEXT), FRIDAY_WEEK_ENDING_DATE(DATE), PRESCRIPTIONS_WRITTEN(NUMBER)
- CORTEX_TESTING.PUBLIC.SYNTHETIC_ACTIVITY (alias act): PHYSICIAN_ID(TEXT), PROMOTION_CHANNEL(TEXT), MESSAGE_DELIVERED(TEXT), TRANSACTION_DATE(DATE)
- CORTEX_TESTING.PUBLIC.SYNTHETIC_CALL_JOURNAL (alias cj): NOTE_ID(TEXT), APP_USER_ID(TEXT), PHYSICIAN_ID(TEXT), CALL_DATE(DATE), AI_SUMMARY(TEXT)  <- MUST filter APP_USER_ID = '<repId>'
- CORTEX_TESTING.PUBLIC.SYNTHETIC_LOOPBACK (alias lb): TASK_ID(TEXT), APP_USER_ID(TEXT), PHYSICIAN_ID(TEXT), TASK_TEXT(TEXT), STATUS(TEXT), CREATED_AT(TIMESTAMP) <- MUST filter APP_USER_ID = '<repId>'
- CORTEX_TESTING.ML.REPEVAL_RESULTS (alias ev): APP_USER_ID(TEXT), PHYSICIAN_ID(TEXT), PHYSICIAN_FIRST_NAME(TEXT), PHYSICIAN_LAST_NAME(TEXT), PHYSICIAN_SPECIALTY(TEXT), SEGMENT_NAME(TEXT), EVALUATED_AT(TIMESTAMP), OVERALL_SCORE(FLOAT), FIELD_READINESS(TEXT), COACHING_PRIORITY(TEXT), CK_SCORE(FLOAT), OH_SCORE(FLOAT), COMP_SCORE(FLOAT), TR_SCORE(FLOAT), CL_SCORE(FLOAT) <- MUST filter APP_USER_ID = '<repId>'
`;

const ALLOWED_TABLES = [
  'SYNTHETIC_PHYSICIAN_CHARS',
  'SYNTHETIC_PHYSICIAN_SEGMENT',
  'SYNTHETIC_RX',
  'SYNTHETIC_ACTIVITY',
  'SYNTHETIC_CALL_JOURNAL',
  'SYNTHETIC_LOOPBACK',
  'REPEVAL_RESULTS',  // lives in CORTEX_TESTING.ML schema
];

const UNSAFE_SQL = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/i;

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const repId: string =
    (session as any).userId ??
    (session as any).username ??
    (session as any).email ??
    'unknown';

  let query: string;
  try {
    const body = await request.json();
    query = (body.query ?? '').trim();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (!query) {
    return new Response(JSON.stringify({ error: 'query is required' }), { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: object) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        // ── Step 0: Intent classification gate ─────────────────────────────
        const classifyResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          system: `You are a topic classifier for a pharmaceutical sales rep data tool.
Classify the user query as ALLOWED or BLOCKED. Return raw JSON only — no markdown.

ALLOWED topics:
- Physician data (demographics, specialty, segment, attitudes)
- Rx trends (prescription volumes, brand share, competitive data)
- Call activity (call journal entries, visit history, promotion channels)
- Loopback tasks (open commitments, follow-up tasks, task status)
- Compliance flags (evaluation scores, compliance status, coaching notes)
- Territory planning (physician lists, coverage gaps, prioritization)
- Physician prioritization (ranking, scoring, segment targeting)

BLOCKED topics:
- Causal analysis or explanations for why trends shifted (e.g. "why did Rx drop?", "what caused the change?", "reasons for decline")
- Questions unrelated to the rep's territory or physician data

Return exactly: { "allowed": true } or { "allowed": false, "reason": "one sentence explanation shown to the rep" }`,
          messages: [{ role: 'user', content: query }],
        });

        const classifyRaw = (classifyResp.content[0] as { text: string }).text.trim()
          .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

        let classification: { allowed: boolean; reason?: string };
        try { classification = JSON.parse(classifyRaw); }
        catch { classification = { allowed: true }; } // fail open on parse error

        if (!classification.allowed) {
          send({ type: 'blocked', reason: 'This is beyond my currently allowed scope. Please reach out to the Field Analytics team for more insights.' });
          send({ type: 'done' });
          controller.close();
          return;
        }

        // ── Step 1: SQL generation ──────────────────────────────────────────
        send({ type: 'status', message: 'Generating query...' });

        const systemPrompt = `You are a data analyst. Given a user question, produce a JSON response (no markdown, raw JSON only) with this exact shape:
{
  "type": "table" | "chart" | "stat",
  "sql": "SELECT ...",
  "chartConfig": { "xKey": "col", "yKeys": [{"key": "col", "label": "Label"}], "seriesKey": "col", "title": "..." },
  "statConfig": { "valueKey": "col", "label": "...", "trendKey": "col" },
  "physicianNameMentioned": "smith"
}

Rules:
- SELECT only - no INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE
- LIMIT 500 for type 'chart' (trend data needs many rows), LIMIT 50 for 'table' and 'stat'
- Tables with APP_USER_ID must include WHERE APP_USER_ID = '${repId}' or equivalent AND clause
- Join SYNTHETIC_PHYSICIAN_CHARS to other tables via PHYSICIAN_ID when physician name is needed in output
- Use CORTEX_TESTING.PUBLIC.TABLE_NAME fully qualified (e.g. CORTEX_TESTING.PUBLIC.SYNTHETIC_RX)
- chartConfig only for type 'chart'. seriesKey is set when data has multiple series on the same x-axis (e.g. brand column for multi-line Rx chart). yKeys lists each series. Add "yUnit": "%" to chartConfig when values are percentages (e.g. market share).
- statConfig only for type 'stat'.
- physicianNameMentioned: set to the last name string if the query mentions a specific physician by name; omit otherwise.
- For trend queries (e.g. Rx over time), use type 'chart'
- For single key metrics (e.g. "how many calls"), use type 'stat'
- For lists and mixed data, use type 'table'
- When the user asks for "market share" (not raw volume), compute percentage using a window function: ROUND(SUM(PRESCRIPTIONS_WRITTEN) * 100.0 / SUM(SUM(PRESCRIPTIONS_WRITTEN)) OVER (PARTITION BY FRIDAY_WEEK_ENDING_DATE), 1) AS MARKET_SHARE_PCT. Use MARKET_SHARE_PCT as the yKey label "Market Share (%)".

Database schema:
${SCHEMA_BLOCK}
`;

        const sqlGenResp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: query }],
        });

        const rawJson = (sqlGenResp.content[0] as { text: string }).text.trim();
        let parsed: {
          type: 'table' | 'chart' | 'stat';
          sql: string;
          chartConfig?: { xKey: string; yKeys: { key: string; label: string }[]; seriesKey?: string; title: string };
          statConfig?: { valueKey: string; label: string; trendKey?: string };
          physicianNameMentioned?: string;
        };

        try {
          // Strip markdown code fences if present
          const clean = rawJson
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '');
          parsed = JSON.parse(clean);
        } catch {
          send({ type: 'error', message: 'Failed to parse SQL plan from AI.' });
          send({ type: 'done' });
          controller.close();
          return;
        }

        let sql = (parsed.sql ?? '').trim();

        // ── Step 2: Validate SQL ────────────────────────────────────────────
        if (UNSAFE_SQL.test(sql.toUpperCase())) {
          send({ type: 'error', message: 'Unsafe query blocked.' });
          send({ type: 'done' });
          controller.close();
          return;
        }

        // Check only allowed tables are referenced.
        // Strip parenthetical content first so that SQL functions containing FROM
        // (e.g. EXTRACT(DAY FROM col), DATEADD(DAY, -14, CURRENT_DATE)) are not
        // misidentified as table references.
        const upperSql = sql.toUpperCase();
        let strippedSql = '';
        let parenDepth = 0;
        for (const ch of upperSql) {
          if (ch === '(') { parenDepth++; strippedSql += ' '; }
          else if (ch === ')') { parenDepth = Math.max(0, parenDepth - 1); strippedSql += ' '; }
          else { strippedSql += parenDepth === 0 ? ch : ' '; }
        }
        const tablePattern = /(?:FROM|JOIN)\s+([\w.]+)/g;
        let tableMatch: RegExpExecArray | null;
        while ((tableMatch = tablePattern.exec(strippedSql)) !== null) {
          const tableName = tableMatch[1].split('.').pop() ?? '';
          if (tableName && !ALLOWED_TABLES.includes(tableName)) {
            send({ type: 'error', message: `Query references disallowed table: ${tableName}` });
            send({ type: 'done' });
            controller.close();
            return;
          }
        }

        // Append LIMIT if missing — 500 for charts (multi-row trend data), 50 otherwise
        if (!/LIMIT\s+\d+/i.test(sql)) {
          const fallbackLimit = parsed.type === 'chart' ? 500 : 50;
          sql = sql.replace(/;?\s*$/, '') + ` LIMIT ${fallbackLimit}`;
        }

        // ── Step 3: Execute SQL ─────────────────────────────────────────────
        send({ type: 'status', message: 'Running query...' });

        let rows: any[] = [];
        try {
          const sf = getSnowflakeClient();
          rows = await sf.executeQuery(sql);
        } catch (err: any) {
          send({ type: 'error', message: `Query failed: ${err?.message ?? 'Unknown error'}` });
          send({ type: 'done' });
          controller.close();
          return;
        }

        // ── Step 4: Disambiguation ──────────────────────────────────────────
        if (rows.length === 0 && parsed.physicianNameMentioned) {
          try {
            const sf = getSnowflakeClient();
            const allPhysicians = await sf.queryAllPhysicians();
            const target = parsed.physicianNameMentioned.toLowerCase();
            const targetSoundex = soundex(target);

            const scored = allPhysicians
              .filter((p: any) => p.PHYSICIAN_LAST_NAME)
              .map((p: any) => {
                const lastName = (p.PHYSICIAN_LAST_NAME as string).toLowerCase();
                const sdxMatch = soundex(lastName) === targetSoundex;
                const dist = levenshtein(target, lastName);
                return { p, sdxMatch, dist };
              })
              .filter(({ sdxMatch, dist }: { sdxMatch: boolean; dist: number }) => sdxMatch || dist <= 3)
              .sort((a: { dist: number }, b: { dist: number }) => a.dist - b.dist)
              .slice(0, 5);

            if (scored.length > 0) {
              const candidates = scored.map(({ p }: { p: any }) => ({
                physicianId: p.PHYSICIAN_ID,
                firstName: p.PHYSICIAN_FIRST_NAME,
                lastName: p.PHYSICIAN_LAST_NAME,
                specialty: p.PHYSICIAN_SPECIALTY,
                city: p.PHYSICIAN_CITY,
              }));
              send({ type: 'disambiguate', candidates, originalQuery: query });
              send({ type: 'done' });
              controller.close();
              return;
            }
          } catch { /* fall through to empty result */ }
        }

        // Emit data event
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        send({
          type: 'data',
          outputType: parsed.type,
          columns,
          rows,
          chartConfig: parsed.chartConfig ?? null,
          statConfig: parsed.statConfig ?? null,
        });

        // ── Step 5: Narrative ───────────────────────────────────────────────
        const narrativeStream = anthropic.messages.stream({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: 'You are a concise data analyst. Write 2-3 sentences summarising the key insight from these query results. Be specific — cite numbers. For stat queries, mention the trend direction.',
          messages: [{
            role: 'user',
            content: JSON.stringify({ query, rows: rows.slice(0, 10) }),
          }],
        });

        for await (const chunk of narrativeStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            send({ type: 'token', text: chunk.delta.text });
          }
        }

      } catch (err: any) {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: 'error', message: err?.message ?? 'Unexpected error' })}\n\n`
            )
          );
        } catch { /* ignored */ }
      }

      try {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        );
        controller.close();
      } catch { /* client already disconnected */ }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
