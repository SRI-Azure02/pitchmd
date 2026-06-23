# PitchMD Comprehensive Test Suite Plan

**Status:** In Progress  
**Last Updated:** 2026-06-23  
**Total Tests Target:** 1,400-1,700  
**Sessions Estimated:** 15-20  

---

## Overview

This document is the canonical reference for the PitchMD test suite implementation. Each session should reference this document to maintain consistency and track progress.

### Philosophy

- **Quality over quantity:** Aim for 90-95% code coverage per module, not artificial test counts
- **Real-world scenarios:** Test how code is actually used, not just happy paths
- **Error handling:** Comprehensive error and edge-case testing
- **Maintainability:** Tests should be clear, independent, and easy to update
- **Parallel sessions:** Tests can be written in any order as long as dependencies are mocked

### Testing Framework

- **Unit/Integration:** Vitest + React Testing Library
- **API Mocking:** MSW (Mock Service Worker)
- **External Services:** All mocked (Snowflake, Anthropic, Groq, Tavus, etc.)
- **Output:** Coverage reports, test counts, pass/fail status

---

## Module Testing Matrix

### Phase 1: Core Libraries (Sessions 1-3)

#### Module 1.1: `lib/compliance-filter.ts`
**File:** `tests/lib/compliance-filter.test.ts`  
**Target Tests:** 80-100  
**Coverage Goal:** 95%  
**Priority:** CRITICAL (security/compliance feature)

**Test Categories:**

1. **checkInput() — Clean Path (15 tests)**
   - Plain rep messages (no violations)
   - Empty/whitespace-only text
   - Non-pharmaceutical topics
   - Standard clinical questions
   - Known-good phrases
   - Abbreviations and acronyms
   - Numeric-only input
   - Mixed case text
   - International characters
   - Very long messages

2. **checkInput() — Flagged Path (15 tests)**
   - Off-label claims (mild)
   - Competitor disparagement
   - PII patterns (email, phone, SSN)
   - Out-of-domain questions
   - Soft injection attempts
   - Ambiguous claims
   - Brand + off-label combinations
   - Flagged but conversation continues
   - Multiple violations in one message
   - Flagged with different severity levels

3. **checkInput() — Blocked Path (12 tests)**
   - Hard injection attempts
   - Prohibited phrases (block-level)
   - PII + off-label combo (blocked)
   - Extreme off-label
   - SQL injection patterns
   - XSS injection patterns
   - Command injection patterns
   - Blocked skips Claude entirely
   - Multiple block-level violations
   - Block takes priority over flag
   - Block message clarity
   - Block response structure

4. **checkOutput() — Clean Path (15 tests)**
   - Balanced efficacy claims
   - Safety statements present
   - No superlatives
   - Competitor not mentioned
   - Safe boilerplate responses
   - Short question replies
   - Numeric data only
   - Full PI quotes
   - Proper fair-balance language
   - Multiple claim types (clean)
   - Emoticons/special chars
   - Very long responses

5. **checkOutput() — Rewrite Needed (12 tests)**
   - Efficacy claim without balance
   - Superlative language ("best", "superior")
   - Safety minimization
   - Off-label AI response
   - Fair-balance trigger phrases
   - Compound violations
   - Missing required balance statement
   - Multiple rewrite-needed violations
   - Efficacy without specific markers
   - Balance indicators partially present
   - Borderline efficacy claims
   - Balance statement formatting

6. **FilterResult Shape Validation (5 tests)**
   - Violations array populated correctly
   - primaryViolation is highest-severity
   - rewrittenText only present on rewrite status
   - Result type correctness
   - All required fields present

7. **buildBalanceInjection() (5 tests)**
   - Generates correct injection text
   - Includes all rewrite-needed violations
   - Proper formatting
   - Handles zero violations
   - Handles multiple violations

8. **Edge Cases & Errors (8 tests)**
   - Empty rules array returns clean
   - Null text handled safely
   - Rule with no regex pattern skipped
   - Empty trigger list skipped
   - Null rule in array skipped
   - Very large text (100KB)
   - Unicode edge cases
   - Performance under load

**Acceptance Criteria:**
- [ ] All 80-100 tests pass
- [ ] 95%+ code coverage
- [ ] All code paths tested
- [ ] Error scenarios handled
- [ ] All edge cases covered

---

#### Module 1.2: `lib/pdf-chunker.ts`
**File:** `tests/lib/pdf-chunker.test.ts`  
**Target Tests:** 60-80  
**Coverage Goal:** 95%  
**Priority:** HIGH (RAG pipeline dependency)

