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

## Nav-rail selector migration: scan ALL CI-path E2E files when replacing a nav component (SKY-3380)

**2026-06-21** — When a global nav component is replaced (e.g. DockedTabBar → AppNavRail), the commit that wires it into DesktopShell must update *every* E2E spec that is in a CI shard, not just the ones explicitly listed in the diff. The SKY-3097/3098 wiring commit updated `notes-tab.spec.ts`, `cross-tab-links.spec.ts`, etc. but missed 5 CI-path specs across all 4 shards (`brainstorm`, `writing-modes`, `writing-assistant-tips`, `vault-graph-v0`, `entries`), reddening every shard. Fix: before merging a nav-component swap, run `grep -r "app-tab-notes\|app-tab-story\|app-tab-bar" e2e/` and update every hit that appears in a CI shard. (CTO)

---

## Design-ahead spec PRs must land before or with their milestone's build PR (SKY-7590/SKY-6983/SKY-7255/PR #983)

**2026-07-18** — A design-ahead spec (docs-only PR merging `SPEC.md` to `main`) is not "done" for build purposes until it is actually merged. SKY-7255's welcome-wizard spec was feasibility-reviewed and approved (SKY-7395), but PR #983 — the PR that would have merged `plans/design-handoff/v2/m29-welcome-wizard/SPEC.md` to `main` — was left open. The M29 build (PR #1001, `claude/beta4-m29`) never saw the finalized spec text and silently fell back to SKY-6983's own inline AC2 entry-card set, which had been drafted ~28 minutes *before* SKY-7255 was even created and cited an older prototype-line reference directly. The build wasn't wrong to read SKY-6983 — it was the only AC actually on `main` at build time. The gap surfaced only via a later design-QA pass (SKY-7590/SKY-7569) and needed a CTO ruling to resolve, costing a full extra revision cycle (SKY-7593) to bring the build back in line with the canonical spec.

**Fix:** when a milestone has a design-ahead spec issue, treat "spec approved" and "spec merged to `main`" as different states — only the latter is safe to build against. Before starting a build PR for a spec'd milestone, confirm the spec doc's PR is merged (`gh pr view <spec-pr> --json state`), not just approved/feasibility-reviewed. If the spec PR is still open, land it first or in the same PR as the build — never let the build's AC silently fall back to an older, in-issue AC written before the spec existed.

---

## Same fix-forward issue, two agents in parallel: check `git fetch` before pushing, not just before starting (SKY-7593)

