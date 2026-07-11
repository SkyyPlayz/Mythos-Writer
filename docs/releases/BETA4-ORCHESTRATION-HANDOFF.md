# Beta 4 "Refine" — orchestration handoff (2026-07-11)

Owner authorization on record: **build and push all waves (M1–M30) per
`docs/releases/BETA-REFINE.md`, then cut and publish `v0.5.0-beta.1` when the
entire design-handoff is implemented.** The W0.6 packaged-smoke gate PASSED
(Skyy sign-off, recorded in PR #907). This document is the baton pass for the
agent/team continuing that campaign.

## Read these first (canonical, in-repo)

1. `CLAUDE.md` — working rules; the three required checks (`ci`, `build-linux`
   *(note: build-macos is owner-deferred to on-demand — "skipped" on PRs is its
   normal, satisfying state)*; **never merge red**.
2. `docs/releases/BETA-REFINE.md` — THE build plan: every milestone M1–M30 with
   What/Why/Files/Spec-lines/Accept, the dependency table, and the status table
   (update it as you land waves — one docs PR per wave, don't let milestone
   agents touch it; that's how we avoid 4-way table conflicts).
3. `plans/design-handoff/v2/FULL-SPEC.md` + the prototype
   `plans/design-handoff/v2/prototype/Mythos Writer - Liquid Neon.dc.html` —
   **the prototype wins every disagreement.**
4. `plans/ProjectGoalOverView/14-…` (product overview), `15-…` (binding
   carry-overs CF-1..CF-19), `00-decisions-log.md` (B4-1..B4-11 owner rulings).

## State at handoff

### Merged to main (all green)
- Wave 0 complete: #901–#905 (+ #904 boot-race fix, #906 version bump 0.5.0-beta.0, #907 gate record).
- The `v0.5.0-beta.0` smoke build lives in a **draft** release — leave it draft.
- **Wave 1**: M2 #908, M1 #909, M3 #911 all MERGED. Main tip at handoff: `470384f`.
  (#911 was merged by the owner over a red shard-3 — that red was only stale VR
  baselines; evidence main is visually green: M5's branch = main + no visual
  changes ran VR 7/7, 0 failures.)

### In flight — YOUR IMMEDIATE QUEUE
1. **#910 (M4, workspace tabs = documents)** — branch `claude/beta4-m04`,
   head `c3713e4` (the M3↔M4 merge resolution, PUSHED; fresh CI triggered).
   The resolution's key semantic: **rail clicks never create tabs** —
   `handleNavModuleChange` routes crafter→`handleSetView('kanban')`,
   timeline→`handleSetView('timeline')`, graph→`handleNotesSubViewChange('graph')`
   (M4's document-tab model owns the strip). Validated against a private
   packaged harness of the merged tree: shell-relayout 12/12, TC-WA-26 green,
   both unit suites green (3074 + 3782). **Your first action: arm auto-merge
   (squash) on #910** — an API rate limit blocked me at handoff. If shard-3
   fails on VR, follow the baseline loop below.
2. **#912 (M5, MythosVault keystone) — MERGED 2026-07-11 ~03:0x** (owner/team
   merged it right at handoff). Consequences: Wave 2+ milestones gated on M5
   are UNBLOCKED NOW (M6, M15, M16, and especially the M21 timeline chain).
   Check whether #910 went `dirty` against M5-main; if so resolve the same way
   as the M3 pass (details above) — expect at most small overlaps in
   DesktopShell / settings types.
   Post-merge follow-ups the M5 agent flagged: wire `e2e/mythos-migration.spec.ts`
   into a CI shard (one line in `.github/workflows/ci.yml`), and keep default
   onboarding on v0.4 format until M29 flips it.
3. **VR baselines on main** — I dispatched `vr-baselines.yml` on `main`
   (~01:54); if its bot commit hasn't landed, check the run; re-dispatch if it
   failed. Not urgent while VR passes, but fresh baselines reduce noise for
   every subsequent visual PR.

### Wave 1 status-table docs PR
After #910 merges, open one docs PR updating `BETA-REFINE.md`'s table:
M1 ✅ #909 · M2 ✅ #908 · M3 ✅ #911 · M4 ✅ #910 · M5 ✅ #912 (when merged),
and mark the next wave's rows 🔨 with branch names.

## The proven per-milestone loop (copy it)

1. Launch one agent per milestone on branch `claude/beta4-mNN` from latest
   `origin/main`, in an isolated worktree, with node_modules symlinked from the
   main clone (root + `frontend/` + `electron-main/`). Give it: the milestone
   block from BETA-REFINE.md, the FULL-SPEC §, the prototype line ranges, the
   binding CF-x carry-overs, and the validation commands. Explicitly forbid it
   from touching `BETA-REFINE.md` and `e2e/visual-baselines/`, and require a
   "Why CI passes" + "VR impact" section in the PR body.
2. Agent validates locally (`lint -w frontend`, `typecheck`, `test`,
   `build:electron`, targeted e2e under xvfb), pushes, opens a ready PR with
   the required commit trailers.
3. Orchestrator arms **auto-merge (squash)**.
4. If shard-3 fails with a `visual-regression-diffs` artifact → it's baselines:
   dispatch `vr-baselines.yml` with `ref: <branch>` (update the branch from
   main FIRST so the capture includes merged siblings), wait for the bot
   commit, then push an **empty commit** to the branch (the bot's GITHUB_TOKEN
   push does NOT trigger CI).
5. If a functional e2e fails: fix it on the branch (the failure is usually a
   spec still driving UI an earlier milestone changed — e.g. TC-WA-26 clicked
   the deleted Story module tab).
6. One visual PR lands at a time; after each merge, `update_pull_request_branch`
   on the next one (never `rerun_failed_jobs` on a stale run — reruns replay the
   OLD merge snapshot and can cancel-race the current head's run in the
   `ci-pr-N` concurrency group).

## Remaining waves (dependencies from BETA-REFINE.md's table)

- **Now unblocked once #912 merges**: M6 (Auto Note Linker — deterministic
  kdnk port, badge `BUILT-IN · NO AI`), M15 (agent hub + sessions),
  M16 (notes explorer), **M21 (timeline model + calendars — START THIS
  IMMEDIATELY: M21→M22→M23→M24/25/26 is the longest sequential chain in the
  release)**.
- M7 (editor chrome & page) needs M1 ✅ — can launch in parallel with the above.
- Then per table: M8..M14 behind M7/M12/M15; M17 (M6+M16); M18 (M15+M16);
  M19 (M5+M12); M20 (M5+M15); M22..M26 behind M21 chain; M27 (graph), M28
  (settings remainder + OAuth connect-later per B4-10), M29 (demo seed +
  welcome wizard — LAST build milestone; flips default onboarding to
  MythosVault v2), M30 (release prep).
- Batch 3–5 concurrent agents max; more than that trips GitHub's hourly API
  rate limit for the whole account (it bit us twice today — git push still
  works when REST is limited).

## M30 + release procedure (the finish line)

1. All M1–M29 merged, main green, BETA-REFINE status table complete.
2. Version bump PR → `0.5.0-beta.1`; changelog; VR baseline refresh on main.
3. Run FULL-SPEC §14 checklist 1–10 **on a packaged build** with evidence in
   the PR; re-measure PERFORMANCE.md targets (profiling harness from the July
   audit is in the session scratchpad; freeze-experiment.mjs pattern).
4. Dispatch `release.yml` (`workflow_dispatch`, tag `v0.5.0-beta.1`,
   `is-beta: true`, ref `main`) → draft pre-release with Windows NSIS + Linux
   AppImage.
5. Owner authorized publishing this beta ("make the next beta when you are
   done with the entire handoff") — publish the pre-release (it feeds the beta
   auto-update channel), and post the summary + download link in chat.

## Gotchas that cost us time (don't relearn these)

- **Auto-merge quirks**: enabling on an already-green PR errors — just merge
  it (verify `ci` + `build-linux` pass and `build-macos` skipped first).
  A branch update or bot commit disarms/blocks pending auto-merge until the
  new head's checks pass.
- **`ci-pr-N` cancel-race**: a rerun of an old run and a fresh push race in the
  same concurrency group; the survivor may be testing a stale head. Always
  prefer a fresh run on the current head; treat "7× cancelled" aggregate
  failures as this race, not real failures.
- **`report` / `close-ping` checks** are non-required Paperclip-server pings —
  red is harmless when that server is down.
- **Local e2e harness — PROVEN TRAP**: the main clone's
  `node_modules/electron/dist/electron` is a symlink to
  `scratchpad/squashfs-root/mythos-writer`, a PACKAGED binary that ignores the
  spec's `main.js` arg and always runs its own baked `resources/app` — e2e
  through it silently tests a stale app (it produced 2 phantom failures AND
  earlier phantom passes today). Protocol for trustworthy local e2e: copy a
  packaged harness privately, overlay your fresh `out/` into
  `<harness>/resources/app/out/`, keep every `app.asar*` renamed away, add an
  `electron` symlink next to the `mythos-writer` binary, and run with
  `ELECTRON_OVERRIDE_DIST_PATH=<harness-dir>` (plus
  `ELECTRON_DISABLE_SANDBOX=1 xvfb-run --auto-servernum`). CI is unaffected
  (real electron via `npm ci`).
- **Commit identity**: `git config user.email noreply@anthropic.com`,
  `user.name Claude`, and both commit trailers on every commit; never put the
  runtime model identifier in any pushed artifact.
- Timeline perf gate (`e2e/timeline.spec.ts`) uses `FRAME_BUDGET_MS = CI ? 100 : 60`
  — don't "fix" CI slowness by loosening product code.

Good luck. The plan is the spec; the prototype is the truth; green is the bar.
