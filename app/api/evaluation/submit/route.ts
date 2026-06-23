import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';
import { checkRateLimit, rateLimitResponse, AI_HEAVY_LIMIT } from '@/lib/rate-limit';
import Anthropic from '@anthropic-ai/sdk';

const RUBRIC_VERSION = 'v2.1.0';
const MODEL          = 'claude-haiku-4-5-20251001';

// ── Receptivity label ─────────────────────────────────────────────────────────
function receptivityLabel(segment: string, brand1Share: number): string {
  if (segment === 'Clinical Innovator' && brand1Share >= 0.6) return 'Highly Receptive';
  if (segment === 'Clinical Innovator' && brand1Share  < 0.6) return 'Moderately Receptive';
  if (segment === 'Volume-Driven Pragmatist')                  return 'Neutral — values efficiency and access';
  if (segment === 'Patient-Centric Conservative')              return 'Resistant — prioritizes safety and proven track record';
  return 'Unknown';
}

// ── Evaluation prompt ─────────────────────────────────────────────────────────
function buildPrompt(opts: {
  segment: string;
  specialty: string;
  yearsInPractice: number;
  brand1SharePct: string;
  receptivity: string;
  transcript: string;
  fa: { confidence: number; nervousness: number; engagement: number; frameCount: number; summary: string; } | null;
}): string {
  const { segment, specialty, yearsInPractice, brand1SharePct, receptivity, transcript, fa } = opts;

  const faBlock = fa
    ? `fa_confidence = ${fa.confidence}, fa_nervousness = ${fa.nervousness}, fa_engagement = ${fa.engagement}, fa_frame_count = ${fa.frameCount}`
    : `fa_confidence = NULL, fa_nervousness = NULL, fa_engagement = NULL, fa_frame_count = NULL`;

  return `IMPORTANT: Your entire response must be a single valid JSON object. Output ONLY the JSON. Do not write anything before the opening { or after the closing }. No markdown, no code fences, no explanation, no preamble.

You are a pharmaceutical sales training evaluator. Analyze the transcript below and return the JSON evaluation object described at the end of this prompt.

## PHYSICIAN CONTEXT
- Segment: ${segment}
- Specialty: ${specialty}
- Years in Practice: ${yearsInPractice}
- Brand 1 Rx Share: ${brand1SharePct}%
- Receptivity Profile: ${receptivity}

---

## STEP 1: MINIMUM ENGAGEMENT THRESHOLD (Pre-Scoring Gate)

Before scoring ANY dimension, count the following from the transcript:

CHECK 1 — CLINICAL CLAIMS: Did the rep make at least ONE product-specific clinical claim?
  A clinical claim includes: efficacy data, safety data, mechanism of action, clinical trial results, registry data, hemodynamic data, or outcomes data tied to the product.
  Vague statements like "our product is great" do NOT count.

CHECK 2 — QUESTION ENGAGEMENT: Did the rep engage substantively with at least ONE physician question or concern?
  Substantive engagement means providing data, evidence, or a reasoned explanation — not just "great question" or deflecting.

CHECK 3 — CONVERSATIONAL DEPTH: Did the rep speak for more than 3 conversational turns beyond initial greetings?
  Count only turns where the rep provided product-related or clinical content.

CHECK 4 — PRODUCT IDENTIFICATION: Did the rep mention the product or brand by name at least once?

ENGAGEMENT GATE RULES:
- All 4 pass → engagement_gate = "full" → normal scoring
- 2–3 pass → engagement_gate = "partial" → Compliance capped at 5, Tone & Rapport capped at 5, others normal
- 0–1 pass → engagement_gate = "insufficient" → ALL dimensions capped at 3, field_readiness = "Not Ready" (override)

---

## STEP 2: SCORE EACH DIMENSION

### Dimension 1: CLINICAL KNOWLEDGE (Weight: 25%)

Mark each TRUE only if there is clear evidence in the transcript:

  C1: Cited a peer-reviewed publication by name (journal, author, or year)
  C2: Cited a major medical conference (ACC, TCT, CRT, AHA, ESC, etc.)
  C3: Used specific quantitative data points — actual numbers, not vague claims
      Qualifying: "5.3% vs 9.4%", "mean gradient 9.2 mmHg", "10,000 patients"
      NOT qualifying: "significantly better", "much lower rates", "improved outcomes"
  C4: Referenced study design or methodology (propensity-matched, randomized, registry name, sample size)
  C5: Demonstrated mechanism-level understanding (MoA, tissue technology, device design features)
  C6: Correctly distinguished evidence levels — did NOT equate registry data with RCT, or preclinical with clinical
  C7: Connected data to clinical relevance — explained WHY a data point matters for patient outcomes
  C8: Introduced specific patient scenarios, clinical use cases, or subgroup analyses with case-level specificity WITHOUT being prompted

SCORING:
  raw_score = round((criteria_met / 8) * 10), minimum 1
  DEFAULT: If zero clinical claims → score = 1, flag "No clinical content delivered."

---

### Dimension 2: OBJECTION HANDLING (Weight: 25%)

Identify ALL objections raised by the physician. For each, evaluate 4 layers:
  LAYER 1 — ACKNOWLEDGE: Validated concern directly without being defensive
  LAYER 2 — REFRAME: Redirected to available evidence without dodging core concern
  LAYER 3 — EVIDENCE: Supported reframe with specific data points (not generalities)
  LAYER 4 — QUALIFY: Stated limitations and avoided overclaiming

SCORING:
  base_score = 2 * (average layers present across all objections) → 0–8
  Bonus +1 if rep used structured argumentation (built from weaker to stronger evidence)
  Bonus +1 if rep converted ANY objection into engagement opportunity (follow-up, peer discussion, registry)
  Cap at 10

SPECIAL CASES:
  - No objections AND rep proactively addressed 0 concerns → score = 4
  - No objections AND rep proactively addressed 1+ concerns → score = 5–8 based on depth:
      1 concern with no data → 5, 1 concern with data → 6, 2+ concerns → 7, 2+ with structured argument → 8
  - Objections raised AND rep ignored/deflected ALL → score = 1
  DEFAULT: engagement_gate = "insufficient" → score = 1

---

### Dimension 3: COMPLIANCE (Weight: 15%)

Check as PASS or FAIL:
  K1: No off-label efficacy or indication claims
  K2: No unsupported outcome claims
  K3: Evidence levels clearly labeled — no registry equated with RCT, no preclinical with clinical
  K4: No false or misleading competitive claims
  K5: Appropriate qualifiers for emerging or limited evidence
  K6: No cherry-picked data — presented both efficacy AND safety when relevant

SCORING:
  Base = 10, each FAIL = -1.5
  All 6 pass = 9 (compliance is minimum expectation, not achievement)
  Score = 10 ONLY if rep proactively disclosed a specific adverse event or limitation by clinical term with incidence rate — not a generic disclaimer
  Any CRITICAL violation (off-label promotion, fabricated data, misleading safety comparison) = score ≤ 2

CROSS-DIMENSION CONSTRAINT: Compliance score ≤ (Clinical Knowledge score + 2)
  Example: CK = 1 → compliance caps at 3

---

### Dimension 4: TONE & RAPPORT (Weight: 15%)

Check 8 behaviors:
  T1: Used professional, appropriate language throughout
  T2: Demonstrated confidence without arrogance — assertive but not dismissive
  T3: Asked about the physician's practice, patients, case volume, or clinical challenges
  T4: Acknowledged physician expertise or specialty directly
  T5: Adapted messaging to physician segment (data-heavy for Clinical Innovator, safety-focused for Patient-Centric Conservative, efficiency/access for Volume-Driven Pragmatist)
  T6: Created conversational moments — asked questions, enabled back-and-forth dialogue
  T7: Listened and built on physician responses — referenced what physician said
  T8: Established a clear call agenda or purpose within the first 2 turns (e.g., "Today I'd like to share the 12-month registry data and get your thoughts on a specific patient type")

SCORING:
  Sub-group A — Clinical Professionalism (T1, T2, T7): professionalism_score = (criteria_met / 3) * 10
  Sub-group B — Rapport & Personalization (T3, T4, T5, T6, T8): rapport_score = (criteria_met / 5) * 10
  Final = round((professionalism_score * 0.4) + (rapport_score * 0.6))

CROSS-DIMENSION CONSTRAINT: If rep never discussed product or clinical data → cap at 4
DEFAULT: engagement_gate = "insufficient" → cap at 3

---

### Dimension 5: CLOSING (Weight: 20%)

Check 6 behaviors:
  L1: Rep-initiated summary of key value points at or near end
  L2: Asked a commitment question ("Would you be open to...", "Can I set up...")
  L3: Proposed a specific, concrete next step (meeting, peer call, case observation, lunch-and-learn)
  L4: Offered a tangible resource (reprint, case study, clinical paper, samples)
  L5: Connected close to urgency or practice relevance
  L6: Established a follow-up timeline ("I'll send that this week", "Can we reconnect after your next case?")

SCORING:
  active_closing_score = (behaviors_present / 6) * 10
  Physician self-close credit (0–5):
    5 = physician expressed strong specific intent to use/increase use
    3 = moderate or conditional interest
    1 = mildly positive but noncommittal
    0 = did not self-close
  final_score = round((active_closing_score + content_closing_credit) / 2)
  PENALTY: If physician is receptive (Clinical Innovator OR brand1_rx_share >= 0.5) AND active_closing_score ≤ 2 → subtract 1 (floor 1)

CROSS-DIMENSION CONSTRAINT: CK = 1 → closing = 1
DEFAULT: engagement_gate = "insufficient" → score = 1

---

## STEP 3: CALCULATE OVERALL SCORE

overall_score = (clinical * 0.25) + (objection * 0.25) + (compliance * 0.15) + (tone * 0.15) + (closing * 0.20)

ADJUSTMENTS:
  - Physician receptivity = "Highly Receptive" or "Moderately Receptive" AND closing ≤ 5 → subtract 0.3
  - Physician receptivity = "Resistant" AND objection_handling ≥ 8 → add 0.3
  Round to 1 decimal place

---

## STEP 4: DETERMINE FIELD READINESS

| Score | Status |
|-------|--------|
| ≥ 8.0 | Field Ready |
| 6.5–7.9 | Field Ready with coaching |
| 5.0–6.4 | Needs Practice |
| < 5.0 | Not Ready |

OVERRIDE RULES (take precedence over score):
  - ANY dimension ≤ 3 → "Not Ready"
  - Compliance ≤ 4 → "Not Ready"
  - Clinical Knowledge ≤ 4 → minimum "Needs Practice"
  - engagement_gate = "insufficient" → "Not Ready"

---

## STEP 4B: NON-VERBAL PRESENCE ASSESSMENT (Facial Analysis Modifier)

Input values (0–10 scale): ${faBlock}

${fa && fa.frameCount >= 3 ? `Apply ONLY because fa_frame_count (${fa.frameCount}) >= 3.

Sub-score P1 (Confidence from fa_confidence = ${fa.confidence}):
  >= 8 → 10, >= 6.5 → 8, >= 5 → 6, >= 3.5 → 4, else → 2

Sub-score P2 (Engagement from fa_engagement = ${fa.engagement}):
  >= 8 → 10, >= 6.5 → 8, >= 5 → 6, >= 3.5 → 4, else → 2

Nervousness adjustment from fa_nervousness = ${fa.nervousness}:
  <= 2 → 0.0, <= 4 → -0.5, <= 6 → -1.0, > 6 → -1.5

nv_raw = CLAMP(round((P1 * 0.5) + (P2 * 0.5)) + nervousness_adjustment, 1, 10)
nv_modifier = (nv_raw - 5) * 0.05  [range: nv_raw=10 → +0.25, nv_raw=5 → 0.0, nv_raw=1 → -0.2]

Cross-check:
  If tone_rapport >= 8 AND nv_raw <= 3 → nv_modifier = min(nv_modifier, -0.1), set cross_check_note
  If tone_rapport <= 4 AND nv_raw >= 8 → nv_modifier = max(nv_modifier, 0.0), set cross_check_note

Apply nv_modifier to overall_score AFTER Step 3 calculation. CLAMP result to [1.0, 10.0].
Set non_verbal_presence.status = "scored"` : `fa_frame_count is NULL or < 3 — skip non-verbal scoring.
Set non_verbal_presence.status = "insufficient_data", all sub-fields null, nv_modifier = 0.`}

---

## STEP 5: OUTPUT SCHEMA

Return ONLY this JSON. No text before {. No text after }.

{
  "engagement_gate": "<full | partial | insufficient>",
  "engagement_checks": {
    "clinical_claims_made": <int>,
    "questions_substantively_addressed": <int>,
    "rep_content_turns": <int>,
    "product_mentioned_by_name": <boolean>
  },
  "scores": {
    "clinical_knowledge": {
      "score": <int 1-10>,
      "criteria_met": ["C1","C3"],
      "criteria_missed": ["C2","C4","C5","C6","C7","C8"],
      "rationale": "<2-3 sentences with specific transcript references>"
    },
    "objection_handling": {
      "score": <int 1-10>,
      "objections_identified": <int>,
      "objection_details": [
        {
          "summary": "<brief description>",
          "acknowledge": <boolean>,
          "reframe": <boolean>,
          "evidence": <boolean>,
          "qualify": <boolean>
        }
      ],
      "bonuses_applied": [],
      "rationale": "<2-3 sentences>"
    },
    "compliance": {
      "score": <int 1-10>,
      "checks_passed": ["K1","K2","K3","K4"],
      "checks_failed": [],
      "critical_violation": false,
      "cross_dimension_cap_applied": false,
      "rationale": "<2-3 sentences>"
    },
    "tone_rapport": {
      "score": <int 1-10>,
      "professionalism_sub_score": <float>,
      "rapport_sub_score": <float>,
      "behaviors_present": ["T1","T2"],
      "behaviors_absent": ["T3","T4","T5","T6","T7","T8"],
      "rationale": "<2-3 sentences>"
    },
    "closing": {
      "score": <int 1-10>,
      "active_closing_behaviors": [],
      "active_closing_score": <float>,
      "physician_self_closed": false,
      "content_closing_credit": <int 0-5>,
      "receptivity_penalty_applied": false,
      "rationale": "<2-3 sentences>"
    }
  },
  "non_verbal_presence": {
    "status": "<scored | insufficient_data>",
    "frame_count": <int or null>,
    "P1_confidence_sub": <int or null>,
    "P2_engagement_sub": <int or null>,
    "nervousness_adjustment": <float or null>,
    "nv_raw_score": <int or null>,
    "nv_modifier": <float or null>,
    "cross_check_note": <string or null>
  },
  "overall_score": <float 1 decimal — AFTER nv_modifier applied>,
  "adjustment_applied": <string or null>,
  "field_readiness": "<Field Ready | Field Ready with coaching | Needs Practice | Not Ready>",
  "override_triggered": <string or null>,
  "strengths": [
    "<strength 1 with transcript reference>",
    "<strength 2 with transcript reference>"
  ],
  "critical_gaps": [
    {
      "gap": "<what was missing>",
      "example_fix": "<exact quote of what the rep should have said>",
      "score_impact": "<e.g. Closing: 1 → 6 potential>"
    }
  ],
  "coaching_priority": "<single most impactful improvement area, or null if Field Ready >= 8.0>",
  "recommendations": [
    "<actionable recommendation 1>",
    "<actionable recommendation 2>",
    "<actionable recommendation 3>"
  ]
}

## TRANSCRIPT TO EVALUATE:
${transcript}`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const rl = checkRateLimit(`eval:${session.userId}`, AI_HEAVY_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs) as any;

  const body = await request.json();
  const { physicianId, transcript, facialAnalysis } = body as {
    physicianId: string;
    transcript: string;
    facialAnalysis?: { confidence: number; nervousness: number; engagement: number; frameCount: number; summary: string; observations: string[]; } | null;
  };

  if (!physicianId || !transcript?.trim()) {
    return new Response(JSON.stringify({ error: 'physicianId and transcript are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), { status: 500 });

  const sf = getSnowflakeClient();
  const startMs = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        // ── 1. Physician context ─────────────────────────────────────────────
        const [physicianRows, rxRows] = await Promise.all([
          sf.executeQuery(`
            SELECT
              pc.PHYSICIAN_FIRST_NAME, pc.PHYSICIAN_LAST_NAME,
              pc.PHYSICIAN_SPECIALTY, pc.PHYSICIAN_YEARS_IN_PRACTICE,
              ps.SEGMENT_NAME
            FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS pc
            LEFT JOIN CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_SEGMENT ps
              ON pc.PHYSICIAN_ID = ps.PHYSICIAN_ID
            WHERE pc.PHYSICIAN_ID = :1
          `, { '1': { type: 'TEXT', value: physicianId } }),
          sf.executeQuery(`
            SELECT BRAND, PRESCRIPTIONS_WRITTEN
            FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_RX
            WHERE PHYSICIAN_ID = :1
          `, { '1': { type: 'TEXT', value: physicianId } }),
        ]);

        const p = (physicianRows as any[])[0] ?? {};
        const totalRx = (rxRows as any[]).reduce((s, r) => s + Number(r.PRESCRIPTIONS_WRITTEN), 0) || 1;
        const brand1Rx = (rxRows as any[]).filter(r => r.BRAND === 'Brand 1').reduce((s, r) => s + Number(r.PRESCRIPTIONS_WRITTEN), 0);
        const brand1Share = brand1Rx / totalRx;
        const brand1SharePct = (brand1Share * 100).toFixed(1);
        const segment  = p.SEGMENT_NAME ?? 'Unknown';
        const specialty = p.PHYSICIAN_SPECIALTY ?? 'Unknown';
        const years = Number(p.PHYSICIAN_YEARS_IN_PRACTICE ?? 0);

        enqueue({ type: 'status', message: 'Analysing session…' });

        // ── 2. Stream Claude Haiku ───────────────────────────────────────────
        const anthropic = new Anthropic({ apiKey });
        const prompt = buildPrompt({
          segment, specialty, yearsInPractice: years, brand1SharePct,
          receptivity: receptivityLabel(segment, brand1Share),
          transcript,
          fa: facialAnalysis
            ? { confidence: facialAnalysis.confidence, nervousness: facialAnalysis.nervousness, engagement: facialAnalysis.engagement, frameCount: facialAnalysis.frameCount, summary: facialAnalysis.summary }
            : null,
        });

        let fullText = '';
        const msgStream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        });

        for await (const event of msgStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            enqueue({ type: 'token', text: event.delta.text });
          }
        }

        // ── 3. Parse result ──────────────────────────────────────────────────
        const match = fullText.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON found in model response');
        const result = JSON.parse(match[0]);

        enqueue({ type: 'result', data: result });

        // ── 4. Persist to Snowflake ──────────────────────────────────────────
        const durationMs = Date.now() - startMs;
        await sf.insertEvalResult({
          physicianId,
          physicianFirstName: p.PHYSICIAN_FIRST_NAME ?? '',
          physicianLastName:  p.PHYSICIAN_LAST_NAME  ?? '',
          physicianSpecialty: p.PHYSICIAN_SPECIALTY  ?? '',
          segmentName: segment,
          transcript,
          result,
          appUserId: session.userId,
          facialAnalysis: facialAnalysis ?? null,
          rubricVersion: RUBRIC_VERSION,
          modelUsed: MODEL,
          evalDurationMs: durationMs,
        });

        enqueue({ type: 'done' });

      } catch (err: any) {
        console.error('[eval/submit] error:', err?.message);
        enqueue({ type: 'error', message: err?.message ?? 'Evaluation failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}