**Test Categories:**

1. **Sliding Window Basics (12 tests)**
   - Chunk count from 800-word text
   - Overlap is exactly 60 words
   - Step size is 340 words
   - First chunk starts at word 0
   - Second chunk starts at word 340
   - Last chunk includes trailing words
   - Single chunk for <400 words
   - Exact 400-word text
   - 401-word text produces 2 chunks
   - 739-word text produces 2 chunks
   - 740-word text produces 3 chunks
   - 10,000-word text correct count

2. **Word Count Accuracy (10 tests)**
   - Verify chunk word counts
   - Overlap region contains correct words
   - No words dropped (total coverage)
   - Duplicated region is exactly 60 words
   - Multi-line text same as single-line
   - Text with tabs/special chars
   - Unicode characters preserved
   - Accented characters
   - Mixed languages
   - Emoji handling

3. **Edge Cases (10 tests)**
   - Empty string returns []
   - Single word returns 1 chunk
   - 30 words (MIN_CHUNK_WORDS) returns 1
   - 29 words returns empty (below threshold)
   - Exactly MIN_CHUNK_WORDS boundary
   - Very long single words
   - Only whitespace returns []
   - Null bytes ignored
   - Mixed line endings (CRLF, LF, CR)
   - Consecutive newlines collapsed

4. **Whitespace Handling (10 tests)**
   - Leading/trailing whitespace stripped
   - Consecutive spaces collapsed
   - Tabs treated as space
   - Multiple spaces between words
   - Newlines treated as space
   - Mixed whitespace types
   - Whitespace in chunk text
   - Preserve internal spacing
   - Trailing newlines
   - Leading newlines

5. **Section Label Extraction (10 tests)**
   - Numbered section detected ("1 INDICATIONS")
   - All-caps heading detected
   - Nested numbering detected ("5.3 Cytopenias")
   - Label doesn't bleed into body
   - First chunk has section label
   - Section label trimmed to 200 chars
   - No label when no marker
   - Heading with dashes detected
   - Heading with parentheses detected
   - Case sensitivity in detection

6. **Integration with unpdf Mock (8 tests)**
   - Mock returning flat text produces chunks
   - Mock returning paged text merges pages
   - Empty PDF returns error
   - Page-break tokens stripped
   - Real PI text sample (~66 chunks expected)
   - Chunk sequence numerically ordered
   - Page number calculation correct
   - Chunk indices sequential

**Acceptance Criteria:**
- [ ] All 60-80 tests pass
- [ ] 95%+ code coverage
- [ ] Sliding window algorithm verified
- [ ] Edge cases thoroughly tested
- [ ] Integration with unpdf confirmed

---

#### Module 1.3: `lib/utils.ts` + `lib/dates.ts` + `lib/validate.ts` + `lib/rate-limit.ts` + `lib/product-name-corrector.ts`
**File:** `tests/lib/index.test.ts` (combined)  
**Target Tests:** 100-120  
**Coverage Goal:** 90%  
**Priority:** MEDIUM (utility functions)

**Test Categories:**

1. **cn() class merging (12 tests)**
   - Merges two class strings
   - Deduplicates Tailwind conflicts
   - Handles undefined/null
   - Handles empty strings
   - Conditional class
   - Array input
   - Object input
   - Nested calls
   - Multiple conflicts
   - Tailwind-specific classes
   - Custom classes
   - Mixed with empty strings

2. **date-fns utilities (12 tests)**
   - Format ISO date
   - Relative time "2 days ago"
   - "Today"
   - "Just now"
   - Invalid date returns fallback
   - Timezone handling
   - Null input
   - Future date
   - Date before epoch
   - Large date range
   - Leap year handling
   - Daylight savings

3. **validate.ts (10 tests)**
   - Valid email accepted
   - Invalid email formats rejected (5 variants)
   - Non-empty string accepted
   - Empty string rejected
   - Whitespace-only rejected
   - Numeric input handling
   - Email edge cases
   - Special characters
   - Unicode in email
   - Very long email

4. **rate-limit.ts (12 tests)**
   - First call allowed
   - Nth call within limit allowed
   - N+1 call blocked
   - Window resets after TTL
   - Different keys don't share limits
   - Same key across calls
   - Zero limit blocks all
   - Negative window throws
   - Concurrent calls handled
   - Multiple rate limiters
   - Edge of time window
   - Just before TTL expires

