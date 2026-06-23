# PitchMD — To-Do

---

## [x] Remove ElevenLabs TTS entirely

Remove ElevenLabs from all aspects of the product — we are using browser TTS only.

- Delete `app/api/tts/route.ts`
- Delete `lib/elevenlabs.ts` (or strip it down to just `parseEmotion` + `stopCurrentAudio`, moving those to a smaller util)
- Remove `speakText`'s ElevenLabs branch — the function should call `speakWithBrowser` directly
- Remove `NEXT_PUBLIC_FEATURE_TTS` env var references from all files
- Remove `ELEVENLABS_API_KEY` from `.env.local`, `.env.example`, any Vercel env config docs
- Remove `voiceId` / `VOICE_MODEL` parsing from `parseEmotion` and anywhere it's consumed in `chat-interface.tsx`
- Audit `package.json` for any ElevenLabs SDK dependency and remove it
- Search codebase for any remaining `elevenlabs`, `voiceId`, `voice_model`, `VOICE_MODEL` references

---

## [ ] Graceful speech continuation after auto-submit

**Context**: The rep often pauses mid-sentence, which triggers the 3-second auto-submit. They then continue talking — but the AI has already started generating a response to the incomplete input. This produces a broken conversational loop.

**Desired behaviour**: After auto-submit, monitor the mic for a further **5 seconds**. If new speech is detected during that window:
1. Interrupt / cancel the in-flight AI response (stop SSE stream, stop TTS).
2. Concatenate the continuation transcript with the originally submitted text.
3. Re-submit the combined text as a single coherent rep turn.
4. Generate a fresh AI response from the complete input.

