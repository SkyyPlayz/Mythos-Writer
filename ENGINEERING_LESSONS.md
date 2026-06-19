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

## Routine Execution Doom Loop: Routines Must Guarantee Execution Issues Have Disposition Paths (SKY-2776)

**Pattern:** A routine that fires execution issues to an agent without a clear disposition path creates a doom loop. The routine never stops, issues accumulate faster than the agent can drain them, and quota pressure during backlog can push the agent to error state.

**What happened:** CI-monitor routine `c8fa0c64` was configured to monitor PR #538 merge status but was not archived after the PR merged on 2026-06-17. For ~26 hours, it fired every 15 minutes, creating execution issues assigned to FoundingEngineer. When the agent tried to check CI for a closed PR, it got 404 errors. These execution issues had no valid disposition path (couldn't resolve to `done` or `blocked`), so they accumulated faster than any agent could drain them. At 2026-06-19T09:00:53Z, during this unresolvable backlog, FoundingEngineer hit Hermes 429 quota and was marked error state.

**Prevention:** Before creating a routine that fires execution issues:
1. Ensure the target (PR number, issue, resource) has a lifecycle that eventually ends (merged PR, closed issue, etc.)
2. Guarantee the routine knows when to stop (archive itself when the target is in a terminal state)
3. Ensure execution issues fired by the routine have a clear disposition path (can transition to `done` when success criteria are met, or `blocked` with explicit blockers if the routine can't satisfy them)

**Mitigation:** Stale routines are now archived via scheduled ops tasks (e.g., SKY-2740) to prevent backlog accumulation.

---