5. **product-name-corrector.ts (12 tests)**
   - "venclexta" → "Venclexta"
   - "venetoclax" → "Venetoclax"
   - "ibrutinib" corrected
   - Mixed-case brand preserved
   - Unknown drug name unchanged
   - Empty string unchanged
   - Multiple brands in sentence
   - Possessive form corrected
   - Hyphenated brand corrected
   - All-caps brand corrected
   - Partial matches not corrected
   - Numbers in brand names

6. **Cross-utility integration (50 tests)**
   - cn() + conditional pattern
   - date formatter + Snowflake TIMESTAMP
   - validator used in form pattern
   - rate limiter thread-safe
   - corrector applied post-STT
   - All utilities together
   - Performance under load
   - Error propagation
   - Null safety
   - Type correctness
   - etc. (realistic integration scenarios)

**Acceptance Criteria:**
- [ ] All 100-120 tests pass
- [ ] 90%+ code coverage
- [ ] All utilities verified
- [ ] Integration scenarios work
- [ ] No cross-utility conflicts

---

### Phase 2: Core Types & Configuration (Sessions 4-5)

#### Module 2.1: `lib/mindset-types.ts` + `lib/mindset-descriptions.ts`
**File:** `tests/lib/mindset.test.ts`  
**Target Tests:** 50-60  
**Coverage Goal:** 95%  
**Priority:** MEDIUM (physician persona)

**Test Categories:**

1. **MINDSET_DIMENSIONS integrity (8 tests)**
2. **PRESET_MINDSETS integrity (8 tests)**
3. **CustomMindset type validation (8 tests)**
4. **Mindset descriptions (8 tests)**
5. **Serialization to system prompt (10 tests)**
6. **Dimension value extremes (6 tests)**
7. **Data integrity & edge cases (4 tests)**

**Acceptance Criteria:**
- [ ] All 50-60 tests pass
- [ ] 95%+ code coverage
- [ ] All 5 presets validated
- [ ] All 7 dimensions tested
- [ ] Serialization works correctly

---

### Phase 3: API Routes (Sessions 6-10)

#### Module 3.1: `app/api/auth/*`
**File:** `tests/api/auth.test.ts`  
**Target Tests:** 80-100  
**Coverage Goal:** 95%  
**Priority:** CRITICAL (security)

#### Module 3.2: `app/api/evaluation/*`
**File:** `tests/api/evaluation.test.ts`  
**Target Tests:** 80-100  
**Coverage Goal:** 95%  
**Priority:** HIGH (core feature)

#### Module 3.3: `app/api/compliance/*`
**File:** `tests/api/compliance.test.ts`  
**Target Tests:** 100-120  
**Coverage Goal:** 95%  
**Priority:** CRITICAL (compliance)

#### Module 3.4: `app/api/roleplay/message`
**File:** `tests/api/roleplay.test.ts`  
**Target Tests:** 120-150  
**Coverage Goal:** 95%  
**Priority:** CRITICAL (core feature)

#### Module 3.5: Other API Routes (STT, Accounts, etc.)
**File:** `tests/api/other.test.ts`  
**Target Tests:** 80-100  
**Coverage Goal:** 90%  
**Priority:** MEDIUM

---

### Phase 4: React Components (Sessions 11-16)

#### Module 4.1: `components/chat-interface.tsx`
**File:** `tests/components/chat-interface.test.tsx`  
**Target Tests:** 120-150  
**Coverage Goal:** 90%  
**Priority:** CRITICAL (main UI)

#### Module 4.2: `components/evaluation-panel.tsx`
**File:** `tests/components/evaluation-panel.test.tsx`  
**Target Tests:** 100-120  
**Coverage Goal:** 90%  
**Priority:** HIGH

#### Module 4.3: `components/audio-input.tsx`
**File:** `tests/components/audio-input.test.tsx`  
**Target Tests:** 100-120  
**Coverage Goal:** 95%  
**Priority:** HIGH (complex timing)

#### Module 4.4: Other Components (playbook, performance, account-flow-editor)
**File:** `tests/components/other.test.tsx`  
**Target Tests:** 280-360  
**Coverage Goal:** 90%  
**Priority:** MEDIUM-HIGH

---

### Phase 5: Integration & E2E (Sessions 17-19)