**2026-07-18** — Two independent agent sessions were both dispatched against SKY-7593 (revise PR #1001's M29 wizard to match the SKY-7255 spec) and worked the *entire* task — same file, same spec, ~40 minutes apart — before either pushed. Both independently reached nearly identical conclusions (same card swap, same two-vault promise, same 4-of-5 dyslexia fixes, same reasoning for deferring the AI-provider step), which confirms the spec was unambiguous, but it still meant a full rebase/reconciliation instead of a clean push, plus a discarded near-duplicate branch (`backup-sky7593-full-attempt`). The two implementations diverged only in incidental choices (testid names: `card-open-sample` vs `card-sample`; whether "Start blank" skips the template screen by default vs keeps the full 4-screen chain with relabeled dots) — exactly the kind of arbitrary decision that makes a second independent pass pure waste once the first is in.

**Fix:** `git fetch && git log origin/<branch> -5` right before `git push`, not just at task start — a long single-session task can be overtaken mid-flight. If the remote has moved, diff the incoming commit's message/scope against your own *before* rebasing: if it's the same issue with materially the same scope, prefer the already-pushed version as the base and layer only your genuinely-uncovered delta on top, rather than reconciling a full line-by-line conflict across every touched file.

---

## Siloed agent lineages building the same milestone from the same spec, with no cross-reference, land as duplicate conflicting PRs (SKY-7484/SKY-7593, PR #998/PR #1001, SKY-7700)

**2026-07-19** — Unlike the SKY-7593 case above (two *sessions* of the same ticket, same lineage), this was two entirely separate *issue lineages* building the identical M29 Welcome Wizard milestone off the same SKY-7255 design-handoff spec, each unaware the other existed: SKY-7484 (re-homed FableEngineer → ProductEngineer after SKY-6925 ERROR) produced PR #998; SKY-6983 → SKY-7590 (CTO ruling) → SKY-7593 (FoundingEngineer) produced PR #1001. Neither issue thread linked or mentioned the other. PR #998 merged first, flipping the still-open PR #1001 to `CONFLICTING` across every file both touched (`ipc.ts`, `main.ts`, `preload.ts`, `OnboardingWizard.css`, `OnboardingWizard.tsx`, `OnboardingWizardV2.test.tsx`, `global.d.ts`). Reconciliation required feature-level triage, not a naive ours/theirs merge: PR #1001 had the full canonical spec UI (entry cards §1.1, two-vault promise §2.1, 10-preset theme grid §3, progress-dot labels §6, dyslexia copy §7); PR #998 had real shipped functionality #1001 lacked (starter-notes seeding on completion, an `onboarding:reset` soft/hard split with its own IPC/preload surface, a SettingsPanel dev-reset button). Losing either side outright would have been a regression.

**Fix:** when a milestone has a design-ahead spec (SKY-7255-style), the spec issue should carry a visible "build in progress: <issue-id>" marker the moment any lineage starts implementing against it, and a re-homed/handed-off issue (FableEngineer → ProductEngineer, or a CTO ruling like SKY-7590) must check the spec issue's own comment thread for *other* build attempts before dispatching a fresh one — not just check its own issue's ancestry. When reconciling a resulting conflict, diff both PRs' descriptions for feature claims before touching a single file, keep the more spec-complete side as the merge base, and layer the other side's uniquely-shipped functionality on top file-by-file rather than picking a branch wholesale.

---

## `git merge` (not `git rebase`) can silently duplicate two branches' non-overlapping insertions at the same anchor point — no conflict marker raised (SKY-7700)

**2026-07-21** — While reconciling PR #1001 with post-merge `main` for SKY-7700, a 3-way `git merge origin/main` produced a real bug `git rebase` would not have: both branches had independently added a `<p className="wiz-theme-legend">…</p>` block for the M29 theme-grid legend, in the same location but with different content and no shared history for that line range. Git's merge algorithm treated this as two non-conflicting insertions and kept *both*, rendering the 6-slot legend twice in the DOM — no `<<<<<<<` marker anywhere, so a conflict-marker sweep alone would not have caught it. Discovered only because the full frontend unit suite was rerun post-merge (`getByText` failed with "Found multiple elements") — a partial sweep (typecheck + the specific 3 required e2e shards) would have missed it, since none of those exercised `getByText` on the legend text with strict single-match semantics. Separately, mid-reconciliation, another agent had already rebased the same branch onto `main` (linear `git rebase`, no merge commit) and pushed it — `git rebase` doesn't have this failure mode at all, since each commit's patch is replayed literally rather than 3-way-merged, so the already-pushed rebase did not have the duplicate-legend bug the from-scratch merge attempt did.

**Fix:** prefer `git rebase <target> ` over `git merge <target>` when reconciling a feature branch with a moved base, specifically because rebase replays each commit's own diff (no silent-duplicate-insertion failure mode) where merge 3-way-combines full trees (can duplicate). If a merge is unavoidable (e.g., the branch is public/shared and a force-push is off the table), always rerun the *full* test suite afterward, not just the tests the issue names — a targeted rerun of only the "required" tests will not surface a duplicate-insertion bug unless one of those specific tests happens to assert single-match semantics on the duplicated content. Also: before pushing a from-scratch reconciliation, `git fetch` the target branch one more time — another agent may have already completed and pushed the same reconciliation while you were mid-work (this happened here, on the very issue about duplicate parallel work); prefer their already-pushed result over overwriting it if it's equivalent or better.

---
