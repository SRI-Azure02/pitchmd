# PitchMD — Claude Code Working Notes

This file is read automatically at the start of every Claude Code session. It records hard-won lessons about this codebase so the same mistakes are not repeated when building new features.

---

## Project overview

- **Stack**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS (Turbopack in dev), Radix UI / shadcn/ui components
- **AI**: Anthropic Claude SDK — `claude-haiku-4-5-20251001` for roleplay and analysis routes
- **Data**: Snowflake Cortex for vector search (RAG pipeline), session storage in Snowflake
- **Auth**: Custom session-based auth; demo user is `demo@demo.local`
- **Branch strategy**: feature work on `dev`, compliance/critical fixes cherry-picked to `main`

---

## Feature implementation map

Quick-reference for where every major feature lives and how its pieces connect.

### Phase 0 — Governance documents

Seven `.txt` files in `docs/governance/` (v0.5, PI-verified June 2026):
```
01_MLR_Review_Process.txt
02_Approved_Claims_Library_Template.txt
03_Prohibited_Language_List.txt
04_Operational_Design_Domain.txt          ← ODD (in-scope topics + PI verification notes)
05_Fair_Balance_Trigger_List.txt          ← trigger phrases + required balance statements
06_Regulatory_Jurisdiction_Map.txt
07_21CFR_Part11_Assessment.txt
SYNTHETIC_COMPLIANCE_RULES_seed.sql       ← SQL to seed 25 compliance rules
```
All AE percentages and Boxed Warning text verified against VENCLEXTA PI (revised 05/2026) and 8 competitor PIs. Status: DRAFT — requires Medical Affairs / Legal MLR sign-off before embedding in the filter.

---

### Phase 1 — Compliance audit logging

Every roleplay turn (rep message + AI response) logged to `SYNTHETIC_COMPLIANCE_LOG`.

- **Written in**: `app/api/roleplay/message/route.ts` at the end of every turn
- **Function**: `sf.logComplianceTurn(...)` in `lib/snowflake.ts`
- **Key columns**: `SESSION_ID, USER_ID, REP_MESSAGE, AI_RESPONSE, REP_COMPLIANCE_STATUS, AI_COMPLIANCE_STATUS, VIOLATIONS_JSON, CREATED_AT`
- Logging is fire-and-forget (`void sf.logComplianceTurn(...)`) — does not block the response stream
- `REP_COMPLIANCE_STATUS` / `AI_COMPLIANCE_STATUS` values: `'clean' | 'flagged' | 'blocked'` (never `'rewrite_needed'` — normalise before logging)

---

### Phase 2 — Output compliance filter

AI persona responses are scanned for violations before delivery to the user.

- **Function**: `checkOutput(text, rules)` → `FilterResult` in `lib/compliance-filter.ts`
- **FilterResult**: `{ status: FilterStatus, violations: Violation[], rewrittenText?: string, fallbackUsed?: boolean }`
- **On `rewrite_needed`**: call Claude a second time with `buildBalanceInjection(violations)` appended to the system prompt (up to 2 retries)
- **After 2 failed rewrites**: return safe fallback: `"I'd refer you to the full VENCLEXTA Prescribing Information for the complete benefit-risk profile."`
- **Rule types triggering output filter**: `fair_balance`, `superlative`, `off_label`, `safety_minimization`

---

### Phase 3 — Input firewall

Rep inputs are scanned BEFORE calling Claude. Blocked inputs never reach the LLM.

- **Function**: `checkInput(text, rules)` → `FilterResult` in `lib/compliance-filter.ts`
- **On `blocked`**: return amber notice to UI, log violation, skip Claude entirely
- **On `flagged`**: log violation, add warning to UI, still call Claude
- **Rule types triggering input firewall**: `pii`, `ood` (out-of-domain), `injection`, `competitor_disparagement`
- **Rules source**: `SYNTHETIC_COMPLIANCE_RULES` (25 rows, all `ACTIVE = TRUE`) — loaded with 5-min module-level TTL cache in `app/api/roleplay/message/route.ts`

---

### Phase 4 — RAG grounding

AI persona responses are grounded in uploaded documents (PI, competitor PIs).

- **Retrieval function**: `retrieveRelevantChunks(query)` in `lib/rag-retrieval.ts`
- **System prompt injection**: `buildRagSystemBlock(chunks)` — strict mode ("ONLY cite approved material")
- **Ingest route**: `app/api/compliance/documents/ingest/route.ts`
- **Chunker**: `lib/pdf-chunker.ts` — sliding word-window (400 words, 60-word overlap, step=340)
- **Embedding**: `SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', text)` — probed on first chunk; keyword fallback if unavailable
- **Tables**: `SYNTHETIC_COMPLIANCE_DOCUMENTS` (registry) + `SYNTHETIC_DOCUMENT_CHUNKS` (`VECTOR(FLOAT, 768)`)
- **venclexta.pdf**: 66 chunks ingested. Competitor PIs (8 products) still need uploading via Documents tab.

---

### Phase 5 — Vocabulary Enhancement (STT)

Groq Whisper replaces Web Speech API for accurate pharmaceutical brand recognition.

- **API route**: `app/api/stt/route.ts` — accepts `FormData` with `audio` blob, returns `{ transcript }`
- **Model**: `whisper-large-v3-turbo` (Groq free tier, ~150 ms per chunk)
- **Vocabulary prompt**: brand names fetched from `SYNTHETIC_RX.BRAND`, cached 10 min at module level
- **UI component**: `components/audio-input.tsx` — MediaRecorder with 3 s timeslice, 3 s silence countdown ring
- Pauses while avatar is speaking (`disabled` prop → stops recorder + releases MediaStream tracks)
- Resumes 150 ms after avatar finishes speaking

---

### Phase 6 — Cross-session escalation + training completion

**Escalation**: 3 violations of the same rule within 7 days → escalation record + Escalations tab alert.
- **Table**: `SYNTHETIC_COMPLIANCE_PATTERNS` — upserted (MERGE) after every non-clean turn
- **Upsert call**: `sf.upsertEscalation(violations, sessionId, repId)` — inside the same `try` block as `checkInput()` in the roleplay route
- **Threshold**: `VIOLATION_COUNT >= 3` within 7 days — read by Escalations tab

**Training completion**: Banner shown at session end; rep must acknowledge.
- **Table**: `SYNTHETIC_TRAINING_COMPLETION` (no trailing S)
- **Write route**: `POST /api/compliance/training/complete`

---

### Compliance dashboard (Shield icon)

Admin-only (gated by `COMPLIANCE_ADMIN_EMAILS` env var, matched against `email | username | userId`).

| Tab | What it shows | Key routes |
|-----|---------------|------------|
| Session Audit | Every logged turn; click to expand | `GET /api/compliance/sessions`, `GET /api/compliance/sessions/[sessionId]` |
| Escalations | Reps with ≥3 same-rule violations in 7 days | Reads `SYNTHETIC_COMPLIANCE_PATTERNS` |
| Documents | Uploaded PIs; upload + delete | `POST /api/compliance/documents/ingest`, `DELETE /api/compliance/documents/[docId]` |

- **Component**: `components/compliance-dashboard.tsx`
- **Upload flow**: PDF → `/api/compliance/documents/ingest` → `unpdf` extract → sliding-window chunk → Cortex embed → Snowflake insert (shows phased spinner text)
- **Delete**: deletes chunks first (`DELETE FROM SYNTHETIC_DOCUMENT_CHUNKS`), then document record

---

### HCP Mindset system

5 preset mindsets + custom builder with 7 dimensions. Drives Claude physician persona behaviour.

- **Types**: `lib/mindset-types.ts` — `MINDSET_DIMENSIONS` (7), `PRESET_MINDSETS` (5), `CustomMindset` type
- **Descriptions**: `lib/mindset-descriptions.ts` — behavioural instructions for each preset
- **Preset names**: Data Hawk | Skeptical Traditionalist | Friendly Derailer | Bureaucratic Defensive | Cost-Conscious Pragmatist
- **How it feeds Claude**: selected mindset is serialised into the roleplay system prompt as physician persona behaviour instructions (e.g. "This physician demands peer-reviewed data before any claim and will push back on anecdote.")
- **Shown on session nameplate**: physician name / specialty / segment / mindset pill (below avatar frame)
- Physician selection: `physicianSelectionMode` state in `components/chat-interface.tsx` — not a URL route

