# Mythos-Writer repository audit

**Audited:** 2026-09-16  
**Base:** `origin/main` @ `71c5fad7` (`docs: add HANDOFF.md for the WSL -> grokbot migration (#1585)`)  
**Scope:** read-only inventory for a future cleanup plan. **This document proposes; it does not delete.**  
**Method:** `git ls-remote`, `git ls-tree -r -l`, `git count-objects`, `gh pr list`, `gh release view`. Numbers below are measured, not estimated.

---

## Verified inventory (corrects prior hunches)

| Metric | Measured | Prior hunch | Notes |
|--------|----------|-------------|-------|
| Remote heads | **283** (incl. `main`) | ~283 | Matches |
| Current tree files on `main` | **2588** | “~2588 blobs” | Hunch meant **files**, not blobs |
| Unique blobs in current tree | **2559** | — | |
| Historical blobs reachable from `main` | **9041** | — | History + prior paths |
| Current tree bytes (`git ls-tree -l`) | **~242 MiB** (254,012,320 B) | — | Checked-out content |
| Media (png/jpg/webp/gif/mp4/webm/ico) on `main` | **588 files / ~220 MiB** | — | Dominates tree size |
| Local `.git` after full remote fetch | **~498 MiB** | ~497 MB | Pack ≈ 495 MiB |
| Open PRs | **0** | — | Confirmed via `gh pr list` |
| Draft release `wsl-handoff-2026-09-15` | **draft**, 12 assets, **~572 MiB** | — | **Do not delete** |

**Branch prefixes (remote heads, verified):**

| Prefix | Count | Notes vs prior hunch |
|--------|------:|----------------------|
| `fix/` | 72 | Matches |
| `screenshots/` | 36 | Not in prior list — large artifact |
| `sky-` / `SKY-` (no slash) | 35 | Prior “sky-/30” undercounted |
| `claude/` | 21 | Matches |
| `feat/` | 19 | Matches |
| `wsl-handoff/` | 14 | Matches — **archive candidates, do not delete yet** |
| `chore/` | 6 | Matches |
| `qa/` | 6 | |
| `test/` | 5 | |
| `ci/` | 3 | Matches |
| `docs/` | 2 | Matches |
| `cursor/` | 1 | Matches |
| `design/` | 1 | Matches |
| Misc (`pr*`, `v9*`, worktree, etc.) | ~51 | Agent scratch / rebase refs |

**PR association (all 282 non-`main` heads):** `merged_pr=116`, `closed_unmerged=28`, `open=0`, `no_pr=138`. Squash-merge means tip SHAs are almost never ancestors of `main`; use PR state, not `git branch --merged`.

**Discarded hunch:** `design-assets/wallpapers/originals/*` (~2 MiB PNGs) appear in `--all` object walks but **are not on `main`**. They live on closed wallpaper-pipeline branches (`feat/sky-11590-wallpaper-pipeline`, `feat/sky-11591-wallpaper-asset-pipeline`). Ship path on `main` is `frontend/src/assets/wallpapers/pack/*.webp` (~2.1 MiB).

---

## 1) What the app actually needs to build/ship (KEEP)

These paths are on the production / CI critical path.

### Runtime / package

| Path | Why keep |
|------|----------|
| `frontend/` | Renderer UI (workspace) |
| `electron-main/` | Main process, IPC, vault I/O |
| `shared/` | Cross-workspace types/helpers |
| `package.json`, `package-lock.json`, workspaces | Install + scripts |
| `electron.vite.config.ts`, `electron-builder.json` | Dev/build/packaging |
| `build/icon.png`, `build/icon.ico`, `build/entitlements.mac.plist`, `build/notarize.js`, `build/uninstall-vaults.nsh` | Installer icons + mac/Windows packaging |
| `sample-project/` | `electron-builder` `extraResources` |
| `frontend/src/assets/wallpapers/` | Shipped Liquid Neon wallpaper pack (webp + manifest + LICENSE) |
| `.env.example`, `.gitignore`, `.gitattributes`, `.npm*`, prettier config | Tooling |

### Tests / quality gates

