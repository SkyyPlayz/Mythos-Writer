# Engineering Lessons

## E2E Test Hardening: Defensive Waits Over Speculative Assertions (SKY-766)

**Pattern:** When hardening E2E tests, add defensive visibility waits that can't break the test. Avoid speculative assertions about app behavior you're uncertain about.

**Conservative (Safe):**
```typescript
// Safe: ensures elements exist before accessing by index
const inputs = panel.locator('.input');
await expect(inputs.nth(1)).toBeVisible({ timeout: 4_000 });
const aliasInput = inputs.nth(1);
await aliasInput.fill(value);
```

**Speculative (Risky):**
```typescript
// Risky: assumes the panel closes on save, but maybe the UI doesn't work that way
await saveBtn.click();
await expect(panel).not.toBeVisible({ timeout: 6_000 }); // May not happen!
```

**Why:** Index selectors (`.nth(1)`) race with DOM rendering. Explicit visibility waits prevent flakes from that race without making assumptions about other behaviors. Only add wait logic for things you can verify happen locally.

**Applied to SKY-220:** Added input visibility checks in TC-E-02 and TC-E-04 before `.nth(1)` access. Verified with 3 consecutive headless runs — all green.

---

## Async Event Handlers: Add blur() After fill()

**Pattern:** After filling an input, call `.blur()` to trigger onChange/onBlur handlers that might persist data.

```typescript
const input = page.locator('.entity-alias-input');
await input.fill(ENTITY_ALIAS);
await input.blur(); // Trigger onChange handlers
```

**Why:** Some UIs handle changes on blur rather than on every keystroke. Without blur(), the test might not trigger persistence logic that makes the change durable.

---

## SQLite Archive Indexes: Cover hot paths with composite indexes, not individual column indexes (SKY-1745)

Add `(status, created_at DESC)`, `(scene_id, status, created_at DESC)`, and `(item_id, created_at DESC)` covering indexes on archive tables; SQLite uses the rightmost key for ORDER BY elimination, turning full-scan + filesort into index-range scans and cutting p95 from ~500ms to <50ms at 5000 rows.

---

## React Test Act Warnings: Fail Fast and Settle Mocked Async Work (SKY-2794)

**Pattern:** Add a local `console.error` guard for `not wrapped in act` warnings in async-heavy React test files, then make mocked IPC promises settle inside `act()` or intentionally stay pending when a test only asserts synchronous UI.

```typescript
await act(async () => {
  resolvePendingIpc({ items: [] });
});
```

For component mount effects whose mocked APIs are only setup data, a synchronously-settling test thenable can keep the state update within Testing Library's render/event `act()` boundary. For model-list fetches unrelated to the assertion, prefer a never-resolving promise in that individual test so no unobserved async state update lands after the test ends.

**Why:** Passing tests can still emit React act warnings when mocked IPC promises resolve after the assertion path. A guard turns this into a regression failure instead of noisy stderr, and explicit async settling documents which state transition the test is waiting for.

---
