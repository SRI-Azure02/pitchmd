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