| Path | Why keep |
|------|----------|
| `e2e/`, `playwright.config.ts` | Playwright suites wired into `ci.yml` shards |
| `tests/` | Shared/test helpers still referenced |
| `scripts/ci-retry.sh`, `scripts/ci-power-keepalive.ps1` | Used heavily by `ci.yml` (WSL keepalive + npm retry) |
| `scripts/fetch-kokoro-assets.mjs` | `kokoro:fetch` before dist |
| `scripts/check-prototype-freshness.sh` | Fidelity gate (`npm run check:prototype-freshness`) |
| `scripts/check-dead-wiring.mjs` (+ baseline JSON) | Frontend lint |
| `scripts/preflight.sh` | Local CI preflight (`CI-PREFLIGHT.md`) |
| `.github/workflows/ci.yml` | Primary gate |
| `.github/workflows/release.yml` | Tagged releases (includes macOS) |
| `.github/scripts/*` | Workflow helpers + issue-finder |

### Specs the build still points at

| Path | Why keep |
|------|----------|
| `plans/design-handoff/v2/FULL-SPEC.md` | Build-spec source of truth |
| `plans/design-handoff/v2/prototype/Mythos Writer - Liquid Neon.dc.html` | Prototype wins disagreements |
| `plans/design-handoff/v2/PERFORMANCE.md` | Perf fix-order companion |
| `plans/ProjectGoalOverView/14-beta4-refine-overview.md` | Current product overview |
| `plans/ProjectGoalOverView/15-beta4-comparison-and-carryovers.md` | Binding carry-overs |
| `plans/ProjectGoalOverView/00-decisions-log.md` | Decisions log |
| `plans/ProjectGoalOverView/13-team-goals.md`, `13-Code-Quality.md` | Still in force |
| `docs/releases/BETA-REFINE.md` | Active release build plan |
| `PERFORMANCE.md` (repo root) | Measured baselines / DoD targets cited by BETA-REFINE |
| `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md` | Agent + contributor contracts |
| `HANDOFF.md` | Fresh WSL→grokbot handoff (2026-09-15) |

### Optional but still product-adjacent

| Path | Disposition |
|------|-------------|
| `plugin/Liquid-Neon-Companion/` | Obsidian companion; not in npm workspaces / electron-builder `files`. Keep until owner decides companion is out of repo. |
| `docs/user-guide*.md`, `docs/security/*`, `docs/testing-strategy.md`, `docs/RELEASE_RUNBOOK.md`, `docs/OFFLINE_VOICE_SETUP.md` | Operator/user docs — keep |
| `docs/screenshots/*.png` used by `README.md` | **Keep** the small product shots (~50–90 KiB each); see §3 for the rest |

---

## 2) Docs/specs — useful vs obsolete/superseded

### Canonical (keep; prefer linking here)

- `plans/design-handoff/v2/*` (FULL-SPEC, prototype, PROCESS, PERFORMANCE, GAP-REPORT)
- `plans/ProjectGoalOverView/14-*`, `15-*`, `00-*`, `13-*`
- `docs/releases/BETA-REFINE.md`, `RELEASING.md`
- `HANDOFF.md`, `PERFORMANCE.md`, `CI-PREFLIGHT.md`, `CHANGELOG.md`
- `docs/security/*` (baseline, IPC, fuzz, telemetry, npm-audit)
- ADR-style `docs/decisions/*`
- Living engineering notes: `ENGINEERING_LESSONS.md` (short; keep or fold into `docs/` later)

### Superseded but historically useful (archive candidate — do not silent-delete)

Per `15-beta4-comparison-and-carryovers.md`:

| Path | Status |
|------|--------|
| `plans/ProjectGoalOverView/01`–`12` | Outdated overview modules |
| `plans/ProjectGoalOverView/Mythos writer.md` | Original design bible — superseded |
| `plans/ProjectGoalOverView/questions.md` | Outdated (resolved history) |
| `design-handoff/` (repo root) | Stale twin of `plans/design-handoff/`; prototype folder only has `MOVED.md` |
| `docs/releases/BETA-LIQUID-NEON.md` | Prior beta plan |
| `docs/releases/BETA4-PICKUP-2026-07-15.md`, `FABLE-PICKUP.md` | Agent pickup handoffs — superseded by `HANDOFF.md` |
| `docs/ci-gate-audit-2026-06.md` | **Stale:** still describes `build-macos` + “branch protection not configured”; current `ci.yml` has no `build-macos` job |

### Root one-off specs (move under `docs/specs/` or `plans/` when cleaning)

