# PitchMD — To-Do

---

## [ ] Remove ElevenLabs TTS entirely

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

## [ ] Data-driven dynamic personas — multi-agent physician profiling pipeline

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

## [ ] Move post-session evaluation from Snowflake Cortex to the webapp

**Context**: The current evaluation pipeline runs entirely inside Snowflake Cortex (LLM inference via Cortex Complete). This introduces latency, limits prompt flexibility, and makes iterating on evaluation rubrics slow — every change requires a Snowflake-side deployment. Moving evaluation to the Next.js API layer using Claude directly gives full control over prompts, streaming, and output structure.

- Replace the Snowflake Cortex evaluation call with a direct Claude API call from a new route handler (e.g. `app/api/roleplay/evaluate/route.ts`)
- Pass the full session transcript and captured frames (already available in `capturedFramesRef`) to the route; run scoring entirely in the webapp using `claude-haiku-4-5-20251001` (fast + cheap for structured scoring)
- Stream the evaluation response back to the client using SSE so the evaluation panel populates progressively rather than waiting for the full response — improves perceived speed significantly
- Define the evaluation rubric as a TypeScript object in the route (not a Snowflake prompt template) so it can be versioned in git and iterated without a Snowflake deployment
- Write the final scored result to Snowflake at the end (for compliance logging and history) but do not depend on Snowflake for the inference step itself
- Remove the Snowflake Cortex Complete call from the existing evaluation path; confirm no other route depends on it before deleting