---

### Avatar integration (Tavus echo mode)

Tavus + Daily.co WebRTC. Echo mode = we control the LLM; Tavus handles TTS + video rendering.

- **Create conversation**: `POST /api/tavus/conversation` → `{ conversationId, conversationUrl, replicaId }`
- **Conversation URL** = Daily.co room URL — embedded in an iframe in the chat UI
- **Persona**: `TAVUS_PERSONA_ID` env var (`pipeline_mode: 'echo'`). If absent, route auto-creates one and logs the ID to set in env.
- **Replica pools** (in `app/api/tavus/conversation/route.ts`):
  - `MALE_REPLICAS = ['r92debe21318', 're6220ec0195']`
  - `FEMALE_REPLICAS = ['r291e545fd67', 'r9c55f9312fb']`
  - Selected by physician gender from Snowflake (`M`/`F` gender code)
- **Frame**: centered `max-w-xl` 16:9 dark background `#0f0f0f`, `rounded-2xl`, no transcript during session
- **402 handling**: Tavus free-tier quota exhausted → surface clear message; do not retry (quota won't self-restore)

---

### Session ID pattern

`crypto.randomUUID()` called once in `chat-interface.tsx` when a physician is selected, stored in `sessionIdRef` (a `useRef`). Passed to every `POST /api/roleplay/message` call and to the compliance log. A single session ID spans all turns in one roleplay conversation.

---

## Best practices & hard-won fixes

### 1. Never render new overlay/modal JSX at the END of a long component branch

**Error encountered**: A consent modal (`{consentModalOpen && <div style={{position:'fixed'}}>...}`) was placed *after* `<EvaluationPanel>` near the bottom of the physician-selection early-return block. React state (`consentModalOpen`) was confirmed `true` in the render, but the DOM showed zero fixed elements and the modal never appeared.

**Root cause**: After hours of debugging, the fix was simply to move the modal JSX to the **very first child** of the same `return (...)` block, before any other JSX. Something about rendering order inside a large early-return tree (possibly interaction with `EvaluationPanel`'s own Radix internals) silently swallowed the conditional block.

**Fix that worked**:
```tsx
if (physicianSelectionMode) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ← Put overlays/modals FIRST, before any other content */}
      {consentModalOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 9999 ... }}>
        ...modal content...
      </div>}

      {/* Header, table, EvaluationPanel etc. come AFTER */}
      ...
    </div>
  );
}
```

**Rule**: In any component with early `return` branches, render modals/overlays as the **first child** of the returned root element.

---

### 2. Use inline styles for critical overlay positioning — do NOT rely on Tailwind classes for new components

**Error encountered**: A new component file (`camera-consent-modal.tsx`) used Tailwind classes `fixed inset-0 z-[9999]` for its backdrop. The Tailwind JIT scanner did not include those classes in the CSS bundle for the new file under Turbopack's hot-module-replacement, so the computed `position` was never `fixed` and `z-index` was never applied.

**Fix that worked**:
```tsx
<div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', ... }}>
```

**Rule**: For any element where `position: fixed`, `z-index`, or `inset: 0` is load-bearing (i.e. the feature breaks without it), use **inline `style` props**, not Tailwind classes. Use Tailwind freely for colours, spacing, and typography inside the overlay card.

---

### 3. Radix UI Dialog portals may silently fail in this Next.js 15 / React 19 environment

**Error encountered**: `CameraConsentModal` was originally implemented using `Dialog` from `@/components/ui/dialog` (Radix UI). When `open={true}`, no `[data-radix-portal]` appeared in the DOM, `[role="dialog"]` was never found, and no fixed elements were created — despite the controlled `open` prop being confirmed `true`.

**Workaround**: Replace Radix `Dialog`/`Sheet` with a plain `div` overlay using inline styles (see rule 2). All other Radix components (dropdowns, tooltips, popovers) work fine — this issue appears specific to Dialog/Sheet portal mounting in certain render positions.

**Rule**: For *new* modal dialogs, build with a plain fixed div rather than Radix Dialog unless you have confirmed the portal mounts correctly in the current render position first.

---

### 4. Snowflake column aliases are required — camelCase vs UPPERCASE mismatch

**Error encountered**: RAG context was always empty. Snowflake returns column names in ALL CAPS (`CHUNK_TEXT`, `SECTION_LABEL`, etc.) but the TypeScript interface expected camelCase (`chunkText`, `sectionLabel`). All rows returned `undefined` for every field.

**Fix**: Add explicit `AS "camelCase"` aliases in every SQL `SELECT`:
```sql
c.CHUNK_TEXT      AS "chunkText",
c.SECTION_LABEL   AS "sectionLabel",
c.PAGE_NUMBER     AS "pageNumber",
d.PRODUCT         AS "product",
d.DOC_NAME        AS "docName"
```

**Rule**: Every Snowflake query that feeds a TypeScript interface **must** use `AS "camelCase"` aliases. Never rely on implicit column name casing.

---

### 5. Snowflake vector search — ingest and retrieval models must match exactly

**Error encountered**: Vector similarity search always returned no results. The ingest pipeline embedded chunks with `['e5-base-v2', 'snowflake-arctic-embed-m', 'multilingual-e5-small']` but the retrieval code requested `['voyage-lite-02-instruct', 'multilingual-e5-large', 'snowflake-arctic-embed-l']`. Mismatched models produce vectors of different dimensionality/space — cosine similarity never exceeds threshold.

**Fix**: Sync retrieval models to exactly match ingest:
```typescript
const RETRIEVAL_MODELS = ['e5-base-v2', 'snowflake-arctic-embed-m', 'multilingual-e5-small'];
```

**Rule**: When changing the ingest embedding model, update the retrieval model list in the same commit. Add a comment citing the paired ingest job.

---

### 6. Compliance status type — `FilterStatus` includes `'rewrite_needed'` which is not in the output union

**Error encountered**: TypeScript error at the compliance turn-logging call: `FilterStatus` (from the input firewall) can return `'rewrite_needed'`, but `repComplianceStatus` was typed as `'clean' | 'flagged' | 'blocked'`.

**Fix**: Normalise before assigning:
```typescript
repComplianceStatus = inputCheck.status === 'rewrite_needed' ? 'flagged' : inputCheck.status;
```

**Rule**: When mapping an input filter status to a compliance log status, always normalise `'rewrite_needed'` → `'flagged'`. Never cast with `as` to silence the type error — normalise explicitly.

---

### 7. Compliance shield is intentionally admin-only

The `<Shield>` button in the dashboard header is gated by `/api/compliance/is-admin`, which checks `COMPLIANCE_ADMIN_EMAILS` in the environment. The demo user (`demo@demo.local`) is not an admin by default and will not see the shield. This is expected behaviour — not a bug.

To grant access, add the email to the `COMPLIANCE_ADMIN_EMAILS` environment variable (comma-separated).

---

### 8. Fast Refresh in Turbopack resets all React state when hooks are added/removed

**Observation**: Adding a new `useState` hook to a component during a debug session causes Turbopack's Fast Refresh to fully remount the component (because hook order changes), resetting all state to initial values. Any state-dependent navigation (physician selection mode, session started, etc.) is lost.

**Rule**: During debugging, prefer adding `console.log` inside existing handlers rather than adding new state hooks, to avoid state resets. Remove all debug logs before committing.

---

### 9. `preview_click` vs direct React prop calls in eval — use `preview_click` for real state transitions

**Observation**: Calling `btn[reactPropsKey].onClick({})` directly from `preview_eval` sometimes does not trigger React state updates or re-renders reliably in React 19's concurrent scheduler. `preview_click` (which dispatches a real DOM event through the browser's event system) reliably triggers React's event delegation and synthetic event dispatch.

**Rule**: Use `preview_click` to test user interactions. Reserve `preview_eval` for reading DOM state, not triggering React events.

---

### 10. Snowflake keyword fallback — binding numbering must start at `:1` with no gaps

**Error encountered**: The keyword-search fallback branch had a dead `'1': { type: 'TEXT', value: queryText }` binding from a prior refactor, causing the numbered bindings after it to be off by one.

**Fix**: Remove dead bindings and renumber sequentially starting at `:1`.

**Rule**: After any SQL refactor in `lib/snowflake.ts`, verify that every `:N` placeholder in the SQL string has exactly one matching `'N': ...` entry in the bindings object, and vice versa.

---

### 11. Compliance admin check must match on email OR username OR userId

**Error encountered**: The compliance dashboard, shield button, and session-review endpoints all returned 403/hidden for a valid admin user. The original `isComplianceAdmin` helper compared only against `session.email`, but in stub-auth mode the session may populate `username` or `userId` instead (email is always `demo@demo.local` in stub mode).

**Fix**: Match against all three identity fields:
```typescript
const isAdmin =
  adminList.includes(session.email?.toLowerCase()    ?? '__none__') ||
  adminList.includes(session.username?.toLowerCase() ?? '__none__') ||
  adminList.includes(session.userId?.toLowerCase()   ?? '__none__');
```

**Files affected**: `app/api/compliance/is-admin/route.ts`, `app/api/compliance/sessions/route.ts`, `app/api/compliance/sessions/[sessionId]/route.ts`, `app/api/compliance/sessions/[sessionId]/review/route.ts`.

**Rule**: Any admin/gating check that reads from `session` must test all three identity fields (`email`, `username`, `userId`), not just email.

---

### 12. Next.js 15 route handlers — dynamic params must be awaited

**Error encountered**: Compliance session-detail and session-review route handlers accessed `params.sessionId` directly. In Next.js 15 App Router, dynamic route params are a `Promise` — accessing them synchronously returns `undefined`, causing every request to 404 or operate on an undefined ID.

**Fix**:
```typescript
// WRONG (Next.js 14 style):
export async function POST(request, { params }) {
  const { sessionId } = params;  // undefined in Next.js 15

// CORRECT (Next.js 15):
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
```

**Files affected**: `app/api/compliance/sessions/[sessionId]/route.ts`, `app/api/compliance/sessions/[sessionId]/review/route.ts`.

**Rule**: In every route handler under `app/api/`, type `params` as `Promise<{...}>` and `await` it before use. This applies to ALL dynamic segments, not just compliance routes.

---

### 13. PDF ingestion fails in serverless runtime — use `unpdf` not `pdf-parse`

**Error encountered**: PDF document ingestion threw `ReferenceError: DOMMatrix is not defined` when deployed to Vercel (or any Node.js serverless environment). The `pdf-parse` package relies on browser globals (`DOMMatrix`, `canvas`) that are unavailable in Node.js runtimes.

**Fix**: Replace `pdf-parse` with `unpdf`, which is built for serverless/edge environments:
```typescript
// WRONG:
import pdfParse from 'pdf-parse';
const { text } = await pdfParse(buffer);

// CORRECT:
import { extractText } from 'unpdf';
const { totalPages, text } = await extractText(new Uint8Array(buffer), { mergePages: true });
```

**File**: `lib/pdf-chunker.ts`.

**Rule**: Never use `pdf-parse` in this project. Always use `unpdf` for PDF text extraction.

---

### 14. Snowflake Cortex embedding models — probe before committing, fall back to keyword mode

**Error encountered**: Document ingestion silently failed when the initially hardcoded Cortex model (`voyage-lite-02-instruct`) was unavailable in the account's Snowflake region. All chunks were written with `null` embeddings; vector search then returned nothing.

**Fix**: The ingest route probes each candidate model on the first chunk before processing the rest. If all Cortex models fail, it falls back to `ingestDocumentChunkNoEmbedding()` (stores text only) and returns `mode: 'keyword'` in the response so the UI can display a warning. `searchSimilarChunks()` detects no-embedding rows and switches to `ILIKE` keyword matching automatically.

**Probe order** (in `app/api/compliance/documents/ingest/route.ts`):
```
e5-base-v2 → snowflake-arctic-embed-m → multilingual-e5-small → keyword fallback
```

**Rule**: Never assume a Cortex embedding model is available. Always probe in the ingest route and surface `mode` + `warning` to the caller. The vector table must be `VECTOR(FLOAT, 768)` — all three probe models produce 768-dim vectors.

---

### 15. `FilterStatus` from `checkInput` does not include `'rewrite_needed'` — but `checkOutput` does

**Context**: `checkInput` (input firewall) never returns `'rewrite_needed'` — that status is output-filter-only (fair-balance rules apply to AI persona responses, not rep inputs). However the `FilterStatus` type union is shared, so TypeScript allows assigning `checkInput` results to variables typed as `FilterStatus`, which then propagates `'rewrite_needed'` to callers that don't expect it.

**Rule**: When consuming `checkInput()` results, treat `status === 'rewrite_needed'` as `'flagged'` as a defensive normalisation step — even though the input firewall won't produce it today, the type system doesn't enforce that. See also rule 6.

---

### 16. Physician selection screen is React state, not a URL route

**Error encountered**: During preview debugging, navigating to `window.location.href = '/physician-select'` returned a Next.js 404. Time was lost trying alternate URL patterns before realising the screen is not a route at all.

**Root cause**: The physician selection screen is controlled by `physicianSelectionMode` state inside `components/chat-interface.tsx`. It is rendered as an early-return branch of that component, not as a separate page under `app/`.

**Fix**: To reach the physician selection screen in preview, click the "Practice Your Pitch" card on the home screen (`/`). Programmatically, trigger it via:
```javascript
// In preview_eval — find and click the home card button:
[...document.querySelectorAll('button')].find(b => b.innerText?.includes('Practice Your Pitch'))?.click();
```

**Rule**: Do not attempt to navigate to the physician selector via URL. It is state-driven. Any preview debugging that requires this screen must start from the home page and click through the card.

---

## Design system & UI patterns

The following rules document the visual conventions established in PitchMD. New panels and features must follow these patterns.

---

### 17. Phase eyebrow + accent color system

Every panel header displays a small uppercase eyebrow label identifying its phase, using the phase's accent color.

**Phase accent colors:**
- **Pre-field**: `#BF4E19` (burnt orange) — Practice Pitch, Review Performance, Evaluation modal
- **In-field**: `#2B5FA6` (burnt sky blue) — Engagement Playbook
- **Post-field**: `#0D8A78` (burnt teal) — Call Journal, Loop Back

**Eyebrow pattern:**
```tsx
<span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#BF4E19' }}>
  Pre-field
</span>
```
Place this as the first element inside the header `<div>`, before the panel title `<p>` or `<h1>`.

**Rule**: Every panel in PitchMD must display a phase eyebrow as the first text element in its header, using the correct accent color from the list above. Never hardcode the eyebrow color inline without checking this list first.

---

### 18. SVG polyline chevron standard — replaces all Lucide chevrons and ASCII toggles

This project uses stylized SVG polylines for all expand/collapse toggles. Never use `ChevronUp`/`ChevronDown` from Lucide or ASCII `+`/`−`/`∧`/`∨`.

```tsx
<svg
  width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke={isExpanded ? PHASE_ACCENT_COLOR : '#cbd5e1'}
  strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
  className="shrink-0"
>
  <polyline points={isExpanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
</svg>
```

- **Collapsed** (pointing down, will expand): `points="6 9 12 15 18 9"`, stroke `#cbd5e1`
- **Expanded** (pointing up, will collapse): `points="18 15 12 9 6 15"`, stroke = phase accent color

For smaller contexts (table rows, inline toggles), use `width="15" height="15"`.

**Rule**: When adding any expand/collapse toggle to a PitchMD component, use this SVG pattern. Remove any Lucide `ChevronUp`/`ChevronDown` imports at the same time — leaving them imported but unused will cause a dead-import lint warning and may cause confusion in future edits.

---

### 19. Dimension mini-cards — canonical DIM_COLORS and scoring thresholds

Both `EvaluationPanel` and `PerformancePanel` render dimension mini-cards. The `DIM_COLORS` array and `DIMS` definition are canonical — do not create local copies in new components; import or co-locate these constants in a shared location if a third consumer is added.

```typescript
const DIM_COLORS = ['#6b93c4', '#5fa882', '#c9a448', '#8b78c0', '#c97070'];
const DIMS = [
  { key: 'CLINICAL_KNOWLEDGE_SCORE', label: 'Clinical Knowledge', short: 'CK' },
  { key: 'OBJECTION_HANDLING_SCORE', label: 'Objection Handling',  short: 'OH' },
  { key: 'COMPLIANCE_SCORE',         label: 'Compliance',          short: 'CO' },
  { key: 'TONE_RAPPORT_SCORE',       label: 'Tone & Rapport',      short: 'TR' },
  { key: 'CLOSING_SCORE',            label: 'Closing',             short: 'CL' },
];
```

**Score threshold logic for card backgrounds:**
| Score     | bg          | border     | text      |
|-----------|-------------|------------|-----------|
| ≥ 8       | `#f0fdf9`   | `#a7f3d0`  | `#047857` |
| 6 – 7.9   | `#fefce8`   | `#fef08a`  | `#b45309` |
| < 6       | `#fff7ed`   | `#fed7aa`  | `#dc2626` |
| null / —  | `#f8fafc`   | `#e2e8f0`  | `#94a3b8` |

Each card: short label in `DIM_COLORS[i]`, numeric score bold, a 1-bar progress track in `DIM_COLORS[i]`, full label in `text-slate-400` below.

**Rule**: Keep `DIM_COLORS` and `DIMS` identical in every component that renders mini-cards. Score thresholds (8 / 6) are fixed business rules — do not adjust them without a product decision.

---

### 20. Post-field warm background and left-border accent for expanded rows

- All post-field panel outer containers use `style={{ backgroundColor: '#F1EFE9' }}` (warm off-white).
- The header section uses `bg-white` to contrast against the warm body.
- **Call Journal** expanded note rows: `bg-white` + `borderLeft: '3px solid #FF6B00'` (orange).
- **Loop Back** expanded task rows: `bg-white` + `borderLeft: '3px solid #0D8A78'` (teal).
- The right, top, and bottom borders of expanded inline rows: `1px solid #e2e8f0`.

```tsx
<div
  className="bg-white rounded-r-xl px-5 py-4 shadow-sm"
  style={{
    borderLeft: '3px solid #0D8A78',
    borderTop: '1px solid #e2e8f0',
    borderRight: '1px solid #e2e8f0',
    borderBottom: '1px solid #e2e8f0',
  }}
>
```

**Rule**: Post-field panels must always use `#F1EFE9` as the page background. Any row that expands inline (notes, tasks) must use white bg + a 3px left accent border so it reads as a card sitting on the warm background. The accent border color matches the panel's phase color.

---

### 21. Loop Back — priority badge color system for pending tasks

Age of a pending task is computed from `CREATED_AT`:
```typescript
const days = Math.floor((Date.now() - new Date(task.CREATED_AT).getTime()) / 86_400_000);
```

**Color thresholds:**
| Age        | Dot / text      | Background  | Border     | Label          |
|------------|-----------------|-------------|------------|----------------|
| > 10 days  | `#ef4444` red   | `#fef2f2`   | `#fecaca`  | `Nd overdue`   |
| 6–10 days  | `#f59e0b` amber | `#fefce8`   | `#fef08a`  | `Nd ago`       |
| 3–5 days   | `#fcd34d` yellow| `#fefce8`   | `#fef08a`  | `Nd ago`       |
| 0–2 days   | `#0D8A78` teal  | `#f0fdf9`   | `#a7f3d0`  | `Today`/`Nd ago` |

The "All pending — oldest first" collapsible section at the top of Loop Back uses `tasks.filter(t => !t.COMPLETED).sort((a,b) => new Date(a.CREATED_AT) - new Date(b.CREATED_AT))` and shows the physician name from `physicianMap`.

**Rule**: Always derive task priority from creation date, not a stored priority field. Display both a colored dot and a badge. Items older than 10 days must include the word "overdue" in the label.

---

### 22. Gradient shadow strip between fixed header and scrollable content

See REACT_NEXTJS_PATTERNS.md rule 8 for the portable implementation. In PitchMD, this strip is placed between the `shrink-0` header/filter section and the `flex-1 overflow-auto` content div in every panel: Physician Selector, Review Performance, Engagement Playbook, Call Journal, Loop Back.

```tsx
<div
  className="shrink-0"
  style={{
    height: '8px',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.14) 0%, transparent 100%)',
    pointerEvents: 'none',
  }}
/>
```

**Rule**: Add this strip to every new panel that has a fixed header above a scrollable content area. `height: 8px` and opacity `0.14` are the project standard — adjust only if the panel background is significantly lighter or darker.

---

### 17. PDF text chunking — use sliding word-window, not paragraph splitting

**Error encountered**: `lib/pdf-chunker.ts` originally split on double-newlines (`\n\n`). A 66-page PDF extracted by `unpdf` came back as a near-monolithic text block with almost no blank lines, producing only 2 chunks. RAG retrieval returned nothing useful because virtually the entire document was one chunk.

**Fix**: Replace paragraph splitting with a sliding word-window:
```typescript
const CHUNK_WORDS = 400;
const OVERLAP_WORDS = 60;
const STEP = CHUNK_WORDS - OVERLAP_WORDS; // 340

const words = text.split(/\s+/);
for (let start = 0; start < words.length; start += STEP) {
  const slice = words.slice(start, start + CHUNK_WORDS).join(' ');
  if (slice.trim()) chunks.push(slice);
}
```

**File**: `lib/pdf-chunker.ts`

**Rule**: Never use paragraph or sentence splitting for PDF chunking in this project. PDFs extracted by `unpdf` often produce flat text with minimal newlines. Use a sliding word-window (400 words, 60-word overlap, step=340).

---

### 18. Snowflake — LIMIT and OFFSET must be integer literals, not bound parameters

**Error encountered**: A similarity-search query used `:LIMIT` as a named binding parameter. Snowflake's REST API v2 does not support parameterized `LIMIT` / `OFFSET` — only WHERE-clause value bindings are accepted. The query threw a Snowflake API error.

**Fix**: Inline LIMIT and OFFSET as integer literals validated before interpolation:
```typescript
// WRONG — Snowflake rejects bound LIMIT:
const sql = `SELECT ... LIMIT :LIMIT`;
const bindings = { LIMIT: { type: 'INTEGER', value: String(n) } };

// CORRECT — inline as validated literal:
const safeLimit = Math.max(1, Math.min(Number(n), 50)); // clamp before interpolating
const sql = `SELECT ... LIMIT ${safeLimit}`;
```

**Files**: `lib/rag-retrieval.ts`, `lib/snowflake.ts`

**Rule**: LIMIT and OFFSET must always be inlined as integer literals in Snowflake SQL strings. Validate and clamp to a safe range before interpolation to prevent injection.

---

### 19. Vercel hobby plan rejects `maxDuration` exports in route handlers

**Error encountered**: Route handlers that exported `export const maxDuration = 60` caused Vercel deployment failures: `"maxDuration" is only available in Pro and Enterprise plans`. The build would succeed locally but the deployment would error.

**Fix**: Remove every `maxDuration` export from every route handler file. The hobby plan default timeout is sufficient.

**Rule**: Never add `export const maxDuration = ...` to any route handler in this project. This is a Vercel hobby plan — custom function durations are not available. If a route consistently times out, optimise the route (cache upstream, reduce query scope) rather than increasing the timeout.

---

### 20. Compliance pipeline — `inputCheck` scope: escalation upsert must live inside the same `try` block

**Error encountered**: The cross-session escalation upsert in `app/api/roleplay/message/route.ts` referenced `inputCheck` after the `try` block where it was defined, causing a TypeScript "variable used before assignment" / reference error at compile time.

**Fix**: Move the escalation upsert call inside the same `try` block as `checkInput()`:
```typescript
try {
  const inputCheck = await checkInput(repMessage, complianceRules);
  // ... handle block/flag ...

  // escalation upsert MUST be here — inputCheck is block-scoped
  await upsertEscalation(inputCheck.violations, sessionId, repId);
} catch (err) { ... }
```

**File**: `app/api/roleplay/message/route.ts`

**Rule**: Any logic that references `inputCheck` or `outputCheck` results must live *inside* the same `try` block as the corresponding `checkInput()` / `checkOutput()` call. Never hoist compliance-dependent work outside the block — the variable is not accessible and TypeScript will catch it at compile time but the intent can be lost during refactors.

---

### 21. Groq Whisper STT — use a vocabulary `prompt` parameter for pharmaceutical brand names

**Error encountered**: Web Speech API misrecognised pharmaceutical brand names (e.g. "Venclexta" → "vent lexer", "Venetoclax" → "venetoclax" — usually correct but inconsistent). The Web Speech API offers no vocabulary priming mechanism.

**Fix**: Replaced Web Speech API entirely with Groq Whisper (`whisper-large-v3-turbo`) in `app/api/stt/route.ts`. Whisper accepts a `prompt` parameter that biases the model toward specific vocabulary:
```typescript
groqFd.append('prompt',
  `Pharmaceutical sales training session. Drug brand names include: ${brands.join(', ')}.`
);
```
The brand list is fetched from `SYNTHETIC_RX.BRAND` and cached at module level with a 10-minute TTL to avoid a Snowflake round-trip on every request.

**Files**: `app/api/stt/route.ts`, `components/audio-input.tsx`

**Rule**: For any domain-specific STT, always pass a vocabulary prompt to Whisper. Cache the domain vocabulary at module level with a reasonable TTL (5–10 minutes) rather than fetching it on every request — module-level variables persist across warm serverless invocations.

---

### 22. MediaStream track ownership — use a handoff flag to prevent unmount cleanup from killing handed-off tracks

**Error encountered**: `CameraSetupModal` verified the camera and called `onConfirm(stream)` to hand the live `MediaStream` to the parent. On unmount, the component's `useEffect` cleanup ran `stopStream()`, which called `stream.getTracks().forEach(t => t.stop())` — killing the very tracks the parent was now holding. The camera feed appeared active in the UI but `captureFrame()` produced blank frames (all black) because the underlying track was ended.

**Fix**: Add a `handedOffRef = useRef(false)` flag. Set it to `true` immediately before calling `onConfirm`. The cleanup function checks the flag and skips track-stopping if the stream has been handed off:
```typescript
const handedOffRef = useRef(false);

const stopStream = useCallback(() => {
  cleanup();
  if (!handedOffRef.current) {
    streamRef.current?.getTracks().forEach(t => t.stop());
  }
  streamRef.current = null;
}, [cleanup]);

const handleConfirm = () => {
  cleanup();
  handedOffRef.current = true; // must be set BEFORE calling onConfirm
  if (streamRef.current) onConfirm(streamRef.current);
};
```

**Rule**: Whenever a component creates a `MediaStream` and hands it to a caller, add a handoff flag to prevent cleanup from stopping tracks after ownership has transferred. Never stop tracks in cleanup without checking whether ownership has been transferred.

---

### 23. Persistent hidden video element for frame capture — avoid per-call async race

**Error encountered**: `captureFrame()` originally created a new `<video>` element on each call, set `srcObject`, and waited for `onloadedmetadata` before drawing to canvas. The async callback frequently missed the draw window (especially on 20-second intervals triggered by `setInterval`), producing zero-byte canvas exports or blank frames — `capturedFramesRef` accumulated empty strings.

**Fix**: Create a single persistent hidden video element at session start in `startCamera()`, play it immediately, and keep it alive for the duration of the session. `captureFrame()` draws synchronously from the already-playing element:
```typescript
// In startCamera():
const vid = document.createElement('video');
vid.srcObject = stream;
vid.muted = true;
vid.playsInline = true;
vid.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px';
document.body.appendChild(vid);
captureVideoRef.current = vid;
await vid.play().catch(() => {});
captureFrame(); // capture immediately — don't wait for the first interval tick

// In captureFrame():
const video = captureVideoRef.current;
if (!video || video.readyState < 2) return; // 2 = HAVE_CURRENT_DATA
const canvas = document.createElement('canvas');
canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
```
Remove the hidden video from `document.body` in `stopCamera()`.

**Rule**: For recurring frame capture from a MediaStream, always use a single persistent hidden video element that stays playing for the session. Never create a new `<video>` per capture call — the async metadata-load chain is unreliable in production.

---

### 24. Fair-balance compliance filter fires on benign physician responses — guard with efficacy claim detection

**Error encountered**: The compliance filter's `fair_balance` rule triggered on any physician turn that mentioned "Venclexta" without a balanced safety statement — even when the physician was asking a neutral opening question. The rewrite path substituted a canned fair-balance paragraph, then retried; after two failed rewrites, a fallback template replaced the entire physician response with a PI redirect. Result: the physician redirected the rep to the PI within the first sentence of the conversation.

**Fix (two layers)**:

1. **`lib/compliance-filter.ts`** — gate fair-balance rules on efficacy language:
```typescript
const EFFICACY_CLAIM_MARKERS = [
  'response rate', 'overall survival', 'progression-free', 'trial', 'study',
  'demonstrated', 'showed', 'proven', 'superior', 'versus', 'compared to',
  // ...
];
function hasEfficacyClaim(text: string): boolean {
  return EFFICACY_CLAIM_MARKERS.some(m => text.includes(m));
}
// In the filter loop:
if (rule.RULE_TYPE === 'fair_balance') {
  if (!hasEfficacyClaim(lowerText)) continue; // skip if no efficacy claim
  ...
}
```

2. **`app/api/roleplay/message/route.ts`** — suppress rewrite when the rep's preceding turn was clean:
```typescript
} else if (filterResult.status === 'rewrite_needed') {
  if (repComplianceStatus === 'clean') {
    complianceStatus = 'flagged'; // log it, but don't rewrite
  } else {
    // existing rewrite logic
  }
}
```

**Rule**: Fair-balance compliance rules must only fire when an efficacy claim is actually present in the text. Always add a content guard before triggering rewrite-path logic. Additionally, gate the physician rewrite on the rep's compliance status — a clean rep turn should never cause the physician to redirect to the PI.

---

### 25. `rep_flagged` event for amber compliance notices — flagged inputs must be surfaced in the UI

**Error encountered**: When a rep sent an off-label claim (`"it can also be used to treat breast cancer"`), the input firewall returned `status: 'flagged'` and the physician pushed back in character. No compliance notice appeared in the chat UI — only `input_blocked` events triggered visible warnings. The rep had no indication their message was flagged.

**Fix**: Emit a `rep_flagged` SSE event from the route when `inputCheck.status === 'flagged'`:
```typescript
if (inputCheck.status === 'flagged') {
  safeEnqueue({
    type: 'rep_flagged',
    rule_code: inputCheck.primaryViolation?.rule_code ?? 'UNKNOWN',
    rule_name: inputCheck.primaryViolation?.rule_name ?? 'Compliance notice',
    message:   inputCheck.primaryViolation?.redirect_message ?? '...',
  });
}
```
In `chat-interface.tsx`, handle `rep_flagged` by inserting an amber `isComplianceFlag: true` message into the message list — visually distinct from the red `input_blocked` banner (conversation continues; amber is informational only).

**Rule**: There are two compliance severity levels — `blocked` (red banner, conversation stops) and `flagged` (amber notice, conversation continues). Both must be visible in the UI. Never silently log a flagged event without surfacing a notice to the rep.

---

### 26. `avatarSpeaking` must be included in `AudioInput`'s `disabled` prop

**Error encountered**: Three mic failures were reported:
1. Mic did not activate on the first turn (rep had to click manually).
2. Mic did not auto-resume after the physician finished speaking.
3. Auto-submit wait was 10 seconds, not the intended 3 seconds.

**Root cause for (1) and (2)**: `AudioInput` had `disabled={sessionEnded || !roleplaying}` — `avatarSpeaking` was not in the expression. The mic behaviour was:
- Session starts → `roleplaying = true`, `avatarSpeaking = true` (physician greets rep)
- After greeting ends → `avatarSpeaking = false`, but `disabled` hadn't changed so no `useEffect` re-run triggered recording start
- On subsequent turns → same pattern; the mic never auto-started

**Fix**:
```tsx
// WRONG:
disabled={sessionEnded || !roleplaying}

// CORRECT:
disabled={sessionEnded || !roleplaying || avatarSpeaking}
```

`AudioInput`'s internal `useEffect` on `[disabled, ...]` calls `startRecording()` when `disabled` becomes `false`, and `stopRecording()` when it becomes `true` — so including `avatarSpeaking` makes the mic lifecycle fully automatic.

**Root cause for (3)**: `SUBMIT_WAIT` in `audio-input.tsx` was `10_000` ms despite a code comment saying "3-second silence". Fixed to `3_000`.

**Rule**: Whenever a component has a speech/audio mute state (`avatarSpeaking`, `isPlaying`, etc.), include it explicitly in the `disabled` prop passed to `AudioInput`. Do not assume the mic knows about the avatar's speaking state indirectly.

---

### 27. Early mic resume — re-enable AudioInput 1 second before AI finishes speaking

**Feature**: To eliminate the dead gap between the AI finishing and the rep needing to click the mic, re-enable recording ~1 second before the AI utterance ends.

**Implementation in `lib/elevenlabs.ts`**:
- ElevenLabs path: use `audio.ontimeupdate` — fires when `currentTime >= duration - 1.0`
- Browser TTS path: estimate total duration from word count (`wordCount / (WORDS_PER_SECOND * rate) * 1000`), then `setTimeout(onNearlyDone, estimatedMs - 1000)`
- `speakText()` accepts `onNearlyDone?: () => void` as 4th parameter and threads it through both paths

**Implementation in `chat-interface.tsx`**:
```typescript
const enableMicEarly = () => {
  setAvatarSpeaking(false);
  setInputValue('');
};
speakText(speechText, voiceId, emotion, enableMicEarly)
  .then(() => {
    setAvatarSpeaking(false); // safety net if early callback didn't fire
    setInputValue('');
  });
```

**Rule**: Always provide a `.then()` safety net after `speakText()` even when `onNearlyDone` is supplied — the early callback can fail (e.g. `ontimeupdate` not firing, audio interrupted) and the mic must re-enable regardless.

---

### 28. Vercel build failure — cherry-picked commits must include ALL files referenced by changed components

**Error encountered**: Vercel build failed on commit `29467aa` with:
```
Type error: Cannot find module './camera-consent-modal' or its corresponding type declarations.
```
`components/chat-interface.tsx` was cherry-picked to `main` but two files it imports were left on `dev` only:
- `components/camera-consent-modal.tsx` — imported but never used in JSX (dead import from an earlier draft)
- `app/api/facial-analysis/route.ts` — imported for its exported `FacialAnalysisResult` type

**Fix**:
1. Remove the dead `CameraConsentModal` import entirely.
2. Inline the `FacialAnalysisResult` interface in `chat-interface.tsx` instead of importing it from the route file — route-exported types should not be consumed by client components across the module boundary this way.

```typescript
// WRONG — imports a type from a server route file (fragile, breaks when route is not on the same branch):
import type { FacialAnalysisResult } from '@/app/api/facial-analysis/route';

// CORRECT — define the interface inline in the consuming component:
interface FacialAnalysisResult {
  confidence: number;
  nervousness: number;
  engagement: number;
  summary: string;
  observations: string[];
  frameCount: number;
}
```

**Rule**: Before cherry-picking a commit to `main`, run `grep -n "^import" components/chat-interface.tsx` (or any changed component) and verify every imported path exists on `main`. Never import types from route handler files into client components — define shared types in a `lib/types.ts` or inline them. Also apply the fix to `dev` immediately via cherry-pick so the branches stay consistent.

---

### 29. Snowflake — `ADD COLUMN IF NOT EXISTS` is not valid syntax

**Error encountered**: Running a migration script with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS col_name TYPE` produced:
```
SQL compilation error: syntax error line N at position 6 unexpected 'COLUMN'
syntax error line N at position 20 unexpected 'EXISTS'
```

**Root cause**: `IF NOT EXISTS` on `ADD COLUMN` is a PostgreSQL extension. Snowflake's `ALTER TABLE` does not support it — only `ADD COLUMN col_name TYPE` (without the guard) is valid.

**Fix**: Write one `ALTER TABLE ... ADD COLUMN` statement per new column with no `IF NOT EXISTS` guard. Run each statement individually; if a column already exists, Snowflake will error only on that line.
```sql
-- WRONG:
ALTER TABLE MY_TABLE ADD COLUMN IF NOT EXISTS new_col BOOLEAN;

-- CORRECT:
ALTER TABLE MY_TABLE ADD COLUMN new_col BOOLEAN;
```

**Rule**: Never write `ADD COLUMN IF NOT EXISTS` in Snowflake SQL. Use one `ADD COLUMN` per statement and run each individually. If deploying migrations repeatedly, guard existence checks in application code before issuing the ALTER.

---

### 30. React async state snapshot timing — never read state immediately after an async setter call

**Error encountered**: `runFacialAnalysis()` was called to populate `facialAnalysis` state, then `triggerEvaluation` was called immediately after and tried to read `facialAnalysis`. The value was always `null` — state was captured before React processed the `setFacialAnalysis(result)` call inside the async function.

**Root cause**: React state setters (`setState`) are asynchronous — they schedule a re-render but do not immediately update the state variable in the current closure. Any snapshot of the state variable taken synchronously after calling an async function that contains a setter will see the stale (pre-update) value.

**Fix**: Have the async function return its computed value directly (rather than just setting state), and pass that returned value to subsequent calls:
```typescript
// WRONG — reads stale state after async setter:
await runFacialAnalysis(); // sets facialAnalysis state internally
triggerEvaluation(history, facialAnalysis); // facialAnalysis is still null here

// CORRECT — use the returned value directly:
const runFacialAnalysis = async (): Promise<FacialAnalysisResult | null> => {
  const result = await fetchFacialAnalysis();
  setFacialAnalysis(result); // still update state for the UI
  return result;             // also return it for immediate use
};
const faResult = await runFacialAnalysis();
triggerEvaluation(history, faResult); // faResult is the live value
```

**Rule**: When an async function updates React state AND the caller needs the computed value immediately (to pass to the next step), have the function return the value directly. Never rely on reading the state variable in the same synchronous block as the setter call — the closure captures the old value.

---

### 31. EvaluationPanel `generating` and `refreshTrigger` props defined but never wired — pre-existing silent bug

**Error encountered**: `EvaluationPanel` defined `generating` and `refreshTrigger` in its props interface, and its internal `useEffect` suppressed data fetches while `generating` was `true` (to avoid showing stale results during evaluation). However, `chat-interface.tsx` never actually passed these props — both were left as `undefined`, meaning `generating` defaulted to `false` and the panel always fetched immediately on open regardless of evaluation state.

**Effect**: The skeleton loading banner never appeared while evaluation was running, and the panel showed empty/stale data immediately instead of waiting for the evaluation to complete.

**Fix**: Add both props to the `<EvaluationPanel>` JSX call:
```tsx
// WRONG — props defined but never passed:
<EvaluationPanel physicianId={physicianId} sessionId={sessionId} />

// CORRECT:
<EvaluationPanel
  physicianId={physicianId}
  sessionId={sessionId}
  generating={evalGenerating}
  refreshTrigger={evalRefreshTrigger}
/>
```

**Rule**: When a child component's `useEffect` is gated on a prop, that prop must be passed by every caller. Before adding a new prop with behavioral significance to a component's interface, search for all JSX usages of that component and verify every callsite passes it.

---

### 32. `objection_details` JSON schema — output schema must match what the UI reader expects

**Error encountered**: The Snowflake rubric produced `objection_details` as `[{ objection_summary: "...", layers_present: [...], layers_missing: [...] }]`, but `EvaluationPanel` read `obj.summary`, `obj.acknowledge` (boolean), `obj.reframe` (boolean), `obj.evidence` (boolean), `obj.qualify` (boolean)`. All objection indicators showed as red/false because none of the expected fields existed.

**Fix**: Update the evaluation prompt's output schema to use flat booleans matching what the panel reads:
```json
"objection_details": [
  {
    "summary": "Brief description of the objection handled",
    "acknowledge": true,
    "reframe": false,
    "evidence": true,
    "qualify": false
  }
]
```

**Rule**: Whenever changing an LLM output schema (prompt-side) or a UI component that consumes it (component-side), verify the field names and types match on both sides. Define a shared TypeScript interface in `lib/types.ts` so TypeScript catches mismatches at compile time rather than silently producing undefined values at runtime.

---

### 33. Snowflake REST API — boolean values must be passed as TEXT strings with `CAST(:N AS BOOLEAN)`

**Error encountered**: When building `insertEvalResult()` in `lib/snowflake.ts`, attempting to bind JavaScript `true`/`false` values via the Snowflake REST API binding object failed — the REST API does not support a native `BOOLEAN` binding type.

**Fix**: Pass boolean values as text strings `'true'`/`'false'` and cast them in the SQL:
```typescript
// WRONG — 'BOOLEAN' is not a valid Snowflake REST API binding type:
{ type: 'BOOLEAN', value: String(someBoolean) }

// CORRECT — pass as TEXT, cast in SQL:
// In bindings object:
':15': { type: 'TEXT', value: String(someBoolean) }  // 'true' or 'false'
// In SQL:
CAST(:15 AS BOOLEAN)
```

**Rule**: The Snowflake REST API (v2) binding object accepts only `TEXT`, `INTEGER`, `FLOAT`, `TIMESTAMP`, and `BINARY` types. For boolean values, use `type: 'TEXT'` with `value: 'true'` or `'false'`, and add `CAST(:N AS BOOLEAN)` in the SQL expression. Similarly, use `NULLIF(:N, '')::FLOAT` for nullable numerics passed as empty string `''`.

---

### 34. Snowflake VARIANT columns are returned as JSON strings via the REST API — always parse them

**Error encountered**: The `SYNTHETIC_ACCOUNT_DYNAMIC_DEFAULT.FLOW_DATA` column (type `VARIANT`) was inserted correctly via `PARSE_JSON(:n)`. When read back via the Snowflake REST API, the column value arrived in the Next.js route handler as a raw JSON **string** (`typeof row.flowData === 'string'`), not a parsed object. The component received a string, called `.edges` on it, got `undefined`, and rendered an empty canvas.

**Fix**:
```typescript
const rows = await sf.executeQuery(`SELECT FLOW_DATA AS "flowData" FROM ...`, bindings);
const row = rows[0] as { flowData: unknown };
// Snowflake VARIANT comes back as a JSON string via REST API — parse it
const flowData = typeof row.flowData === 'string' ? JSON.parse(row.flowData) : row.flowData;
return NextResponse.json({ default: flowData });
```

**Rule**: Any Snowflake `VARIANT` column read via the REST API must be defensively parsed: `typeof val === 'string' ? JSON.parse(val) : val`. Never assume a VARIANT column arrives as a JavaScript object — the REST API serialises it as a string.

---

### 35. localStorage working state with no edges should fall through to the server-seeded default

**Error encountered**: An account dynamic had been opened before a Snowflake default was seeded. The empty canvas state (`{ edges: [], nodePos: {...}, ... }`) was saved to localStorage. After the seed ran, reopening the account still showed a blank canvas — because the `saved` key existed in localStorage and was loaded first, overwriting the Snowflake default before it was checked.

**Fix**: Only treat a localStorage working state as authoritative if it contains substantive content. For account dynamics, that means `edges.length > 0`:
```typescript
const saved = localStorage.getItem(WORK_STOR(accountId));
let usedLocal = false;
if (saved) {
  try {
    const parsed = JSON.parse(saved) as FlowData;
    if ((parsed.edges ?? []).length > 0) {
      applyFlow(parsed, phys, cols);
      usedLocal = true;
    }
  } catch { /* fall through */ }
}
if (!usedLocal) {
  snowflakeDefault ? applyFlow(snowflakeDefault, phys, cols) : initGrid(phys, cols);
}
```

**Rule**: When a component caches server-seeded state in localStorage, the cache should only take priority if it contains meaningful user-created data. An empty/default-shaped cache entry (e.g. no edges drawn) must fall through to the server default. Otherwise, any user who visits before a seed runs is permanently locked out of future defaults unless they manually clear localStorage.

---

### 36. Removing a named constant — grep all references before deleting, including JSX expressions

**Error encountered**: The `PO` constant (propagation line Y-offset, 28px) was removed when dual ports replaced the single-offset approach. Two references to `PO` inside JSX `d={bz(src.x, src.y + PO, ...)}` attribute strings were missed. TypeScript did not catch them because the expressions are inside JSX string interpolation that Turbopack's dev-mode transpiler doesn't fully type-check at HMR time. A runtime `ReferenceError: PO is not defined` fired only when the SVG paths rendered.

**Fix**: Before removing any constant, run:
```bash
grep -n "\bPO\b" components/account-flow-editor.tsx
```
and replace every occurrence. Two separate edit passes were required because not all occurrences were co-located.

**Rule**: Before deleting a named constant, grep for its exact name (word-boundary anchored) across the file. JSX attribute expressions and inline SVG `d={}` strings are not caught by TypeScript's type-checker in Turbopack dev mode — they fail at runtime. Confirm zero matches before committing.

---

### 37. SVG canvas — propagation lines must route to dedicated card ports, never through AND/OR gate circles

**Error encountered**: Propagation (dashed) lines used `tgtPort(edge.to)` as their target, which returns the AND/OR gate circle center for nodes with two or more incoming flow edges. The prop line curved to the gate position — which sits between cards in open canvas space — rather than reaching the target physician card. The line appeared to float and terminate mid-canvas.

**Fix**: Propagation lines always bypass gate logic entirely. They carry context, not flow prerequisites, so they must connect to the dedicated prop port on the card (`nLeftProp`) regardless of whether a gate exists:
```typescript
// WRONG — routes prop line to gate circle when node has multi-input:
const tgt = tgtPort(edge.to);
<path d={bz(src.x, src.y, tgt.x, tgt.y)} />

// CORRECT — always route to card's own prop port:
const propTgt = nLeftProp(edge.to);
<path d={bz(src.x, src.y, propTgt.x, propTgt.y)} />
```

**Rule**: In the account dynamic SVG canvas, flow lines and gate arrows share the `tgtPort()` routing logic. Propagation lines must use `nLeftProp()` directly. Never mix flow-path port resolution with propagation line rendering — they serve different connection points on the card.

---

### 38. `onContinuation` prop (and any behaviorally significant callback) — defined in child but never wired from parent

**Error encountered**: `AudioInput` defined `onContinuation?: (text: string) => void` in its props interface, with a complete 5-second continuation-window implementation (timer, transcript interception, cleanup on `disabled` change). `chat-interface.tsx` never passed this prop. The feature was silently dead — `audio-input.tsx` compiled fine, the mic lifecycle worked normally, but the continuation path was always unreachable because the callback was always `undefined`.

**Root cause**: Same family as rule 31 (EvaluationPanel `generating` prop). Optional callback props don't cause TypeScript errors when omitted, and the child component degrades gracefully to its default behaviour — making the omission invisible at runtime.

**Fix**: Add the handler in the parent and wire the prop:
```typescript
// chat-interface.tsx — handler
const handleContinuation = (extraText: string) => {
  if (avatarSpeakingRef.current) return;   // AI already responded — too late
  sseAbortControllerRef.current?.abort();
  stopCurrentAudio();
  // reset streaming state, patch last user message, resend
};

// JSX — wire the prop
<AudioInput
  onContinuation={handleContinuation}
  // ...other props
/>
```

**Rule**: After implementing a callback prop in a child component, immediately grep every callsite and wire the prop. If the callback controls a feature (not just an optional enhancement), treat it as required. Add a comment in the child's props interface noting the consequence of omission: `// if not passed, continuation window is disabled`.

---

### 39. Cancellable SSE fetch — AbortController in ref, suppress AbortError in catch

**Error encountered**: `sendMessage` had no `AbortController`. When implementing graceful speech continuation, the handler needed to abort the in-flight SSE stream, reset streaming state, and resend with merged text. Without a signal on the `fetch()` call, there was no way to cancel the open stream — the old response continued reading in the background and its events raced with the new send.

Additionally, when `.abort()` is called, `fetch()` throws a `DOMException` with `name === 'AbortError'`. The existing `catch (error)` block turned this into a user-visible error message ("Sorry, something went wrong: The user aborted a request"). The abort was intentional and must be silently swallowed.

**Fix**:
```typescript
// Store controller in ref (not state — no re-render needed)
const sseAbortControllerRef = useRef<AbortController | null>(null);

// In sendMessage:
const sseAbort = new AbortController();
sseAbortControllerRef.current = sseAbort;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(requestBody),
  signal: sseAbort.signal,   // ← wire the signal
});

// In catch block — must come FIRST before generic error handling:
} catch (error: any) {
  if (error?.name === 'AbortError') return;  // intentional cancel — silent exit
  // ... generic error handling
}

// In continuation handler:
sseAbortControllerRef.current?.abort();
sseAbortControllerRef.current = null;
// Also reset streaming state before resending:
streamingContentRef.current = '';
streamingSentences.current = 0;
setStreamingContent('');
setLoading(false);
setStatusMessage('');
```

**Rule**: Any long-running `fetch()` that may need to be cancelled must have an `AbortController` stored in a ref. The `catch` block must check `error?.name === 'AbortError'` first and return early — never surface an intentional abort as a user error. Always reset all streaming/loading state before resending after an abort.

---

### 40. Session-scoped React state is invisible to sibling full-screen components — bridge via localStorage

**Error encountered**: `facialAnalysis` state in `chat-interface.tsx` held the per-session camera analysis result. `EvaluationPanel` (rendered as a child with props) received it correctly. However, `PerformancePanel` (Review Performance screen) is rendered as an early-return branch of `chat-interface.tsx` — it replaces the entire session view and cannot receive per-session props because it renders *instead of* the session, not *inside* it. The Review Performance panel had no facial analysis section despite the feature being fully implemented.

**Root cause**: A component rendered via an early-return or sibling route pattern has no prop channel to the session that ran before it. React state is ephemeral and lost between navigations.

**Fix**: Persist the result to `localStorage` immediately after it is computed, so any component can read it independently:
```typescript
// In runFacialAnalysis(), after setFacialAnalysis(result):
try { localStorage.setItem('pitchmd_facial_last', JSON.stringify(result)); } catch { /* quota */ }

// In PerformancePanel useEffect on mount:
useEffect(() => {
  fetchData();
  try {
    const raw = localStorage.getItem('pitchmd_facial_last');
    if (raw) setFacialResult(JSON.parse(raw) as FacialResult);
  } catch { /* ignore */ }
}, []);
```

**Rule**: When a computed result needs to be available to components that can't receive it via props (sibling screens, separate early-return branches, components mounted after navigation), persist it to `localStorage` immediately after computing it. Use a stable key (`pitchmd_facial_last`). Always wrap both `setItem` and `getItem`/`JSON.parse` in try/catch — storage quota errors and stale malformed JSON must never crash the render.

---

### 41. Version history slider — localStorage-backed, with amber banner and delete modal

**Feature**: Account Dynamic editor maintains up to 10 saved versions. A slider in the edit toolbar lets the user navigate between Default (leftmost) and the latest save (rightmost). Viewing any intermediate version shows an amber banner. Users can delete intermediate ticks. Attempting an 11th save opens a delete modal.

**Implementation summary**:

**Data model** (`VERSIONS_STOR = 'pitchmd_versions_<accountId>'`):
```typescript
type Version = { version: number; savedAt: string; notes: string; data: FlowData };
// Stored newest-first in localStorage. adminDefault from Snowflake.
```

**Slider items** — Default at index 0, versions reversed so latest is last:
```typescript
const sliderItems = useMemo(() => {
  const items = [{ label: 'Default', data: adminDefault, notes: 'Account default set by admin.' }];
  [...versions].reverse().forEach(v => {
    items.push({ label: `v${v.version}`, data: v.data, notes: v.notes, versionNum: v.version });
  });
  return items;
}, [adminDefault, versions]);
```

**Slider index after save**: after `commitSave(updated)`, `sliderItems` has `1 + updated.length` entries. Latest is at `updated.length`:
```typescript
setSliderIdx(updated.length); // 0 = Default, 1..n = versions newest→oldest reversed
```

**Amber banner** — shown when not at Default and not at latest:
```typescript
const isViewingHistory = safeSliderIdx > 0 && safeSliderIdx < sliderItems.length - 1;
```

**Delete modal** — opens when attempting to save past `MAX_VERSIONS = 10`:
```typescript
const doSave = useCallback(() => {
  if (versions.length >= MAX_VERSIONS) { setShowDeleteModal(true); return; }
  commitSave(versions);
}, [versions, commitSave]);
```
Modal lists all deletable versions (all except the most recent one) with checkboxes. On confirm: filter out selected versions, then call `commitSave` on the pruned list.

**Rule**: Cap version lists at a fixed `MAX_VERSIONS` constant. Always intercept the save action before writing — check the limit first, open the delete modal if needed, and only call the actual commit function from a shared `commitSave` callback to avoid code duplication.

---

### 42. Gap Analysis tab in EvaluationPanel — lazy-loaded, Claude-powered coaching

**Feature**: A "Gap Analysis" tab in the post-session evaluation panel. Clicking it calls `/api/evaluation/gap-analysis`, which sends the session transcript to Claude Haiku and returns ranked coaching priorities (what the rep said vs. what an ideal rep would say).

**API endpoint** (`app/api/evaluation/gap-analysis/route.ts`):
- Input: `{ messages: {role, content, internal?}[], physicianId? }`
- Filter: extract only non-internal `user` turns (exclude `__begin_roleplay__`)
- Build labeled transcript: `"REP: ...\n\nPHYSICIAN: ..."`
- Ask Claude for JSON: `{ priorities: [{rank, area, repSaid, idealSaid, coaching}], overallAssessment }`
- Use `claude-haiku-4-5-20251001`, `max_tokens: 1500`
- Extract JSON with `text.match(/\{[\s\S]*\}/)` to handle any leading/trailing prose

**Props to add to EvaluationPanel**:
```typescript
sessionId?: string | null;
messages?: { role: string; content: string; internal?: boolean }[];
```
Pass from every `<EvaluationPanel>` callsite: `sessionId={sessionIdRef.current} messages={messagesRef.current}`.

**Tab state**: `activeTab: 'scores' | 'gap'`. Reset to `'scores'` and clear `gapAnalysis` when `open` becomes `false`.

**Lazy fetch**: call `fetchGapAnalysis()` only when the tab is first clicked and `!gapAnalysis && !gapLoading`.

**UI structure**:
- Overall assessment block (slate-50 background)
- Ranked priority cards: rank badge (orange) → area title → "Rep said" (italic quote) → "Ideal approach" (green bg quote) → "Coaching insight" (blue label + text)
- "Regenerate analysis" link at bottom (clears `gapAnalysis`, re-fetches)

**Rule**: Make gap analysis lazy — never auto-fetch on panel open. The Claude call takes 2–5 s; only run it when the user explicitly clicks the tab. Gate the initial fetch on `!gapAnalysis && !gapLoading` so switching tabs back and forth does not re-trigger it.