| File | Assessment |
|------|------------|
| `SKY-456-SPEC.md` | Pre-Beta-4 UX spec — likely superseded by FULL-SPEC; confirm before delete |
| `SKY-2968-component-spec.md` | Liquid Neon component tokens — partially superseded by v2 design-handoff; keep until token work cites FULL-SPEC only |
| `SKY-2970-onboarding-v0-3-ux-spec.md` | v0.3 onboarding — superseded by M29 / wizard work; archive |
| `FABLE-PICKUP.md` | July handoff — obsolete vs `HANDOFF.md` |

### Issue-scoped docs still useful as evidence (keep until ticket closed, then archive)

- `docs/specs/SKY-11006-archive-continuity-panel-spec.md`
- `docs/fidelity/SKY-*-gap-list.md`
- `docs/AGENT-HUB-SUGGESTION-INBOX-GAP-SPEC.md`, timeline/manuscript design specs under `docs/`
- `docs/qa/**`, `docs/evidence/**`, `docs/perf/**`

### Duplicate / typo dirs under plans

- `plans/ProjectGoalOverView/Liquid-Neon-theme-examples/` — **~17.4 MiB** moodboard PNGs (see §3)
- `plans/ProjectGoalOverView/Liduid-Glass-Dark-Neon- theme- exampels/` — typo name, near-empty pointer (~3 KiB)
- `plans/ProjectGoalOverView/Ui-Disign-Goal` — typo; confirm content before move

---

## 3) Binary / media debt

### Size leaders on `main` (current tree)

| Path | Files | Bytes | Recommendation |
|------|------:|------:|----------------|
| `pr-screenshots/` | 288 | **~113 MiB** | **Move out of `main`.** PR evidence belongs in PR comments, Actions artifacts, or a draft/archive release — not the default clone. `screenshot-check.yml` only requires an image in the PR body/comments, not this directory. |
| `docs/screenshots/` (mostly per-issue folders) | 194 | **~71 MiB** | Split: keep README product shots (~0.4 MiB); archive ticket folders to release/Git LFS/external after tickets close. |
| `plans/ProjectGoalOverView/Liquid-Neon-theme-examples/` | 12 | **~17 MiB** | Moodboard — move to draft release or design archive; design-of-record is the v2 prototype HTML. |
| `plans/fidelity-rebuild/` | 12 | **~6 MiB** | Keep plan markdown; screenshot subfolder → archive. |
| `plans/design-handoff/v2/prototype/babel.min.js` | 1 | **~3.0 MiB** | Vendored into interactive prototype. Prefer CDN/`skypack` note or compress; deleting without testing breaks local prototype open. |
| `docs/brand/company-logo-temp.png` | 1 | **~2.0 MiB** | Temp asset — replace with compressed brand asset or move off `main`. |
| `build/icon.png` | 1 | **~1.3 MiB** | **Keep** (packaging). |
| `frontend/src/assets/wallpapers/pack/` | 42 webp | **~2.1 MiB** | **Keep** (shipped). |
| `e2e-visual-artifacts/` | 18 | **~0.4 MiB** | Listed in `.gitignore` but **still tracked**. Untrack (stop tracking) after copying baselines elsewhere if still needed. |
| `plugin/.../screenshots` | 5 | small | Optional with plugin. |
| `plans/Bug reports/bug refrence photos/` | 6 | **~0.5 MiB** | Archive with closed bugs. |

**Media total on `main`:** ~220 MiB of ~242 MiB tree — cleanup ROI is almost entirely screenshots + theme examples.

### Not on `main` (branch / release debt)

