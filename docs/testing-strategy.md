# Testing Strategy — Mythos Writer

> Canonical reference: [Code Quality Standard §3 + §7](/SKY/issues/SKY-356#document-code-quality-standard).
> This doc translates those requirements into concrete Mythos Writer practice.
> Read this before writing or reviewing any test.

---

## 1. Pyramid Shape

```
        ┌─────────────┐
        │     E2E     │  ← few; critical user journeys only
        ├─────────────┤
        │ Integration │  ← IPC contracts, multi-module flows
        ├─────────────┴──────────────────────────────────────┤
        │                   Unit                             │  ← broad, fast, isolated
        └────────────────────────────────────────────────────┘
```

| Layer | Runner | Location | Speed | Count goal |
|---|---|---|---|---|
| Unit | Vitest | `electron-main/tests/`, `frontend/src/**/*.test.*` | < 5 s total | Many |
| Integration | Vitest | `electron-main/tests/` (real SQLite, in-process IPC mocks) | < 30 s | Moderate |
| E2E | Playwright | `e2e/` | Minutes | Few — happy path + critical regression |

**Anti-pattern to refuse:** the ice-cream-cone — more E2E than unit tests. E2E is the most expensive layer (minutes, flaky, hard to debug). If a unit test can prove the same thing, write the unit test.

The two E2E suites required by CI are `e2e/vault-crud.spec.ts` (vault CRUD + persistence) and `e2e/brainstorm.spec.ts` (brainstorm agent flow). New E2E specs require explicit justification — the question is always "can a unit or integration test prove this instead?"

---

## 2. What a Good Test Looks Like

A test should be:

- **Focused** — one behavior per `it()`. If the description needs "and", split it.
- **Independent** — no shared mutable state between tests. Use `beforeEach` and `afterEach` to reset. Never rely on test execution order.
- **Deterministic** — same inputs → same result, always. No `Date.now()`, `Math.random()`, or real network calls inside unit tests. Mock or stub them.
- **Readable** — test names read as sentences describing behavior, not implementation. "disables prev button when canPrev is false" not "test button disabled state prop".
- **Behavior-not-implementation** — assert what the component/function does, not how it does it. Refactoring internals must not break a test when behavior is unchanged.

**Arrange-Act-Assert pattern** (Mythos Writer example from `frontend/src/DepthSlider.test.tsx`):

```ts
it('disables prev button when canPrev is false', () => {
  // Arrange
  render(<DepthSlider {...DEFAULT_PROPS} canPrev={false} />);

  // Act — (nothing to do; the state is set by the prop)

  // Assert
  expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
});
```

Assert on accessible roles, text content, and aria attributes — not class names or internal DOM structure.

---

## 3. Default Techniques on Every Change

These are required by default. Not optional.

### 3.1 Boundary-Value Analysis

Test at and immediately around every threshold. For any range, test: empty, one, min, min−1, max, max+1, zero, negative.

**Example — `frontend/src/themeAxis.test.ts`** (contrast ratio boundaries):

```ts
it('returns ~21:1 for white on black', () => {        // max meaningful ratio
  expect(contrastRatio('rgb(255,255,255)', 'rgb(0,0,0)')).toBeGreaterThan(20);
});

it('returns 1 for identical colours', () => {          // minimum ratio (same color)
  expect(contrastRatio('rgb(128,128,128)', 'rgb(128,128,128)')).toBeCloseTo(1, 1);
});

it('returns 0 when a colour cannot be parsed', () => { // invalid input boundary
  expect(contrastRatio('not-a-colour', 'rgb(0,0,0)')).toBe(0);
});
```

### 3.2 Equivalence Partitioning

Identify behavior classes and test one representative per class plus the class boundaries. Don't test three identical-behavior inputs when one suffices.

**Example — `frontend/src/DepthSlider.test.tsx`** (three depth levels are three behavior classes):

```ts
it('marks the active depth button as pressed', () => {
  render(<DepthSlider {...DEFAULT_PROPS} depth="chapter" />);
  // chapter is pressed (its class)
  expect(screen.getByRole('button', { name: /chapter/i })).toHaveAttribute('aria-pressed', 'true');
  // others are not (different classes)
  expect(screen.getByRole('button', { name: /full book/i })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: /scene/i })).toHaveAttribute('aria-pressed', 'false');
});
```

### 3.3 Edge-Case Checklist

Check these on every change that touches parsing, storage, or user-controlled input:

- [ ] Empty input / empty string
- [ ] Single element (array length 1)
- [ ] Null or absent / undefined
- [ ] Zero and negative numbers
- [ ] Max and min numeric values
- [ ] Duplicates where uniqueness is assumed
- [ ] Size at limit (e.g., max file name length, SQLite row limit)
- [ ] Special characters and Unicode (RTL text, emoji, NUL byte)
- [ ] Concurrent access interleavings (if code is async or touches shared state)
- [ ] Leap years, DST transitions, timezone boundaries (if code touches dates)

### 3.4 Negative and Adversarial Tests

Invalid inputs must be rejected with a clear, predictable error. The system must stay sane when dependencies are down or misbehaving.

**Example — `electron-main/tests/network-egress-on-first-run.spec.ts`** (adversarial: prove zero egress):

```ts
vi.mock('https', () => ({
  default: {
    request: vi.fn(() => {
      throw new Error('https.request must not fire on a clean boot');
    }),
  },
}));
```

The test replaces network APIs with spies that throw — if telemetry were misconfigured and tried to phone home, the test would fail loudly. The adversarial framing ("what could go wrong?") found a whole class of potential regressions.

---

## 4. Property-Based Testing

**When to use:**

- Parsers and serializers (round-trip: `parse(serialize(x)) === x`)
- Data-structure invariants (e.g., sorted order preserved after insert)
- Mathematical relationships (e.g., `f(a) + f(b) === f(a + b)`)
- Encoders/decoders

**Status:** No property-based framework is currently installed in Mythos Writer. Tooling selection (fast-check is the recommended candidate) is tracked as a follow-up subtask of [SKY-356](/SKY/issues/SKY-356). Do not block feature work on this — file the subtask instead.

**What it will look like** (illustrative, using fast-check):

```ts
// electron-main: round-trip property for scene markdown serializer
import fc from 'fast-check';
import { serializeScene, parseScene } from '../src/scene-format';

it('round-trips any valid scene', () => {
  fc.assert(fc.property(fc.record({
    title: fc.string(),
    body:  fc.string(),
  }), (scene) => {
    expect(parseScene(serializeScene(scene))).toEqual(scene);
  }));
});
```

Until fast-check is added, test representative sample inputs manually and document the property you are checking in the test description.

---

## 5. Fuzzing

**When required:** Any code that parses untrusted input — file formats read from disk (vault `.md` files, `manifest.json`), user-supplied text in the editor, IPC message payloads.

**Status:** No fuzzing framework is currently wired into CI. Adding a fuzz target (e.g., node-fuzz or a custom Vitest harness for structured fuzzing) is tracked as a follow-up subtask of [SKY-356](/SKY/issues/SKY-356).

**How to add a fuzz target when tooling is in place:**

1. Create `electron-main/fuzz/<target-name>.fuzz.ts`.
2. Accept a `Buffer` from the fuzzer and pass it through the parser under test.
3. Assert the parser either returns a valid result or throws a typed error — it must never crash the process or hang.
4. Add the fuzz target to the CI `fuzz` job (details in the follow-up subtask).

**Triaging findings:**

- Crash → file a bug, write a reproducing unit test immediately, fix before merge.
- Hang (> 10 s) → treat as a crash.
- Unexpected output (no throw, wrong result) → add to equivalence partition tests, fix.
- False positive (valid input rejected) → add as a boundary-value test, fix.

---

## 6. Regression Discipline

**Rule:** Every fixed bug gets a permanent, named regression test. Write the failing test **before** the fix. The test must be seen to fail (red) before it is seen to pass (green). The test stays in the suite forever.

**Why before the fix:** writing the test first proves you understand the actual failure mode, not just the symptom. It also guarantees the test is meaningful — if it passes on the broken code, it is not testing the right thing.

**Example — `electron-main/tests/network-egress-on-first-run.spec.ts`:**

The comment at the top explains the audit invariant and references the issue (`MYT-775`). The test exists because a real concern (telemetry phoning home on first run) required a permanent guard. The test name and comment make it searchable and self-documenting.

**Commit message convention for regression tests:**

```
test(MYT-NNN): add regression for <bug description>

Reproduces the failure before the fix: <what was broken>.
```

---

## 7. Coverage Policy

**Coverage is a floor and a flashlight — not a target.**

A high coverage percentage does not mean the suite is good. A suite of assertion-free `it('renders', () => { render(...) })` tests can hit 90% coverage and catch nothing. Mutation testing is the honest measure.

**Current floor:** There is no enforced numeric coverage floor. The real requirement is: every behavior class and boundary is covered by an assertion that can fail. Use `npm run test -- --coverage` as a flashlight to find untouched code paths, then ask "does this path need a test?" — not "how do I raise the percentage?"

**Mutation testing (recommended):**

[Stryker](https://stryker-mutator.io/) is the recommended mutation testing tool for TypeScript projects.

```bash
# Run Stryker on the frontend package (once configured)
npx stryker run --config frontend/stryker.config.js
```

A mutation score below ~70% in a critical module is a signal to add more behavior-asserting tests. Do not run Stryker on every PR — run it periodically or when a module's test suite is under review. Stryker configuration is tracked as a follow-up subtask of [SKY-356](/SKY/issues/SKY-356).

---

## 8. No Test You Haven't Seen Fail

**Rule:** Before committing a new test, you must watch it fail.

The procedure:
1. Write the test.
2. Temporarily break the code it tests (comment out the logic, return a wrong value, etc.) or run it against the bug it is supposed to catch.
3. Confirm the test fails with a meaningful error message, not a timeout or an unrelated assertion.
4. Restore the code (or apply the fix).
5. Confirm the test passes.

**Why this matters:** A test that passes on broken code is not a test — it is false confidence. `it('does not throw', () => { render(<Foo />) })` will always pass, even if Foo is completely broken, because it asserts nothing.

**Enforcement:** This is a personal discipline rule, not a CI gate. Code reviewers should ask "have you seen this test fail?" for any new test that is not obviously a regression test (where the failing state is implied by the bug fix).

---

## Quick Reference: Running Tests

```bash
# Unit tests (electron-main + frontend)
npm run test

# Frontend unit tests only (faster during UI work)
npm run test -w frontend

# electron-main unit tests only
npm run test -w electron-main

# E2E — required CI suites
npm run test:e2e:crud
npm run test:e2e:brainstorm

# Accessibility E2E
npm run test:e2e:a11y

# All E2E
npm run test:e2e

# Coverage (flashlight mode — see §7)
npm run test -w frontend -- --coverage
```

All of the above run on Linux and macOS. CI runs them on both via `.github/workflows/ci.yml`.