**Implementation notes**:
- `AudioInput` already has `onAutoSubmit` and `onTranscript` callbacks — add an `onContinuation?: (text: string) => void` prop that fires if a new transcript arrives within 5 s of auto-submit.
- Keep the mic running (don't stop it) for the 5-second window after auto-submit; only stop it once the window closes without new speech or the AI starts speaking.
- In `chat-interface.tsx`, handle `onContinuation` by: calling `stopCurrentAudio()`, aborting the fetch/SSE reader, patching the last rep message content, and re-invoking the send handler with the combined text.
- The 5-second window should be cancellable immediately once `avatarSpeaking` becomes `true` (if the AI responds very fast before the window closes, drop the continuation path).

---

## [ ] Link personas to call notes and to-do list table

Each physician persona should be associated with the rep's call notes and to-do items for that physician — so notes and tasks created during a session surface in the context of the right persona, and the rep can review them before the next call.

- Identify the data model for personas (Snowflake table / field that holds physician identity)
- Add a `physician_id` / `persona_id` foreign key to the call notes table and the to-do list table
- Update the session write path to stamp `physician_id` on every note and task created during that session
- Update the UI: when a rep selects a persona on the physician selection screen, surface that physician's past call notes and open to-do items in the engagement playbook panel before the session starts

---

## [ ] Include recent engagement history with the physician in the engagement playbook

Before a session starts, the engagement playbook panel should show a timeline of recent interactions with the selected physician — previous call summaries, dates, outcomes, and any open follow-up items — so the rep walks in with full context.

- Query Snowflake for past sessions keyed on `physician_id`, ordered by date descending, limited to last N sessions (start with 5)
- Surface in the playbook panel: date, session duration, brief AI-generated summary of what was discussed, outcome tag (e.g. "interested", "requested follow-up", "neutral")
- Link each history entry to its to-do items so the rep can see what was promised and whether it was delivered
- This data should be loaded when the physician is selected (before the session starts) — not during the roleplay itself

---

## [ ] Actionable to-do list: auto-populate follow-ups with pre-packaged supporting documents

**Context**: When a physician asks a deep medical or scientific question during the roleplay (e.g. "How does this asset affect patients over 65?"), the rep typically promises to follow up with supporting data. Today, that promise is captured as a plain text to-do item. The goal is to close the loop automatically by attaching the exact document the rep should send.

**Desired behaviour**:
1. During post-session evaluation, detect to-do items that represent a scientific or medical follow-up commitment (e.g. the physician asked a clinical question the rep deferred).
2. Route each such item to a `CortexRAGAgent` call against the internal medical knowledge base (compliance documents, clinical trial data sheets, whitepapers).
3. Retrieve the most relevant chunk(s) and the source document(s).
4. Populate the to-do item with: the plain-text task description, the recommended document(s) to send (PDF name + download link), and the specific passage that answers the physician's question.

**Implementation notes**:
- Trigger this enrichment step at end-of-session, after the evaluation panel is generated — not in real time during the roleplay
- Classify a to-do item as "scientific follow-up" using a lightweight heuristic or a quick Haiku call before hitting RAG, to avoid unnecessary Snowflake queries for simple admin tasks
- Store the enriched to-do (document references, passage excerpt) in Snowflake alongside the plain-text task
- Display in the to-do list UI: collapsible "Suggested resource" section under each enriched item, with the document name, a snippet of the relevant passage, and a download/view button

---

## [x] Data-driven dynamic personas — multi-agent physician profiling pipeline

**Context**: Today's physician personas are static archetypes. This feature replaces them with personas generated in real time from actual physician data, producing objections and attitudes that reflect the specific HCP the rep is about to visit.

### Step 1 — Context gathering (TextToSQLAgent + CortexRAGAgent)

Two agents run in parallel before the session starts:

**TextToSQLAgent** — queries Snowflake for structured physician data:
- Local prescription volume for the brand (and key competitors), trended over time
- Competitive market share shifts in the physician's geography / specialty
- Past touchpoint history: call dates, outcomes, open follow-ups, samples dispensed

**CortexRAGAgent** — scans unstructured knowledge:
- Recent scientific journal publications or clinical abstracts authored or cited by the physician
- Any internal medical affairs notes or MSL interaction records stored in the compliance doc corpus

Both agents return structured summaries; neither feeds raw tables directly to the LLM.

### Step 2 — Stance engine (SnowparkInferenceAgent)

A Snowpark Python UDF runs a profile calculation on the gathered data and outputs a set of **numeric behavioral vectors** — keeping prompt size bounded and LLM behavior deterministic:

| Vector | Description |
|---|---|
| `adoption_propensity` | 0–1 scale: slow/skeptical adopter → eager clinical trial advocate |
| `scientific_sensitivity` | 0–1 scale: prefers macro-efficacy (p-values, OS data) → prefers localized safety / AE rates |
| `brand_loyalty` | current share-of-voice for this brand vs. competitive baseline |
| `engagement_recency` | days since last meaningful touchpoint (drives warmth/coldness of opening) |
| `data_fluency` | likelihood to probe statistical methodology vs. accept headline numbers |

The UDF writes these vectors to a Snowflake table keyed on `physician_id`; the orchestrator reads them at session start.

### Step 3 — Dynamic persona injection

The orchestrator injects the processed vectors into the simulation system prompt as a compact numeric block — not as prose, to avoid prompt bloat:

```
[PHYSICIAN_PROFILE]
adoption_propensity: 0.22
scientific_sensitivity: 0.81
brand_loyalty: 0.34
engagement_recency: 47
data_fluency: 0.74
```

The persona prompt instructs the LLM to map these vectors to behavioral traits on the fly:
- Low `adoption_propensity` + high `scientific_sensitivity` → physician surfaces AE-rate objections early, asks for head-to-head trial data
- Low `brand_loyalty` + low `engagement_recency` → cold open, skeptical of brand claims, references a competitor by name
- High `data_fluency` → challenges p-value methodology, asks about confidence intervals and subgroup analyses

### Implementation notes

- The parallel agent calls (Step 1) should resolve before the physician selection screen transitions to the consent/camera step — target < 3 s
- The Snowpark UDF (Step 2) can be pre-computed nightly for all active physicians and cached in Snowflake; re-compute on demand only when fresh touchpoint data arrives
- The vector block in the prompt is small (< 50 tokens) — it must never expand into prose summaries inside the system prompt itself; prose belongs in the engagement playbook panel for the rep to read, not in the AI's instruction set
- Add a `persona_source: 'dynamic' | 'static'` flag to session metadata in Snowflake so evaluation data can distinguish AI-generated personas from hand-authored archetypes
- The UI should surface a "Based on real data" badge on the physician card when a dynamic profile is available, and show which data signals drove the persona (adoption tier, last call date, etc.) in the engagement playbook panel

---

## [ ] Enhanced post-call loopback — transcript-driven action pipeline

**Context**: After a session ends the transcript is a rich source of structured commitments (samples, deadlines, follow-ups, scientific questions). Today those are surfaced as plain text notes. This feature parses the transcript with a multi-agent pipeline and converts every commitment into a fully actioned, pre-packaged dashboard card — eliminating post-call admin work.

### Part A — Actionable to-do generation (TextToSQLAgent)

The orchestrator passes the full transcript to a TextToSQLAgent that extracts structured commitments and writes them directly to Snowflake:

**CRM interaction log**
- Auto-populate a standardised interaction log row: physician, date, duration, topics discussed, objections raised, outcome tag
- Written to the CRM log table at session end without rep input

**Sample fulfillment requests**
- Detect phrases like "wants 3 sample kits", "I'll send two starter packs", "requested samples"
- Extract: quantity, product, physician/delivery address, implied urgency
- Write a row directly to the Snowflake sampling table, triggering the existing dispatch pipeline automatically
- Surface in the UI as a "Sample request submitted" confirmation card with expected dispatch date

**Time-bound reminders**
- Detect deadline phrases: "by Thursday", "before the end of the month", "next week", "within 48 hours"
- Resolve relative dates to absolute timestamps at parse time (relative to session date)
- Write to the notification/reminder table with `physician_id`, `task_description`, `due_at` (absolute UTC)
- Surface in the app as a scheduled push notification and a to-do card with a countdown

### Part B — Context-aware asset pre-attaching (CortexRAGAgent)

For every unstructured scientific or follow-up commitment in the transcript, the CortexRAGAgent runs a semantic search against the medical whitepaper / compliance document corpus and attaches the most relevant asset before the rep ever sees the to-do item.

**Detection**: classify transcript segments as scientific follow-up commitments using a Haiku call — e.g. "she asked about efficacy in patients over 65", "he wanted the head-to-head trial data", "requested the mechanism of action deck"

**RAG retrieval**: run a Cortex vector search for each detected commitment; return top-1 or top-2 documents with the most relevant passage excerpt

**Dashboard card output** — each enriched to-do renders as a structured card:

```
To-Do:        Send Clinical Trial Efficacy Metrics (Aged 65+) to Dr. Patel
Auto-Asset:   Asset_Alpha_Geriatric_Cohort_2025.pdf  [View] [Attach to email]
Key passage:  "In the geriatric cohort (n=312, age ≥65) ORR was 78% vs 43% placebo..."
Sample status: 3 Sample Kits — scheduled for courier routing
Deadline:     Thursday 19 Jun 2026
[Draft follow-up email]
```

**Draft email action**: clicking "Draft follow-up email" pre-populates an email composer with: physician name/address, a templated body referencing the conversation, the RAG-retrieved PDF attached, and the deadline in the subject line — rep only needs to review and send

### Implementation notes

- The entire pipeline (Parts A + B) runs asynchronously after the session ends — it must not block the evaluation panel from loading
- TextToSQLAgent and CortexRAGAgent should run in parallel where possible; CRM log write and sample fulfillment write are independent of RAG retrieval
- Deadline resolution must happen server-side at parse time using the session's `created_at` timestamp — never trust client-side date resolution
- Store the enriched card payload (task text, asset name, asset chunk excerpt, asset download URL, due_at, sample_status) as a JSON blob in the to-do table alongside the plain-text fallback, so the UI can degrade gracefully if RAG retrieval finds nothing
- The "Draft follow-up email" action is UI-only in the first iteration (mailto: or clipboard copy); a full email API integration (SendGrid / Outlook) is a follow-on task
- Add a `pipeline_version` field to to-do rows so future model changes can be evaluated against historical output quality

---

## [x] Move post-session evaluation from Snowflake Cortex to the webapp

**Context**: The current evaluation pipeline runs entirely inside Snowflake Cortex (LLM inference via Cortex Complete). This introduces latency, limits prompt flexibility, and makes iterating on evaluation rubrics slow — every change requires a Snowflake-side deployment. Moving evaluation to the Next.js API layer using Claude directly gives full control over prompts, streaming, and output structure.

- Replace the Snowflake Cortex evaluation call with a direct Claude API call from a new route handler (e.g. `app/api/roleplay/evaluate/route.ts`)
- Pass the full session transcript and captured frames (already available in `capturedFramesRef`) to the route; run scoring entirely in the webapp using `claude-haiku-4-5-20251001` (fast + cheap for structured scoring)
- Stream the evaluation response back to the client using SSE so the evaluation panel populates progressively rather than waiting for the full response — improves perceived speed significantly
- Define the evaluation rubric as a TypeScript object in the route (not a Snowflake prompt template) so it can be versioned in git and iterated without a Snowflake deployment
- Write the final scored result to Snowflake at the end (for compliance logging and history) but do not depend on Snowflake for the inference step itself
- Remove the Snowflake Cortex Complete call from the existing evaluation path; confirm no other route depends on it before deleting

---

## [x] Territory Intelligence — natural language data query with adaptive output

**Context**: Reps need to interrogate their territory data without leaving the app or writing SQL. A conversational interface on the home screen lets them ask questions in plain English (or via voice) and receive adaptive output — tables for lists, line charts + narrative for trends, and stat cards for single-metric answers. The interface reuses the same pill-shaped chat prompt from the roleplay screen, surfaced via a sliding drawer from the home screen.

---

### UX / Interaction Design

**Entry point**: A `?` button (rounded, muted) sits below the bento card grid on the home screen. Clicking it triggers a slide-up drawer animation — the bento cards translate upward just enough (≈60–70% of viewport height) to reveal the query interface beneath, with the top edge of the cards still peeking above the drawer header. A down-arrow or `×` in the drawer header collapses it back.

**Input**: Same pill-shaped input used in the roleplay screen — text field on the left, circular submit button on the right, microphone (STT) button beside it. STT uses the existing Groq Whisper route with an extended vocabulary prompt that includes physician names from the rep's territory (in addition to brand names).

**Conversation history**: The drawer maintains a scrollable history of Q&A pairs above the input pill so the rep can scroll up to review previous answers in the same session. History is in-memory only (cleared on drawer close).

---

### Adaptive Output — Three Modes

The route returns `{ type, data, narrative, chartConfig? }`. The frontend renders based on `type`:

| `type` | When to use | Components rendered |
|---|---|---|
| `'table'` | List queries ("which physicians haven't I called in 2 weeks?") | Sortable table + narrative summary |
| `'chart'` | Trend queries ("how has Rx volume changed over the past 12 weeks?") | Line chart + data table + narrative |
| `'stat'` | Single-metric queries ("what's my market share this month?") | Large stat card with trend arrow + narrative |

The route (not the frontend) decides the output type — Claude Haiku classifies the query intent and sets `type` accordingly before executing the SQL.

---

### Backend — `app/api/intelligence/query/route.ts`

**Step 1 — Intent classification + SQL generation** (single Haiku call):

```typescript
// System prompt includes:
// 1. Allowed tables + full column list (schema block)
// 2. Rep's APP_USER_ID (all queries scoped to this user's territory)
// 3. Output type rules (table / chart / stat)
// 4. SQL safety rules: SELECT only, no subqueries on unrestricted tables, LIMIT 50 always

// Returns structured JSON:
{
  type: 'table' | 'chart' | 'stat',
  sql: 'SELECT ...',
  chartConfig?: { xKey: string, yKey: string, seriesKey?: string, title: string },
  statConfig?: { valueKey: string, label: string, trendKey?: string }
}
```

**Allowed tables** (read-only, scoped to rep's territory):
- `SYNTHETIC_PHYSICIAN_CHARS` — physician demographics, specialty, state
- `SYNTHETIC_PHYSICIAN_SEGMENT` — segment, attitudinal description
- `SYNTHETIC_RX` — weekly Rx by brand and physician
- `SYNTHETIC_ACTIVITY` — promotional touchpoints
- `SYNTHETIC_CALL_JOURNAL` — call notes (scoped to `APP_USER_ID`)
- `SYNTHETIC_LOOPBACK` — open tasks (scoped to `APP_USER_ID`)

**Step 2 — SQL execution**: run the generated SQL via `sf.executeQuery()`. All queries must include `AND APP_USER_ID = :repId` or `AND PHYSICIAN_ID IN (SELECT PHYSICIAN_ID FROM rep's territory)` as appropriate.

**Step 3 — Narrative generation** (second Haiku call, cheap): pass the query result rows to Haiku and ask for a 2–3 sentence plain-English summary. For stat cards, include the trend direction. For charts, highlight the most notable inflection point.

**Step 4 — Stream back** via SSE: emit `{ type: 'sql' }` (for debug), `{ type: 'data', rows, chartConfig, statConfig }`, `{ type: 'narrative', text }`, `{ type: 'done' }`.

---

### Frontend — `components/intelligence-drawer.tsx`

- `DrawerState`: `'closed' | 'open'`
- Slide-up animation: CSS `transform: translateY()` transition on the bento grid wrapper — translate up by `60vh` when open, `0` when closed. The drawer panel sits in a fixed-height container below the grid.
- Message list: `IntelligenceMessage[]` — each entry has `query`, `type`, `rows`, `chartConfig`, `statConfig`, `narrative`, `loading`
- On submit: append a loading message, POST to `/api/intelligence/query`, read SSE stream, update the message in place as data arrives
- Render per `type`:
  - `'table'` → `<DataTable>` (reuse existing table component) + narrative paragraph
  - `'chart'` → line chart via `recharts` `<LineChart>` (already in `package.json`) + `<DataTable>` collapsed by default + narrative
  - `'stat'` → large number with `↑`/`↓`/`→` trend indicator + narrative

**STT extension**: extend the Whisper vocabulary prompt in `app/api/stt/route.ts` to include physician last names from `SYNTHETIC_PHYSICIAN_CHARS` — cache alongside brand names with the same 10-minute TTL.

---

### Snowflake — no schema changes needed

All required tables already exist. No new columns or procedures required.

---

### Implementation notes

- SQL generation must be sandboxed: only `SELECT` statements, no `DROP`/`INSERT`/`UPDATE`/`DELETE`, no access to tables outside the allowed list. Validate with a regex before execution.
- LIMIT 50 is always appended by the route — never trust the model to include it.
- The drawer does not persist between sessions — history is in-memory only.
- If SQL generation fails or returns an unsafe query, return a friendly error message in the narrative field and set `type: 'error'`.
- **Physician name disambiguation popup**: when the STT transcript contains a name the SQL model cannot confidently match to a `PHYSICIAN_ID`, surface a plain fixed-div overlay (per CLAUDE.md rule 3 — no Radix Dialog) above the drawer message history. The popup shows a ranked shortlist of phonetically similar physicians from the rep's territory (max 5), each row displaying **name + specialty + city** to disambiguate same-sounding names. One tap selects the physician, substitutes their `PHYSICIAN_ID` into the original query, and re-runs automatically — the rep never touches the input field again. If zero phonetic matches are found (name was completely garbled by STT), fall back to showing a full searchable list of all territory physicians with a text filter input at the top of the popup.
- **Phonetic matching**: run Double Metaphone (or Soundex as a fallback) on the physician last name client-side against the physician list already loaded in the dashboard — no extra Snowflake round-trip. Use Levenshtein edit distance as a tiebreaker when multiple physicians share the same phonetic code. Run entirely in-memory; the physician list is already available from the home screen data fetch.
- **Disambiguation trigger**: the route signals a disambiguation-needed state by returning `{ type: 'disambiguate', candidates: [{ physicianId, name, specialty, city }] }` in the SSE stream. The frontend intercepts this event and opens the popup instead of rendering a result card.

---

## [ ] Ideal Rep Simulation — AI benchmark vs. real rep comparison and coaching priorities

**Context**: After a rep completes a practice session, replay the exact same physician persona and conversation context with an AI-controlled "ideal rep." Compare the two transcripts turn-by-turn to surface specific, ranked coaching priorities — not generic feedback, but a concrete gap analysis grounded in what a top performer would have actually said.

### Step 1 — Ideal rep simulation

- After the real session ends, re-run the same physician persona against an AI rep agent using the same opening context, physician profile vectors, and compliance rules
- The AI rep is prompted to demonstrate best-in-class pharma sales technique: lead with clinical insight, anticipate objections, cite data accurately, handle pushback without conceding compliance, and close with a concrete next step
- The simulation runs the full conversation to natural conclusion (or a fixed turn limit, e.g. 12 exchanges) — not just a single ideal response
- Store the ideal rep transcript in Snowflake keyed on `session_id` so it is always paired with the real rep transcript

### Step 2 — Turn-by-turn gap analysis

A comparison agent (Claude Haiku) reads both transcripts in parallel and produces a structured diff across dimensions:

| Dimension | What is measured |
|---|---|
| **Clinical accuracy** | Did the real rep cite the same data points? Miss any key efficacy or safety facts? |
| **Objection handling** | How did each rep respond to the same physician pushback? Did the real rep concede prematurely? |
| **Compliance adherence** | Did the real rep stay on-label? Did the ideal rep navigate fair-balance better? |
| **Conversational flow** | Did the real rep listen and adapt, or follow a rigid script? |
| **Close quality** | Did the real rep secure a concrete next step (follow-up, sample acceptance, meeting)? |

Each dimension gets a score (1–5) and a 1–2 sentence rationale grounded in specific transcript moments.

### Step 3 — Coaching priority report

The gap analysis is synthesised into a ranked coaching priority list — ordered by impact, not alphabetically:

```
#1  Objection handling — conceded too quickly on the safety question (turn 4).
    Ideal rep reframed using the MONARCH trial subgroup data. Rep did not cite it.

#2  Close quality — session ended without a confirmed next step.
    Ideal rep secured sample acceptance + follow-up call date in turn 11.

#3  Clinical accuracy — missed the ORR stat for the ≥65 cohort when physician asked.
    Ideal rep cited 78% vs 43% placebo from the geriatric subgroup analysis.
```

- Top 3 priorities surfaced prominently in the evaluation panel immediately after the session
- Full turn-by-turn diff available in an expandable "Ideal Rep Comparison" section
- Each priority links to the specific exchange in both transcripts so the rep can read exactly what the ideal rep said vs. what they said
- Priorities stored in Snowflake and feed into the manager dashboard as a longitudinal coaching heatmap across all reps and sessions

### Implementation notes

- The ideal rep simulation runs async after the real session ends — it must not block the evaluation panel; show a "Generating ideal rep comparison…" spinner in the coaching section while it runs
- Use a separate system prompt persona for the AI rep — it must not have access to the physician's internal profile vectors (it should encounter objections organically, the same way a real rep would)
- Cap the simulation at a fixed turn limit (12 exchanges) to bound cost; sufficient to cover a complete sales call arc
- Version the ideal rep persona prompt in git alongside the evaluation rubric so coaching benchmarks are reproducible and comparable over time