| Item | Where | Action |
|------|-------|--------|
| `design-assets/wallpapers/originals/` (~70+ MiB on wallpaper feat branches) | `feat/sky-11590-*` / `11591-*` (PRs #1501/#1502 closed unmerged) | If originals are still needed for SKY-11756/11757, attach to **draft release** or private asset store — do not re-merge onto `main` without compression pipeline. |
| Agent-clone history | Draft release `wsl-handoff-2026-09-15` (~572 MiB bundles) | **Keep draft.** Flag only; owner decides retention. |
| `screenshots/*` remote branches (36) | Remote heads only | Safe archive/delete candidates after confirming blobs exist in PR artifacts or `pr-screenshots/` history. |

### Keep in-repo vs move

| Keep in-repo | Move to draft release / external archive |
|--------------|------------------------------------------|
| Shipped wallpapers (webp pack) | `pr-screenshots/**` |
| `build/icon.*` | Per-ticket `docs/screenshots/sky*` folders older than N milestones |
| README hero screenshots | Liquid Neon moodboard PNGs under `plans/.../theme-examples` |
| Prototype `.dc.html` (authoritative) | Wallpaper **originals** PNG pipeline |
| | `e2e-visual-artifacts` once untracked |

---

## 4) Scripts / CI / workflows — live vs dead

### Workflows (`.github/workflows/`)

| Workflow | Trigger | Live? | Notes |
|----------|---------|-------|-------|
| `ci.yml` | push + PR | **Live** | Jobs: setup, paths-filter, lint, typecheck, unit, build-electron, e2e-shard-1..4, aggregator `ci`, plus `build-linux` / `build-windows` / `notes-windows` (`if: != pull_request` on packaging jobs). **No `build-macos` job** despite older docs/`CLAUDE.md`. |
| `release.yml` | tags + dispatch | **Live** | Windows/mac/linux release builds |
| `screenshot-check.yml` | PR | **Live** | Body/comment image heuristic |
| `carve-out-check.yml` | PR | **Live** | Labels carve-out paths |
| `zero-diff-check.yml` | PR | **Live** | |
| `close-ping.yml` | PR closed | **Live** | Calls `scripts/notify-board.sh` (Paperclip-era; may no-op post-handoff) |
| `dep-audit.yml` | schedule + PR | **Live** | |
| `dependabot-auto-merge.yml` | `pull_request_target` | **Live** — review trust boundary |
| `fuzz.yml` | schedule + PR | **Live** | |
| `issue-finder.yml` | schedule | **Live** | `.github/scripts/issue-finder.js` |
| `runner-watchdog.yml` | schedule | **Live?** | `scripts/paperclip/runner_watchdog.py` — likely Paperclip-host specific; confirm before delete |
| `vr-baselines.yml` | dispatch + push | **Live** | Visual regression baselines |

### `scripts/` liveness

| Script | Status |
|--------|--------|
| `ci-retry.sh`, `ci-power-keepalive.ps1` | **Live** (ci.yml) |
| `fetch-kokoro-assets.mjs`, `preflight.sh`, `check-prototype-freshness.sh` | **Live** (package.json) |
| `check-dead-wiring.mjs`, `dead-wiring-baseline.json` | **Live** (frontend lint) |
| `notify-board.sh` | **Live** via close-ping; may be obsolete post-Paperclip |
| `notify-board-test.sh` | Test harness for notify-board |
| `paperclip/runner_watchdog.py` | Host automation — revisit |
| `wallpapers/*` | Pipeline helpers for wallpaper pack — keep if regenerating assets (SKY-11757) |
| `test-bughunt-fisher-smoke.sh` | Tied to root `BugHunt-Fisher.sh` |
| `capture-sky10575.mjs`, `sky-94-capture.js`, `sky-94-debug.js` | **One-off** capture scripts — archive candidates |
| `rebuild-native.js` | **No references** in package.json / workflows — dead candidate |

### Doc debt about CI

`CLAUDE.md` / `AGENTS.md` / `docs/ci-gate-audit-2026-06.md` still say required checks are `ci` + `build-linux` + `build-macos`.  
**Observed on merged PR #1585 status rollup:** `ci`, `lint`, `typecheck`, `unit`, `build-electron`, `e2e-shard-*`, `carve-out-check`, `screenshot-check`, `zero-diff-check`, and packaging job names `build-linux` / `build-windows` / `notes-windows`. Owner should refresh the agent contract in a follow-up (out of scope for this audit-only PR).

---

## 5) Branch hygiene

**Policy reminder:** do **not** delete `wsl-handoff/*` or the draft release `wsl-handoff-2026-09-15` without an explicit owner flag. Treat them as **archive candidates**.

### Safe to delete (P0) — after double-check tip has a merged PR *or* is pure screenshot/ref junk

High confidence once listed in a deletion PR description for owner skim:

| Category | Count signal | Rationale |
|----------|-------------|-----------|
| `fix/*` with **merged** PR | 46 / 72 | Squash-merged; tip only retained for nostalgia |
| `claude/*` with **merged** PR | 15 / 21 | Same |
| `feat/*` with **merged** PR | 12 / 19 | Same |
| `chore/*` merged | 5 / 6 | Same |
| `sky-`/`SKY-*` merged | 22 / 35 | Same |
| `screenshots/*` | **36 / 36** no PR | Ephemeral screenshot upload branches |
| `pr914`, `pr917`, `pr9xx`, `v914*`, `v917`, `pr-*-check`, `pr*-ref` | ~30+ | Ancient rebase scratch (Jul 2026) |

### Archive — do not delete yet (P1 / owner)

| Category | Count | Why |
|----------|------:|-----|
| **`wsl-handoff/*`** | 14 | Handoff quarry: stashes 0–9, `main-worktree-snapshot`, local diverged copies. Mine cherry-picks first; then prefer git bundle / draft release over branch delete. |
| Draft release **`wsl-handoff-2026-09-15`** | 1 | 12 bundles / ~572 MiB — only copy of ~1,550 agent-clone branches |
| `feat/sky-11590-wallpaper-pipeline`, `feat/sky-11591-wallpaper-asset-pipeline` | 2 | Closed PRs #1501/#1502; hold **originals** not on `main` |
| `wsl-handoff/main-worktree-snapshot` | 1 | 641-file unreviewed stash of screenshots/docs — quarry |

### Keep / review carefully (P2)

| Category | Signal | Action |
|----------|--------|--------|
| `fix/*` **closed unmerged** | 13 | Diff vs `main` before delete — may hold abandoned fixes |
| `fix/*` **no PR** | 13 | Local/handoff work; inspect commits |
| `claude/*` no PR / closed | 6 | Includes `beta4-handoff`, rebase nets |
| `feat/*` closed / no PR | 7 | Includes wallpaper pipelines + local board work |
| `qa/*`, `test/*` no PR | 8 | May be unfinished acceptance branches |
| `docs/sky-11031-fact-ledger-extend-amendment` | 1 | No PR — content check |
| Open work cited in `HANDOFF.md` | — | Prefer tickets (SKY-11899, SKY-11890, …) over hunting branches |

### Approximate “delete when ready” math

If owner approves deleting **merged-PR branches + screenshots/* + obvious prN scratch** only: roughly **~150–180** of 282 non-main heads. Remaining ~100 need triage (wsl-handoff, closed-unmerged, no-PR).

---

## 6) Proposed cleanup phases

### P0 — Safe (docs/process only, or deletes with near-zero product risk)

1. **Land this audit** (`docs/REPO_AUDIT.md`) — no deletions.
2. **Refresh stale CI docs** (`CLAUDE.md` required-check names, `docs/ci-gate-audit-2026-06.md`) in a tiny follow-up.
3. **Delete remote branches with merged PRs** in batches (start with `screenshots/*` + `fix/*` merged). Use `gh pr view` / this report’s counts; never `--force` on `main`.
4. **Stop tracking** `e2e-visual-artifacts/` (already gitignored).
5. **Root markdown tidy (move, don’t delete):** `FABLE-PICKUP.md` → `docs/archive/`; SKY-* root specs → `docs/specs/` with “superseded” banners.

### P1 — Careful (shrink clone; verify links)

1. **`pr-screenshots/` (~113 MiB):**  
   - Export tree to a new draft release asset or `git subtree split` + orphan branch tagged `archive/pr-screenshots-YYYY-MM-DD`.  
   - Remove from `main` in a dedicated PR; grep for path references first.  
   - Update agent habit: attach images to PR body (already what `screenshot-check` enforces).
2. **Ticket `docs/screenshots/sky*` folders (~71 MiB):** keep README-linked files; archive the rest the same way.
3. **`Liquid-Neon-theme-examples/` (~17 MiB):** move to design archive release; leave a short markdown pointer in `plans/ProjectGoalOverView/`.
4. **Deduplicate `design-handoff/` root** → ensure only pointer/MOVED remains; single source `plans/design-handoff/v2/`.
5. **Retire Paperclip-only automation** after confirming grokbot replacement: `close-ping`/`notify-board`, `runner-watchdog`, issue-finder schedule — disable workflow first, delete later.
6. **One-off scripts:** `capture-sky10575.mjs`, `sky-94-*.js`, `rebuild-native.js` → `scripts/archive/` or delete if git history suffices.

### P2 — Owner decisions required

1. **`wsl-handoff/*` branches + draft release retention** — keep ≥90 days? forever? convert branches → additional bundles then delete heads?
2. **Wallpaper originals** on closed feat branches / SKY-11756–11757 — where should masters live?
3. **`plugin/Liquid-Neon-Companion`** — stay in this monorepo or split?
4. **Whether `babel.min.js` must remain vendored** for offline prototype.
5. **Whether to adopt Git LFS** for any future screenshot policy (probably no — prefer out-of-repo).
6. **Branch protection / required checks** — re-audit with admin token; align docs to real gates (`ci` aggregator vs packaging jobs).

### Concrete first deletion batch (suggestion only)

```text
# P0a — screenshot branches (36) — no PRs
screenshots/*

# P0b — merged fix/ tips (sample; expand from gh)
# only after: gh pr list --head <branch> --state merged

# NEVER in P0
wsl-handoff/*
# NEVER delete release tag/assets
wsl-handoff-2026-09-15
```

### Concrete path batch for size win (P1 PR, after archive upload)

```text
pr-screenshots/                          # ~113 MiB
docs/screenshots/sky*/                   # keep README-linked exceptions
docs/screenshots/pr1191/ etc.            # ticket evidence
plans/ProjectGoalOverView/Liquid-Neon-theme-examples/
plans/fidelity-rebuild/screenshots/
```

---

## 7) Risks of deleting each category

| Category | Risk if deleted carelessly | Mitigation |
|----------|----------------------------|------------|
| `pr-screenshots/` | Lose visual evidence for past UI PRs; hard to re-litigate fidelity disputes | Archive release / tag **before** deleting from `main`; link URL in PR |
| `docs/screenshots/` ticket folders | Same; plus broken relative links in closed issue comments / docs | Grep `docs/screenshots` + README; keep marketing shots |
| Theme-example PNGs | Lose early design moodboard | Low product risk; archive |
| Prototype / `babel.min.js` | Breaks offline FULL-SPEC fidelity workflow | Test `npm run fidelity:proto` / open HTML before/after |
| Shipped wallpapers / icons | **Broken app / installers** | Never delete without replacement |
| `plans/design-handoff/v2` | Agents build wrong product | Never delete; only refresh |
| Superseded overview docs 01–12 | Lose carry-over nuance already extracted in doc 15 | Keep until doc 15 validated; then archive zip |
| Merged topic branches | Almost none (squash history on `main`) | Confirm `mergedAt` via `gh` |
| Closed-unmerged branches | Lose abandoned-but-valuable patches | `git log main..<branch> --oneline` + diffstat first |
| `wsl-handoff/*` | Lose only copy of stashes / 641-file snapshot not in draft bundles the same way | **Owner flag**; prefer bundle then delete |
| Draft release bundles | **Catastrophic** loss of ~1,550 agent-clone branches | Do not delete; optionally mark latest & keep forever |
| Paperclip workflows | Broken close notifications / watchdog noise or silent loss of alerts | Disable with comment; observe a week |
| `e2e-visual-artifacts` untrack | Local VR diffs change; CI may regenerate | Confirm `vr-baselines.yml` ownership of baselines |
| Root SKY-*-SPEC moves | Broken links from old tickets | Add stub redirect markdown at old path if needed |

---

## Appendix A — Top-level of `main`

```
.github  build  design-handoff  docs  e2e  e2e-visual-artifacts
electron-main  frontend  plans  plugin  pr-screenshots  sample-project
scripts  shared  tests
+ root markdown (AGENTS, CLAUDE, HANDOFF, PERFORMANCE, SKY-*, FABLE-PICKUP, …)
```

## Appendix B — Related artifacts outside default clone

- Draft release: https://github.com/SkyyPlayz/Mythos-Writer/releases/tag/wsl-handoff-2026-09-15  
- Handoff narrative: [`HANDOFF.md`](../HANDOFF.md)  
- Active build plan: [`docs/releases/BETA-REFINE.md`](releases/BETA-REFINE.md)

## Appendix C — Suggested owner checklist

- [ ] Approve P0 branch-deletion batch list  
- [ ] Decide retention for `wsl-handoff/*` + draft release  
- [ ] Approve `pr-screenshots/` eviction + archive destination  
- [ ] Decide companion plugin home  
- [ ] Refresh agent CI contract (`build-macos` myth vs `build-windows`)  
- [ ] Resume app work only after P0 (and ideally P1 media move) to avoid fighting clone bloat

---

*End of audit. No repository objects were deleted in producing this document.*