#### Module 5.1: Cross-Module Integration
**File:** `tests/integration/cross-module.test.ts`  
**Target Tests:** 80-100  
**Coverage Goal:** 85%  
**Examples:**
- Compliance filter → Roleplay message flow
- Audio input → STT → Compliance check → LLM
- Evaluation panel → Gap analysis flow

#### Module 5.2: End-to-End Workflows
**File:** `tests/e2e/workflows.test.ts`  
**Target Tests:** 80-100  
**Coverage Goal:** 85%  
**Examples:**
- Full roleplay session: auth → physician selection → message → compliance → evaluation
- Account flow: account creation → dynamic default load → save → versioning

#### Module 5.3: Performance & Stress
**File:** `tests/performance/load.test.ts`  
**Target Tests:** 40-60  
**Coverage Goal:** 80%  
**Examples:**
- 100 concurrent compliance checks
- Large PDF ingestion (10 MB)
- Long conversation history (1000 messages)

---

## Session Template

Each session should follow this structure:

```
SESSION N: [Module Name]

TARGET: [Test count] tests, [coverage]% coverage
FILES: tests/path/to/test.ts
MODULE: lib/path/to/module.ts

COMPLETED TESTS:
- Category 1: X/Y tests ✅
- Category 2: X/Y tests ✅
- Category 3: X/Y tests ✅

TOTAL: X/Y tests passing, Z% coverage

NEXT SESSION: [Next module]
```

---

## Progress Tracking

### Master Progress

| Phase | Module | Status | Tests | Coverage | Session |
|-------|--------|--------|-------|----------|---------|
| 1 | compliance-filter | ⏳ TODO | 80-100 | — | 1 |
| 1 | pdf-chunker | ⏳ TODO | 60-80 | — | 2 |
| 1 | utils/dates/validate/etc | ⏳ TODO | 100-120 | — | 3 |
| 2 | mindset-types | ⏳ TODO | 50-60 | — | 4 |
| 3 | auth routes | ⏳ TODO | 80-100 | — | 5 |
| 3 | evaluation routes | ⏳ TODO | 80-100 | — | 6 |
| 3 | compliance routes | ⏳ TODO | 100-120 | — | 7 |
| 3 | roleplay routes | ⏳ TODO | 120-150 | — | 8 |
| 3 | other routes | ⏳ TODO | 80-100 | — | 9 |
| 4 | chat-interface | ⏳ TODO | 120-150 | — | 10 |
| 4 | evaluation-panel | ⏳ TODO | 100-120 | — | 11 |
| 4 | audio-input | ⏳ TODO | 100-120 | — | 12 |
| 4 | other components | ⏳ TODO | 280-360 | — | 13-15 |
| 5 | integration | ⏳ TODO | 80-100 | — | 16 |
| 5 | e2e | ⏳ TODO | 80-100 | — | 17 |
| 5 | performance | ⏳ TODO | 40-60 | — | 18 |

**Total Progress:** 0/1400+ tests

---

## Acceptance Criteria (Global)

- [ ] Total tests written: 1,400-1,700
- [ ] Overall coverage: 90%+
- [ ] All tests passing
- [ ] No skipped tests
- [ ] Coverage reports generated
- [ ] Documentation updated
- [ ] Tests committed to git

---

## Testing Best Practices

1. **Mock external services** — Never call real Snowflake, Anthropic, etc.
2. **Isolated tests** — Each test should be independent
3. **Clear names** — Test names describe what is being tested
4. **Arrange-Act-Assert** — Follow AAA pattern
5. **DRY test code** — Use helpers and fixtures
6. **Fast execution** — Target <10 ms per test
7. **Comprehensive coverage** — Happy path + errors + edges
8. **No skip()** — Mark as TODO if test is incomplete

---

## How to Use This Document

**At the start of each session:**
1. Read the module section for your assigned module
2. Note the target test count and coverage goal
3. Review test categories to ensure comprehensive coverage

**During the session:**
1. Write tests following the categories
2. Run `npm test` to verify
3. Check coverage with `npm run test:coverage`

**At the end of each session:**
1. Update the progress table above
2. Commit tests: `git add tests/ && git commit -m "test: add [module] tests (X tests, Y% coverage)"`
3. Push: `git push origin dev`
4. Note the "NEXT SESSION" module for continuity

---

## Notes

- Tests can be written in any order (dependencies are mocked)
- Sessions can be done in parallel if working with different modules
- Use snapshot tests sparingly (only for complex output validation)
- Prefer explicit assertions over snapshots
- Keep test files under 500 lines (split if needed)

