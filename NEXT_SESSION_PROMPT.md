# Session 1: Start Comprehensive Test Suite

## Context

You are beginning the **PitchMD comprehensive test suite** implementation. This is Session 1 of ~18 sessions.

**Repository:** https://github.com/harshadchiddarwar/pitchmd  
**Branch:** dev  
**Test Framework:** Vitest + React Testing Library + MSW  
**Status:** All infrastructure complete, ready for test implementation

## Your Assignment: Session 1

You will implement **comprehensive tests for two core library modules:**

### Module 1.1: `lib/compliance-filter.ts`
- **Target:** 80-100 tests
- **Coverage Goal:** 95%
- **File:** `tests/lib/compliance-filter.test.ts`
- **Reference:** TEST_PLAN.md, lines 55-135

### Module 1.2: `lib/pdf-chunker.ts`
- **Target:** 60-80 tests
- **Coverage Goal:** 95%
- **File:** `tests/lib/pdf-chunker.test.ts`
- **Reference:** TEST_PLAN.md, lines 137-215

---

## What To Do

### Step 1: Understand the Assignment

Read these files:
1. `TEST_PLAN.md` — Lines 55-215 (your module specs)
2. `lib/compliance-filter.ts` — Understand the API and logic
3. `lib/pdf-chunker.ts` — Understand the API and logic
4. Look at existing test examples if any (in `tests/setup.ts`)

### Step 2: Understand the Test Categories

**compliance-filter.ts has 8 test categories:**
1. checkInput() — Clean Path (15 tests)
2. checkInput() — Flagged Path (15 tests)
3. checkInput() — Blocked Path (12 tests)
4. checkOutput() — Clean Path (15 tests)
5. checkOutput() — Rewrite Needed (12 tests)
6. FilterResult Shape Validation (5 tests)
7. buildBalanceInjection() (5 tests)
8. Edge Cases & Errors (8 tests)

**pdf-chunker.ts has 8 test categories:**
1. Sliding Window Basics (12 tests)
2. Word Count Accuracy (10 tests)
3. Edge Cases (10 tests)
4. Whitespace Handling (10 tests)
5. Section Label Extraction (10 tests)
6. Integration with unpdf Mock (8 tests)
7. Chunk metadata (10 tests)
8. (Additional edge cases to reach 60-80 target)

### Step 3: Write the Tests

Create two test files:

#### `tests/lib/compliance-filter.test.ts`
- Import the module: `import { checkInput, checkOutput, buildBalanceInjection, ComplianceRule } from '@/lib/compliance-filter'`
- Use Vitest: `describe()`, `it()`, `expect()`
- Follow AAA pattern: Arrange, Act, Assert
- Mock external dependencies (none for this module)
- Target: 80-100 tests

#### `tests/lib/pdf-chunker.test.ts`
- Import the module: `import { pdfToChunks, DocumentChunk } from '@/lib/pdf-chunker'`
- Mock `unpdf` library: `vi.mock('unpdf', () => ({ ... }))`
- Mock pdf parsing: Return mock text data
- Follow AAA pattern
- Target: 60-80 tests

### Step 4: Run the Tests

```bash
npm test -- tests/lib/compliance-filter.test.ts tests/lib/pdf-chunker.test.ts
```

### Step 5: Check Coverage

```bash
npm run test:coverage -- tests/lib/
```

Target: 95% coverage for both modules.

### Step 6: Report Results

At the end of your session, provide a report in this format:

```
SESSION 1 RESULTS
================

compliance-filter.ts:
  ✅ 87 tests written
  ✅ 95% coverage (312/312 lines)
  ✅ All tests passing

pdf-chunker.ts:
  ✅ 72 tests written
  ✅ 96% coverage (97/97 lines)
  ✅ All tests passing

TOTAL: 159 tests, 95% coverage

NEXT SESSION: lib/utils.ts + lib/dates.ts + lib/validate.ts + lib/rate-limit.ts + lib/product-name-corrector.ts
```

### Step 7: Commit and Push

```bash
git add tests/lib/compliance-filter.test.ts tests/lib/pdf-chunker.test.ts
git commit -m "test: add compliance-filter and pdf-chunker tests (159 tests, 95% coverage)

- compliance-filter.ts: 87 tests covering 8 categories (checkInput clean/flag/block, checkOutput clean/rewrite, edge cases)
- pdf-chunker.ts: 72 tests covering 8 categories (sliding window, word count, edges, whitespace, sections, integration)
- Coverage: 95%+ for both modules
- All external dependencies mocked (unpdf)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push origin dev
```

---

## Testing Guidelines

### DO's ✅

- **Test real scenarios:** How will this code actually be used?
- **Test errors:** What happens when things fail?
- **Test edges:** Boundaries, empty input, huge input, null, undefined
- **Use descriptive names:** `it('should reject email with no @ symbol', () => ...)`
- **Follow AAA:** Arrange (setup) → Act (call) → Assert (verify)
- **Mock external calls:** Never call real APIs, databases, or file systems
- **Keep tests fast:** Target <10ms per test, <1s for entire file
- **Be independent:** Each test should work standalone, no shared state

