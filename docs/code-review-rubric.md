# Code Review Rubric

**Standard:** Code Quality Standard — Correct, Clear, Simple, Tested, Bulletproof
**Priority order:** correctness > readability > simplicity > maintainability > performance
**Source of truth:** [`plans/ProjectGoalOverView/13-Code-Quality.md`](../plans/ProjectGoalOverView/13-Code-Quality.md)
**Applies to:** every PR on Mythos Writer and Obsidian Liquid Neon.

---

## How to use this rubric

Every reviewer runs through each section below before approving. If any item fails, request changes — politely, with the rule and the why. When in doubt, the priority order above is the tiebreaker: correctness always wins.

---

## 1. Correctness

- Does the change handle the full input space, including the edge-case checklist below?
- Are error paths covered as carefully as the happy path?
- Does behavior hold at every documented boundary?
- Are invariants preserved under concurrent access, failure, and unexpected input?
- "It seems to work" is not evidence. Boundary tests must exist.

## 2. Clarity

- Could a new engineer understand each function from its name and signature alone?
- Is nesting flat? Are functions single-purpose and short enough to hold in mind?
- Do names reveal intent — no abbreviations that require context to decode?
- Are there hidden state mutations or hidden side effects in apparently pure code?
- Is the WHY of non-obvious decisions captured (a comment on a constraint, not a description of the code)?

## 3. Simplicity

- Is any new complexity essential (the problem demands it) vs. accidental (we introduced it)?
- Cut the accidental. Every abstraction must justify itself with ≥ 2–3 real, present cases.
- No speculative abstractions, flags-for-the-future, or "in case we need it later" patterns.
- No duplicated knowledge (coincidental similarity in two places is fine; duplicated logic/invariant is not).

## 4. Tests

- Boundary tests present? Do assertions check observable behavior, not implementation internals?
- Were tests seen to fail before they were seen to pass?
- For any bug fixed: is a permanent regression test included that reproduces the exact failure?
- For parsers, serializers, or untrusted input: is property-based testing or fuzzing in place (or tracked as a follow-up)?
- No tests commented out, no `.only` left in the suite.

## 5. CI / Safety

- Lint, typecheck, tests, and build all green before requesting review?
- No new accidental coupling between modules?
- No swallowed errors or empty catch blocks?
- No secrets, credentials, or customer data in the diff?
- Branch is current with `main`?

---

## Definition of Done (checklist form)

A change is **not done** until **all** of these hold:

- [ ] Correct across the input space — behavior verified at boundaries, edges, and the documented contract.
- [ ] Clear — names reveal intent; functions short and single-purpose; nesting flat; no hidden state.
- [ ] No new accidental complexity — no speculative abstractions, no flags-for-the-future, no duplicated knowledge.
- [ ] Error paths handled — fails fast and loudly, never swallows errors, preserves invariants under failure.
- [ ] Boundary tests with behavior-level assertions — each test has been seen to fail before pass.
- [ ] Regression test for any bug fixed — permanent, kept forever.
- [ ] Green CI — lint, typecheck, tests, build all pass on the change before merge.

---

## Edge-case checklist (apply by default to every change)

When reviewing tests and the logic under them, walk through:

- Empty input / empty collection
- Single element
- Null / absent / undefined
- Zero and negative numbers
- Max and min numeric values (and max+1, min−1)
- Duplicates where uniqueness was assumed
- Collection at size limit
- Special characters and Unicode (especially in user-authored text)
- Concurrent access interleavings (where relevant)
- Leap years, DST transitions, time-zone boundaries (for any date/time code)

---

## Required testing techniques

| Technique | When to apply |
|---|---|
| **Boundary-value analysis** | Every threshold — test at, just below, and just above. |
| **Equivalence partitioning** | One representative per behavior class + the boundary between classes. |
| **Edge-case checklist** | Always — see section above. |
| **Negative / adversarial tests** | Invalid input rejected with clear error; system sane when a dependency is down/slow/garbage. |
| **Property-based testing** | Any code with mathematical properties: parsers, serializers, data-structure ops, round-trips. |
| **Fuzzing** | Any code that parses untrusted input: file formats, network protocols, user-supplied data. |
| **Regression test for every bug** | Write the failing test **before** the fix; keep it forever. |

Coverage is a floor and a flashlight, never a target. Mutation testing is preferred for measuring suite effectiveness.

---

## Anti-patterns to refuse at review

Politely reject these; they are net negatives regardless of whether they "work":

- Long functions, deep nesting, god objects, excessive coupling.
- Duplication of **knowledge** (duplicated invariant, duplicated logic — not coincidental similarity in different contexts).
- Magic numbers and un-named string literals.
- Premature optimization that costs clarity for no measured win.
- Speculative abstraction "in case we need it later" (rule of three: wait for the third case).
- Mutable global state, hidden side effects in pure-looking functions.
- Swallowed errors, empty catch blocks, vague catch-all rescues.
- Tests coupled to implementation; tests that have never been seen to fail; commented-out tests; `.only` left in suite.

---

## Definition of Done applied to bug fixes

Every bug fix MUST include:

1. A **failing test that reproduces the bug**, written before the fix.
2. The minimal fix that turns that test green.
3. A short note in the test or commit referencing the incident — so future maintainers don't "simplify away" a load-bearing workaround.

The bug must never silently return.

---

## Related

- Full 6-part report: [`plans/ProjectGoalOverView/13-Code-Quality.md`](../plans/ProjectGoalOverView/13-Code-Quality.md)
- Contributing guide: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- PR template: [`.github/pull_request_template.md`](../.github/pull_request_template.md)
