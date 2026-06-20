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

## Paperclip Routine Postmortems: Verify the execution issue before blaming the routine (SKY-2742)

When a stale CI-monitor routine is suspected, first compare the routine `status`/`lastTriggeredAt` with the latest execution issue and agent run logs: `c8fa0c64` had been archived after producing done issue `SKY-2190`, while FoundingEngineer `error` came from Claude Sonnet 429s (`claude_transient_upstream`), not missing CI disposition.

---