### DON'Ts ❌

- Don't test implementation details (test behavior, not code paths)
- Don't use `test.skip()` — complete or mark as TODO in code
- Don't test third-party libraries (assume they work)
- Don't have flaky tests (timing-dependent, random failures)
- Don't make huge test files (>500 lines, split into multiple files)
- Don't forget edge cases (empty, null, huge, malformed, etc.)
- Don't snapshot test unless absolutely necessary (use explicit assertions)

---

## Code Structure Example

```typescript
// tests/lib/compliance-filter.test.ts

import { describe, it, expect } from 'vitest';
import { checkInput, checkOutput } from '@/lib/compliance-filter';

describe('compliance-filter', () => {
  describe('checkInput', () => {
    describe('clean path', () => {
      it('should return clean status for plain rep message', () => {
        // Arrange
        const text = 'What are the indications for Venclexta?';
        const rules = []; // Empty rules = clean

        // Act
        const result = checkInput(text, rules);

        // Assert
        expect(result.status).toBe('clean');
        expect(result.violations).toHaveLength(0);
      });

      it('should return clean for empty text', () => {
        // Arrange
        const text = '';
        const rules = [];

        // Act
        const result = checkInput(text, rules);

        // Assert
        expect(result.status).toBe('clean');
      });

      // ... more tests
    });

    describe('flagged path', () => {
      it('should flag off-label claim', () => {
        // Arrange
        const text = 'It can also be used for breast cancer';
        const rules = [
          {
            RULE_CODE: 'OFF_LABEL_001',
            SEVERITY: 'warning',
            RULE_TYPE: 'off_label',
            DESCRIPTION: JSON.stringify({
              triggers: ['breast cancer', 'lung cancer'],
            }),
            ACTIVE: true,
          },
        ];

        // Act
        const result = checkInput(text, rules);

        // Assert
        expect(result.status).toBe('flagged');
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].action).toBe('flagged');
      });

      // ... more tests
    });

    describe('blocked path', () => {
      it('should block hard injection', () => {
        // Arrange
        const text = "'; DROP TABLE users; --";
        const rules = [
          {
            RULE_CODE: 'INJECTION_001',
            SEVERITY: 'block',
            RULE_TYPE: 'injection',
            DESCRIPTION: JSON.stringify({
              triggers: ["'; DROP", "DROP TABLE"],
            }),
            ACTIVE: true,
          },
        ];

        // Act
        const result = checkInput(text, rules);

        // Assert
        expect(result.status).toBe('blocked');
        expect(result.violations[0].action).toBe('blocked');
      });

      // ... more tests
    });
  });

  describe('checkOutput', () => {
    // ... similar structure
  });

  describe('buildBalanceInjection', () => {
    // ... tests for this function
  });
});
```

---

## External Dependencies to Mock

**For compliance-filter.ts:**
- None! (Self-contained, no imports from lib/)

**For pdf-chunker.ts:**
- Mock `unpdf` package:
  ```typescript
  vi.mock('unpdf', () => ({
    getDocumentProxy: vi.fn(),
    extractText: vi.fn(),
  }));
  ```

---

## File Structure to Create

```
tests/
  ├── lib/
  │   ├── compliance-filter.test.ts    ← Create this
  │   ├── pdf-chunker.test.ts          ← Create this
  │   └── index.test.ts               (for next session)
  ├── api/                             (for future sessions)
  ├── components/                      (for future sessions)
  ├── integration/                     (for future sessions)
  └── setup.ts                         (already exists)
```

---

## Success Criteria

At the end of this session, verify:

- [ ] `tests/lib/compliance-filter.test.ts` exists with 80-100 tests
- [ ] `tests/lib/pdf-chunker.test.ts` exists with 60-80 tests
- [ ] `npm test` runs both files without error
- [ ] All tests passing
- [ ] Coverage 95%+ for both modules
- [ ] Code coverage reports generated
- [ ] Changes committed to git
- [ ] Changes pushed to origin/dev

---

## Reference Documents

In case you need them:

1. **TEST_PLAN.md** — Complete test specification (lines 55-215 for your modules)
2. **REQUIREMENTS.md** — Dependency catalog
3. **lib/compliance-filter.ts** — Source code (~312 lines)
4. **lib/pdf-chunker.ts** — Source code (~97 lines)
5. **vitest.config.ts** — Test configuration
6. **tests/setup.ts** — Test environment setup

---

## Questions During Implementation?

Refer back to TEST_PLAN.md for the exact test categories and counts. If unclear:

1. Read the test category description in TEST_PLAN.md
2. Look at the source code being tested
3. Ask yourself: "What behavior should this code have?"
4. Write a test that verifies that behavior

---

## You're Ready!

All the infrastructure is in place. You just need to write comprehensive tests following the TEST_PLAN.md specification.

**Start by reading `lib/compliance-filter.ts` and `lib/pdf-chunker.ts` to understand what you're testing.**

Then write 80-100 tests for compliance-filter and 60-80 tests for pdf-chunker.

Good luck! 🚀

