# Mythos Writer — Repository Cleanup Audit

**Date:** 2026-09-16  
**Audited tip:** `origin/main` @ `71c5fad7077619ba4af3e14f0c4f579694c9144d`  
(`docs: add HANDOFF.md for the WSL -> grokbot migration`, PR #1585)  
**Auditor:** Cursor cloud agent (read-only inventory; this PR adds only this file)  
**Owner intent:** quality / security / usability first; cleanup before more app work.  
**Hard constraints honored here:**

- Do **not** delete files, force-push, or remove branches in this PR.
- Do **not** modify draft release [`wsl-handoff-2026-09-15`](https://github.com/SkyyPlayz/Mythos-Writer/releases/tag/wsl-handoff-2026-09-15).
- Flag `wsl-handoff/*` as **archive candidates**, never delete them in the first cleanup wave.

This document is the handoff the team can slice into phased cleanup PRs. Treat every "delete" recommendation as a later, owner-approved PR — not as something this audit already did.

---

## How the inventory was taken

The numbers in the kickoff note were hunches. They were re-measured against live `origin/main` and `git ls-remote --heads origin`:

| Claim | Measured 2026-09-16 | Verdict |
|---|---|---|
| Repo ~497 MB | GitHub `size` = **496,884 KB** (~485 MiB). Local `.git` = 488 MB. Working tree without `.git` = 249 MB. | Confirmed |
| ~283 remote branches | **283** heads (`git ls-remote --heads origin`) | Confirmed |
| ~2588 blobs on main | **2588** tracked paths (`git ls-tree -r HEAD`) | Confirmed (tracked files, not unique blob IDs) |
| Root dirs as listed | Present, plus root-level one-off markdown and `BugHunt-Fisher.sh` | Confirmed and expanded below |
| Large files dominated by plans / docs / pr-screenshots | Tracked bytes: `pr-screenshots` **118.2 MB**, `docs` **81.8 MB**, `plans` **30.0 MB** | Confirmed; `pr-screenshots` is the largest tree |
| Branch prefixes ~fix/72, sky-/30, claude/21, feat/19, wsl-handoff/14, chore/6 | See §5. Also **36** `screenshots/*` and **~36** `pr*`/`v9*` scratch heads, which the hunch missed | Expanded |
| Root one-off SKY-*.md / FABLE-PICKUP / PERFORMANCE / HANDOFF / ENGINEERING_LESSONS | All present; plus `CI-PREFLIGHT.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | Confirmed |

Method notes that affect later cleanup:

- **Squash-merge + WSL handoff capture commits** make `git merge-base --is-ancestor <branch> origin/main` almost useless. Of 283 heads, **282 are not ancestors of `main`**. Most are still leftover work: either a 1-commit screenshot branch (~1477 commits behind) or a `chore(handoff): uncommitted work from WSL worktree …` commit sitting on a stale base.
- Unique tip SHAs: **268** across 283 heads (10 tips are shared by more than one branch).
- Open PRs at audit time: **0**.
- Product GitHub issues: API `open_issues_count` = 1 (Paperclip was the real tracker; it did not migrate — see `HANDOFF.md` §5).

---

## 0. Executive recommendations

1. **Keep the shipping surface tiny.** The app that builds and ships is `frontend/` + `electron-main/` + `shared/` + packaging config + bundled samples/wallpapers/icons + the CI/release workflows. Everything else is planning, evidence, or Paperclip residue.
2. **The biggest cheap win is media, not code.** Tracked `pr-screenshots/` (118 MB) plus ticket folders under `docs/screenshots/` (74 MB) are ~75% of the working-tree weight and are not required to build, test, or ship.
3. **Do not delete `wsl-handoff/*` or the draft release.** Those are the only copies of rescued WSL worktrees / agent-clone bundles. Quarry first, archive second, delete never in P0/P1.
4. **Agent docs are lying about CI.** `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, and the PR template still require `CI / build-macos` + `CI / build-linux` on every PR. Current `ci.yml` has **no `build-macos` job**, and `build-linux` / `build-windows` are **skipped on `pull_request`**. `CI-PREFLIGHT.md` is the accurate local gate. Fix the docs in a dedicated follow-up so agents stop optimizing for a ghost check.
5. **Paperclip-era automation is still wired.** `close-ping.yml` calls `scripts/notify-board.sh` with hardcoded Paperclip company/project IDs. `scripts/paperclip/*` and `tests/paperclip/` survived the host retirement. Disable or delete in P1 after confirming nothing else pages that board.
6. **Branch count is not work.** HANDOFF already warned this: 534 branches in one agent clone pointed at one stale commit. The 283 remote heads are mostly squash leftovers, screenshot-check evidence branches, July PR scratch aliases, and WSL rescue tips. Delete by closed-PR head name + screenshot prefix, not by "ahead of main."

Suggested first cleanup PRs (after this audit lands):

| Later PR | Scope | Risk |
|---|---|---|
| P0-docs | Align `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` / PR template with live CI; redact stale PAT mention; point `docs/README.md` at this audit | Low |
| P1-media | Remove `pr-screenshots/` from `main`, gitignore it, keep README screenshots | Medium (history still holds blobs until a later filter) |
| P1-paperclip | Disable `close-ping.yml` + retire `scripts/notify-board.sh` / `scripts/paperclip/` | Low if Paperclip is gone |
| P1-branches | Delete `screenshots/*` + confirmed squash-merged heads. **Do not touch `wsl-handoff/*`.** | Low if list is reviewed |
| P2-docs-archive | Move root SKY specs + Beta 3 pickup docs into `docs/archive/` | Low |
| P2-history | `git filter-repo` / LFS for remaining PNGs — owner-only, after a full backup | High |

---

## 1. What is required to build / ship (keep)

These paths are the product. Do not delete them in cleanup.

### 1.1 App workspaces and lockfile

| Path | Why it stays |
|---|---|
| `package.json`, `package-lock.json` | Root workspaces, scripts, electron-builder entry. Version on main: **0.5.0-beta.4**. |
| `frontend/` | Renderer. Lint/typecheck/unit live here. Bundled wallpapers live at `frontend/src/assets/wallpapers/pack/` (~2.7 MB, **shipped pixels**). |
| `electron-main/` | Main process, IPC, vault, providers, Kokoro, fuzz targets. |
| `shared/` | Cross-process types (`ideaNotes.ts`, `vaultNameSanitizer.ts`, `wikiLinkRename.ts`, `types/suggestion.ts`). |
| `electron.vite.config.ts` | Production bundler config. |
| `electron-builder.json` | Windows NSIS/zip, Linux AppImage/deb/rpm, macOS dmg/zip. Extra resources: `sample-project/`, `electron-main/resources/samples`, `electron-main/resources/kokoro`. |
| `playwright.config.ts` | E2E runner. |
| `.env.example` | Documents env surface. |
| `.gitignore`, `.gitattributes`, `.prettierrc`, `.prettierignore` | Hygiene. Note: `.gitattributes` only forces LF on `electron-main/fixtures/*.md`. **Git LFS is not configured.** |
| `.npmaudit-baseline.json` | `dep-audit.yml` baseline. |

Workspace version drift (cleanup-adjacent, not delete): `frontend/package.json` and `electron-main/package.json` still say `0.5.0-beta.1` while the root is `0.5.0-beta.4`. Harmless for npm workspaces, confusing for humans.

### 1.2 Packaging assets

| Path | Why it stays |
|---|---|
| `build/icon.png`, `build/icon.ico` | electron-builder icons (Linux/mac + Windows). `icon.png` is 1.4 MB. |
| `build/entitlements.mac.plist` | Hardened runtime entitlements. |
| `build/notarize.js` | `afterSign` hook. No-ops without Apple certs (current `dist:mac` path). |
| `build/uninstall-vaults.nsh` | NSIS uninstall helper. |
| `sample-project/` | `electron-builder.json` `extraResources` → packaged `sample-project`. Tiny markdown (9 KB). |
| `electron-main/resources/samples/` | Bundled story templates (cozy-fantasy, mystery, sci-fi-noir, …). 85 tracked files. |
| `electron-main/resources/kokoro/LICENSE` | Weights are **gitignored** and fetched by `scripts/fetch-kokoro-assets.mjs` at `dist:*` time. Keep the license + fetch script. |
| `frontend/src/assets/logo.png` | App logo. |
| `frontend/src/assets/cosmic-bg.webp`, `default-bg.webp` | Default wallpapers. |
| `frontend/src/assets/wallpapers/` | Theme-match pack + `manifest.json` + README. Shipped. |

### 1.3 Scripts that the build / CI / lint actually call

| Path | Called from | Keep |
|---|---|---|
| `scripts/fetch-kokoro-assets.mjs` | `package.json` `kokoro:fetch` → every `dist:*` / `build` | Yes |
| `scripts/ci-retry.sh` | `.github/workflows/ci.yml` (`source … && retry npm ci`) | Yes |
| `scripts/preflight.sh` | `npm run preflight` — local CI-parity gate | Yes |
| `scripts/check-dead-wiring.mjs` + `scripts/dead-wiring-baseline.json` | `frontend` `lint` | Yes |
| `scripts/check-prototype-freshness.sh` | `npm run check:prototype-freshness`; FULL-SPEC §14.11 | Yes, while Beta 4 fidelity is the bar |
| `scripts/wallpapers/build-pack.py`, `write-provenance.py`, `measure-pack.mjs`, `crop.mjs`, `contact-sheet.mjs` | Wallpaper pipeline (`frontend/src/assets/wallpapers/README.md`, CHANGELOG SKY-11589) | Yes, as tooling next to the shipped pack |
| `.github/scripts/check-workflow-yaml.py` | `ci.yml` lint job (SKY-11200) | Yes |
| `.github/scripts/issue-finder.js` + `.test.js` | `issue-finder.yml` + `ci.yml` unit job | Keep the test if the workflow stays; see §4 |

### 1.4 Tests required for the merge gate

Current **PR-time** jobs that actually run (from `.github/workflows/ci.yml`):

| Job | Runs on PRs? | Role |
|---|---|---|
| `setup` | Yes | `npm ci` + shared `node_modules` cache |
| `paths-filter` | Yes | Docs-only skip for e2e |
| `lint` | Yes | Frontend ESLint + dead-wiring + Windows-illegal filename guard + workflow YAML parse |
| `typecheck` | Yes | frontend + electron-main |
| `unit` | Yes | electron-main + frontend Vitest + issue-finder test |
| `build-electron` | Yes | `npm run build:electron` |
| `e2e-shard-1` … `e2e-shard-4` | Yes, unless docs-only | Playwright suites listed in `package.json` / shard comments |
| `ci` | Yes (`if: always()`) | Aggregator required by branch protection (name: `CI / ci`) |
| `notes-windows` | Yes | Native Windows notes/vault/Kokoro-path suites — this is a real PR gate |
| `build-linux` | **No** (`if: github.event_name != 'pull_request'`) | AppImage/deb on pushes to `main` |
| `build-windows` | **No** (same guard; `continue-on-error: true`) | NSIS/zip on `main` pushes |
| `build-macos` | **Job does not exist** | `dist:mac` exists in `package.json` and `release.yml` has a disabled mac job |

Keep the whole `e2e/` tree that the four shards + `notes-windows` invoke. Do **not** start cleanup by deleting specs just because they look ticket-named; many `e2e/tests/sky-*.spec.ts` files are the live gate.

Also keep:

- `docs/releases/RELEASING.md` — current ship process (version-bump PR, then `release.yml`).
- `docs/releases/BETA-REFINE.md` + `plans/design-handoff/v2/` (FULL-SPEC, prototype, PROCESS, PERFORMANCE, BOARDS-SPEC) — product source of truth.
- `plans/ProjectGoalOverView/14-beta4-refine-overview.md`, `15-beta4-comparison-and-carryovers.md`, `00-decisions-log.md`, `13-team-goals.md`, `13-Code-Quality.md`.
- `CLAUDE.md` / `AGENTS.md` — agent merge-gate contract (needs a truth update; do not delete).
- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`.
- `docs/user-guide.md`, `docs/user-guide/entities.md`, `docs/keyboard-shortcuts.md`.
- `docs/security/*` (except treat `npm-audit-2026-07.md` as a dated snapshot).
- `docs/OFFLINE_VOICE_SETUP.md`, `docs/AUTO_UPDATE_TEST_GUIDE.md`.
- `docs/testing-strategy.md`, `docs/code-review-rubric.md`.
- `CI-PREFLIGHT.md` — the only root doc that currently describes CI correctly.

### 1.5 Prototype of record (keep, even though it is binary-heavy)

`plans/design-handoff/v2/prototype/` (**4.6 MB**):

- `Mythos Writer - Liquid Neon.dc.html` (~859 KB) — pixel/behavior authority.
- `support.js`, vendored `react*.min.js`, `babel.min.js` (**3.1 MB**) — offline render. `npm run fidelity:verify-offline` depends on these. Do not "dedupe" babel against a CDN.
- `assets/logo.png`, `assets/cosmic-bg.webp`.

The v1 copies at `design-handoff/prototype/` and `plans/design-handoff/prototype/` are already `MOVED.md` stubs. Keep the stubs until a docs-archive PR rewrites remaining Beta 3 links.

### 1.6 What is **not** required to ship

Everything in §2 obsolete, §3 archive, §4 dead, and §5 leftover branches. The Obsidian plugin at `plugin/Liquid-Neon-Companion/` is a **sibling product**, not part of the Electron app (BRAT install path `SkyyPlayz/liquid-neon-companion`). Keep it only if this monorepo is still the home for that plugin; otherwise extract later.

---

## 2. Docs / specs — useful vs obsolete

### 2.1 Keep as living sources of truth

| Path | Role |
|---|---|
| `plans/design-handoff/v2/FULL-SPEC.md` | Build spec. Prototype wins disagreements. |
| `plans/design-handoff/v2/prototype/` | Pixel/behavior authority. |
| `plans/design-handoff/v2/PROCESS.md`, `PERFORMANCE.md`, `BOARDS-SPEC.md`, `SILENT-FAILURE-SPEC.md`, `DESIGN-SPEC.md` | Active companions. `DESIGN-SPEC.md` is historical-context-per-README but still cited. |
| `plans/design-handoff/v2/GAP-REPORT-v2.md` | Historical gap list; still referenced by BETA-REFINE. Keep until the fidelity program closes. |
| `plans/design-handoff/v2/m29-welcome-wizard/SPEC.md` | Milestone spec still cited. |
| `plans/design-handoff/SKY-11192-BRAINSTORM-BOARDS-UNIFICATION-SPEC.md` | Landed Notes Board / Brainstorm unification. |
| `plans/design-handoff/FACT-LEDGER-CONTINUITY-SPEC.md`, `SCENE-CRAFTER-CANVAS-SPEC.md`, `M18-M19-M25-A11Y-DYSLEXIA-SPEC.md` | Feature contracts still in force unless a later PR supersedes them. |
| `plans/ProjectGoalOverView/14-beta4-refine-overview.md` | Current product overview. |
| `plans/ProjectGoalOverView/15-beta4-comparison-and-carryovers.md` | Binding carry-overs from docs 01–13. |
| `plans/ProjectGoalOverView/00-decisions-log.md` | Decision log (B4 block is live). |
| `plans/ProjectGoalOverView/13-team-goals.md`, `13-Code-Quality.md` | Working policy + quality bar. |
| `docs/releases/BETA-REFINE.md` | Active Beta 4 build plan. |
| `docs/releases/RELEASING.md` | Canonical release mechanics (SKY-10762). |
| `docs/releases/LIQUID-NEON-PROTOTYPE-MAP.md` | Line index into the `.dc.html`. Useful while fidelity work continues. |
| `PERFORMANCE.md` (repo root) | Measured packaged-build numbers. BETA-REFINE's DoD points here. Distinct from `plans/design-handoff/v2/PERFORMANCE.md` (qualitative fix order). |
| `plans/PERF_BUDGET.md` | Perf regression policy. |
| `HANDOFF.md` | 2026-09-15 WSL → grokbot migration. Current. Do not "archive" until the quarry work in §5 is done. |
| `CI-PREFLIGHT.md` | Accurate `npm run preflight` + "build-macos is on-demand only". |
| `docs/user-guide.md`, `docs/user-guide/entities.md`, `docs/keyboard-shortcuts.md` | User-facing. |
| `docs/security/electron-baseline.md`, `ipc-channel-review.md`, `untrusted-input-inventory.md`, `fuzz-triage-runbook.md`, `telemetry-audit.md` | Security program. |
| `docs/testing-strategy.md`, `docs/code-review-rubric.md` | Engineering bar. |
| `docs/jobs-background-queue.md`, `docs/vault-creation-primitive.md`, `docs/entity-reveal-point-contract.md` | Implementation contracts. |
| `docs/decisions/SKY-10957-state-db-location.md`, `docs/decisions/SKY-11787-panel-text-backing.md` | ADRs. |
| `docs/fidelity/SKY-11480-liquid-neon-gap-list.md`, `docs/fidelity/SKY-11799-notes-board-integration-gap-list.md` | Open fidelity deltas. |
| `docs/specs/SKY-11006-archive-continuity-panel-spec.md` | Feature spec. |
| `docs/TIMELINE-VIEWS-DESIGN-SPEC.md`, `docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md` | Timeline contracts. |
| `docs/MANUSCRIPT-STRUCTURE-VIEW-DESIGN.md` | Manuscript structure. |
| `docs/AGENT-HUB-SUGGESTION-INBOX-GAP-SPEC.md` | Inbox vs autonomy. |
| `docs/OFFLINE_VOICE_SETUP.md`, `docs/AUTO_UPDATE_TEST_GUIDE.md` | Ship/support. |
| `docs/perf/editor-cold-start.md` | Perf target. |
| `ENGINEERING_LESSONS.md` | Durable incident lessons (carve-outs, jsdom DragEvent, e2e waits). Keep; consider moving under `docs/` later so the root stays small. |
| `docs/qa/SKY-11600/wallpaper-pack-qa-notes.md` | Still relevant to the shipped wallpaper pack + SKY-11756 (`winter-2.webp`). |

### 2.2 Keep for now, but they are stale or conflicting (fix, don't delete blindly)

| Path | Problem |
|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.github/pull_request_template.md`, `CONTRIBUTING.md` | Still require `CI / build-macos` + `CI / build-linux` on every PR. **False.** Live PR gates are `CI / ci` + `notes-windows` (+ advisory `screenshot-check`, `carve-out-check`, `zero-diff-check`, path-filtered `fuzz` / `dep-audit`). |
| `docs/RELEASE_RUNBOOK.md` | Older Ivy/GHM flow; conflicts with `docs/releases/RELEASING.md`. |
| `docs/README.md` | Incomplete index (misses BETA-REFINE, RELEASING, this audit, security set). |
| `docs/ci-gate-audit-2026-06.md` | June 2026 snapshot. Claims `build-macos` stub + "branch protection not configured." Also embeds a **truncated GitHub PAT** (`github_pat_11ARTSEHA0EE1pSUUxf90j_...`). Rotate that token if it was ever committed in full; redact the mention. |
| `docs/security/npm-audit-2026-07.md` | Point-in-time audit. Keep as history; don't treat as current. |
| `docs/testing-strategy.md` | Still says "the two E2E suites required by CI are vault-crud + brainstorm." The live gate is four shards + `notes-windows`. |
| `plans/GOALS.md` | Mission/process still good; it points at `BETA-2-ROADMAP.md` as the live roadmap (wrong). |
| `plugin/Liquid-Neon-Companion/README.md` | Valid if the Obsidian plugin still ships from this repo. |

### 2.3 Obsolete / superseded — archive in a later docs PR (do not delete history)

Move to `docs/archive/` or `plans/archive/` and leave a one-line stub so old links don't 404.

| Path | Why obsolete |
|---|---|
| `FABLE-PICKUP.md` | 2026-07-14 Paperclip→Fable handoff. Lists #935/#933/#931/#914 as open. All long merged. **Misleading if an agent reads the root.** |
| `docs/releases/BETA4-PICKUP-2026-07-15.md` | Same era. "Ivy merges; ignore close-ping." |
| `docs/releases/BETA-LIQUID-NEON.md` | Beta 3 plan. Points at `design-handoff/prototype/` which is `MOVED.md`. Superseded by BETA-REFINE. |
| `plans/BETA-2-ROADMAP.md` | 2026-07-02 Beta 2 parts A–I. |
| `plans/PROJECT_PLAN.md` | Self-banner: outdated 2026-07-10. |
| `plans/ProjectGoalOverView/01-overview.md` … `12-visual-design-system.md` | Doc 15 already marks these outdated. |
| `plans/ProjectGoalOverView/questions.md`, `Mythos writer.md` | Resolved / original bible. |
| `plans/daily_run_template.md`, `plans/github_issue_fishing_plan.md`, `plans/bug_hunt_core_plan.md` | Paperclip daily-ops. |
| `design-handoff/` (repo root) | July 5 Claude Code handoff. Prototype moved. Duplicate of `plans/design-handoff/` v1. |
| `plans/design-handoff/README.md`, `DESIGN-SPEC.md`, `PROCESS.md`, `PROMPT.md` | v1 package; v2 is the record. |
| `SKY-456-SPEC.md` | 2026-06-02 UX spec (genre presets / quality rubric) for "Writing Assistant." Pre–Writing Coach rename. |
| `SKY-2968-component-spec.md` | 2026-06-30 v0.3 token/component spec. Superseded by FULL-SPEC + later token burn-down PRs. |
| `SKY-2970-onboarding-v0-3-ux-spec.md` | 2026-06-20 v0.3 onboarding (3-path). Later wizard work landed under M29 / SKY-7473. |
| `docs/OPERATIONS-LOG.md` | One line (2026-07-23 pipeline smoke). |
| `plans/phase3-architecture.md`, `plans/VAULT_GRAPH_VIEW.md`, `plans/Readability-Mode.md`, `plans/SCENE_CRAFTER_FORMAT.md`, `plans/SECURITY_REVIEW.md`, `plans/SMOKE_TEST_PLAN.md` | Pre-Beta-4 or one-off. Read before archive; some security findings may still be open. |
| `docs/qa/SKY-1990/advanced-tables-qa-notes.md` | Dated QA notes. |

### 2.4 Root markdown — proposed end state

Keep at repo root (agents and humans look here first):

- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE` (if/when added), `CLAUDE.md`, `AGENTS.md`, `HANDOFF.md`, `PERFORMANCE.md`, `CI-PREFLIGHT.md`

Move off the root in P2:

- `FABLE-PICKUP.md`
- `SKY-456-SPEC.md`, `SKY-2968-component-spec.md`, `SKY-2970-onboarding-v0-3-ux-spec.md`
- `ENGINEERING_LESSONS.md` → `docs/ENGINEERING_LESSONS.md` (update links)

---

## 3. Binary / media debt — keep vs archive

Tracked image-ish files on main: **534 png + 45 webp + 8 jpg + 5 svg**. Almost all of the 249 MB working tree that is not `node_modules` is screenshots.

### 3.1 Keep (ship or fidelity)

| Path | Size (approx) | Reason |
|---|---|---|
| `build/icon.png`, `build/icon.ico` | 1.4 MB + ico | Installer / app icon |
| `frontend/src/assets/wallpapers/pack/*.webp` (38 files) | ~2.7 MB total with logo/bgs | **Shipped** theme-match pack |
| `frontend/src/assets/{logo.png,cosmic-bg.webp,default-bg.webp}` | in the 2.7 MB | Shipped |
| `plans/design-handoff/v2/prototype/**` | 4.6 MB | Prototype of record + offline vendor JS |
| `docs/screenshots/onboarding-wizard.png` | — | README |
| `docs/screenshots/getting-started-panel.png` | — | README |
| `docs/screenshots/brainstorm-panel.png` | — | README |
| `docs/screenshots/settings-vault-badge.png` | — | README |
| `docs/screenshots/template-picker-gallery.png`, `save-as-template-dialog.png` | — | User-facing docs |
| `docs/assets/cloud-sync/*.svg` | 6 KB | Tiny; keep if the help doc still uses them |
| `electron-main/resources/samples/**` | text | Packaged templates |
| `sample-project/**` | 9 KB | Packaged extraResource |

**Shipped-pixel defect (do not silently delete):** `HANDOFF.md` / SKY-11756 — `frontend/src/assets/wallpapers/pack/winter-2.webp` cannot ship (generator caption baked into pixels). That is a **replace** ticket, not an archive ticket.

### 3.2 Archive / remove from `main` (P1) — not needed to build or run CI

These are PR evidence. `screenshot-check.yml` only requires an image in the **PR body or a PR comment**. It does not require committing PNGs to `main`. GitHub already stores the review images on the PR.

| Path | Tracked files | Tracked bytes | Notes |
|---|---|---|---|
| `pr-screenshots/` | 288 | **118.2 MB** | ~70 ticket/PR folders. Largest tree in the repo. |
| `docs/screenshots/sky*` and other ticket folders | ~180 of 194 | **~74 MB** of the 74.4 MB screenshot tree | Keep the four README PNGs; move the rest |
| `docs/evidence/SKY-9335/` | 2 | 876 KB | One-off fidelity pair |
| `plans/fidelity-rebuild/screenshots/` | 9 | ~6.2 MB | PR #9018/#9021 evidence |
| `plans/ProjectGoalOverView/Liquid-Neon-theme-examples/` | 11 images | **~16–18 MB** | Early moodboards; filenames have spaces (`Mythos writer Liquid Neon example 1.png`). Not the v2 prototype. |
| `plans/ProjectGoalOverView/Liduid-Glass-Dark-Neon- theme- exampels/` | 1 md | tiny | Typo-dirname leftover pointing at examples |
| `plans/Bug reports/bug refrence photos/` | 6 | (under plans 30 MB) | Typo path; bug-report photos |
| `plugin/Liquid-Neon-Companion/screenshots/` | 5 | part of plugin 1.1 MB | Move with the plugin if extracted |
| `e2e-visual-artifacts/sky-94-empty-state/` | 18 | 454 KB | **Gitignored and still tracked** (force-added). `.gitignore` already lists `e2e-visual-artifacts`. Safe to `git rm --cached`. |
| `docs/brand/company-logo-temp.png` | 1 | **2.09 MB** | README says "temporary company logo, 2026-06-17." Not referenced by the app. |

Largest single files (for a later LFS / filter pass):

| Bytes | Path |
|---|---|
| 3,137,752 | `plans/design-handoff/v2/prototype/babel.min.js` (**keep** — offline prototype) |
| 2,120,258 / 2,092,423 / 2,068,108 | Liquid-Neon theme-example PNGs |
| 2,092,423 | `docs/brand/company-logo-temp.png` |
| 1,615,155 | `docs/screenshots/sky11787/aurora-4-before-after.png` |
| 1,376,331 | `build/icon.png` (**keep**) |
| 1.1–1.2 MB each | dozens of `pr-screenshots/` and `docs/screenshots/` captures |

### 3.3 Visual-regression baselines — claimed, not present

`e2e/visual-baselines/README.md` describes committed `linux/1440x900/*.png` baselines. **The PNGs are not on `main`** — only the README (2.5 KB) is tracked.

`e2e/tests/visual-regression.spec.ts` (CI shard 3) **creates baselines on first run and passes**. That means the suite is currently a screenshot generator, not a regression gate. `vr-baselines.yml` is `workflow_dispatch` plus a leftover push trigger on `claude/ci-github-runners` (that branch still exists).

Cleanup choice (P2, owner call):

- **A.** Commit real linux baselines and make VR a real gate, or
- **B.** Drop `test:e2e:visual-regression` from shard 3 and delete the workflow until someone owns the flake budget.

Do not commit a surprise 10–20 MB baseline dump without that decision.

### 3.4 Recommended media policy going forward

1. PR screenshots live on the **PR** (body/comment), not on `main`.
2. Add `pr-screenshots/` to `.gitignore` after the delete PR.
3. Keep a small `docs/screenshots/` for README / user-guide only.
4. If historical evidence must be preserved, copy the tree into the **existing** draft release `wsl-handoff-2026-09-15` is the wrong place (do not modify it). Cut a **new** draft release e.g. `media-archive-2026-09` or a separate `Mythos-Writer-archive` repo.
5. Git LFS only after the one-time delete, for whatever media must remain (prototype vendor JS can stay as regular git; it changes rarely).

---

## 4. Scripts / CI — live vs dead

### 4.1 Workflows on `main`

| Workflow | Trigger | Verdict |
|---|---|---|
| `.github/workflows/ci.yml` | push/PR `main` | **LIVE.** Real merge gate. |
| `.github/workflows/release.yml` | `v*` tags + `workflow_dispatch` | **LIVE.** Ship path. `wsl-handoff-2026-09-15` is not `v*` so it cannot fire this. Leave that draft alone. |
| `.github/workflows/dep-audit.yml` | nightly + lockfile PRs | **LIVE.** Supply-chain. |
| `.github/workflows/fuzz.yml` | nightly + path-filtered PRs | **LIVE** (non-blocking historically; still useful). |
| `.github/workflows/screenshot-check.yml` | PR | **LIVE** advisory/fail on UI PRs without an image. |
| `.github/workflows/carve-out-check.yml` | PR | **LIVE** advisory (`.github/**`, migrations, secrets). |
| `.github/workflows/zero-diff-check.yml` | PR | **LIVE** advisory (empty PRs). |
| `.github/workflows/dependabot-auto-merge.yml` | `pull_request_target` | **LIVE** for Dependabot patch/minor. Review whether `pull_request_target` + write perms is still the desired posture now that the repo is **public**. |
| `.github/dependabot.yml` | weekly | **LIVE.** |
| `.github/workflows/issue-finder.yml` | weekly Monday 06:00 + manual | **QUESTIONABLE.** Built to dedupe `auto-found` fuzz issues for the Paperclip/GitHubManager loop. Harmless if it no-ops; disable if it opens junk issues. |
| `.github/workflows/vr-baselines.yml` | `workflow_dispatch` + push to `claude/ci-github-runners` | **STALE trigger.** The bootstrap push trigger should die. Keep dispatch only if VR is revived. |
| `.github/workflows/close-ping.yml` | PR closed | **DEAD / Paperclip.** Runs `scripts/notify-board.sh` with hardcoded `PAPERCLIP_COMPANY_ID` / `PROJECT_ID` / agent UUIDs. Comments in-file still talk about a self-hosted runner and `paperclipai` CLI. Hosted `ubuntu-latest` will fail or no-op. Disable in P1. |
| `.github/workflows/runner-watchdog.yml` | every 15 min | **PROBABLY DEAD.** Runs `scripts/paperclip/runner_watchdog.py`. Designed for the self-hosted fleet / stuck-job ghosts (SKY-2288). Hosted runners don't need a 15-minute poll. Disable; it burns Actions minutes. |

### 4.2 CI truth vs agent docs (actionable)

What agents are told (`CLAUDE.md` / `AGENTS.md`):

> A branch is not done until `CI / build-linux`, `CI / build-macos`, and `CI / ci` pass.

What `ci.yml` actually does on a pull request:

- `build-macos`: **absent**
- `build-linux`: **skipped** (`if: github.event_name != 'pull_request'`)
- `build-windows`: **skipped** on PRs, and `continue-on-error: true` on `main`
- Real required-looking jobs: `ci` aggregator, `notes-windows`, plus the lint/typecheck/unit/build-electron/e2e chain behind `ci`

`CI-PREFLIGHT.md` already says this. Update the agent docs in a follow-up **docs** PR so cleanup agents stop inventing macOS packaging work.

WSL leftovers still in `ci.yml` (harmless no-ops on hosted runners, but noise):

- "WSL2 power keep-alive" steps calling `scripts/ci-power-keepalive.ps1` (GabesPC / SKY-2427 / SKY-6906)
- Comments about self-hosted cache, GabesPC sleep, wine cross-builds

### 4.3 Scripts — dead or one-off

| Path | Verdict |
|---|---|
| `scripts/notify-board.sh`, `scripts/notify-board-test.sh` | Paperclip ping. Dead with the host. |
| `scripts/paperclip/runner_watchdog.py`, `hermes_429_watchdog.py`, `hermes_cap_manager.py`, `hermes_revert_sweeper.py`, `ops_dispatch.py` | Paperclip ops. `tests/paperclip/` only exists to test these. |
| `scripts/ci-power-keepalive.ps1` | WSL2 host sleep guard. Dead on `ubuntu-latest`. |
| `scripts/capture-sky10575.mjs` | One-off timeline AI-off capture. |
| `scripts/sky-94-debug.js`, `scripts/sky-94-capture.js` | One-off empty-state capture; produced the tracked `e2e-visual-artifacts/sky-94-empty-state/` tree. |
| `scripts/rebuild-native.js` | better-sqlite3 Electron ABI rebuild. Not referenced by current `package.json` scripts. Confirm before delete (may still be a human runbook). |
| `BugHunt-Fisher.sh` + `scripts/test-bughunt-fisher-smoke.sh` | Root daily bug-hunt driver. `package.json` has `bughunt:report`. Paperclip-era; `.gitignore` already drops `daily_bug_hunt_*.md`. Archive unless someone still runs it. |

### 4.4 E2E capture scripts (not the shard suites)

There are **40+** `e2e/capture-*.spec.ts` files and **20+** `e2e/fidelity/capture-*.mjs` one-shots. They are how `pr-screenshots/` and `docs/screenshots/` got onto `main`. They are **not** required for `npm run test:e2e:crud` / the four shards unless a shard lists them (most don't).

P2: move one-shot capture specs to `e2e/capture/` (or delete after the media archive) so new agents stop treating them as product tests. Keep `e2e/fidelity/capture-proto.mjs` + `capture-app2.mjs` while the fidelity program is alive (`npm run fidelity:proto` / `fidelity:app`).

### 4.5 Product releases are all still drafts

`gh release list` shows **every** product tag as Draft, including `v0.5.0-beta.4` down to `v0.2.0-beta.1`, plus the handoff dump. That is a **ship/usability** issue (README tells users to download Releases), not something this cleanup should publish. Flag for the owner. **Do not publish or edit `wsl-handoff-2026-09-15`.**

Handoff draft assets (leave untouched): 12 bundles + `MANIFEST.txt`. Largest: `FableEngineer.bundle` ~261 MB, `ProductEngineer.bundle` ~88 MB, `FoundingEngineer.bundle` ~86 MB, `shared-project-clone.bundle` ~78 MB.

---

## 5. Branch hygiene — delete vs archive vs keep

Remote heads: **283**. Open PRs: **0**.

**Do not use "is ancestor of main" as the delete signal.** Squash-merge means merged PR heads are not ancestors. The WSL rescue added a new commit on top of many old worktrees (`chore(handoff): uncommitted work from WSL worktree …` — 15 such commits found). Those tips are deliberately **not** on `main`.

### 5.1 Keep

| Ref | Why |
|---|---|
| `main` | Source of truth |

### 5.2 Archive — do not delete in any P0/P1 cleanup

| Ref | Why |
|---|---|
| `wsl-handoff/main-worktree-snapshot` | 641 staged-but-uncommitted files from the WSL primary checkout. HANDOFF §2a: "treat as a quarry, not a candidate." |
| `wsl-handoff/stash-0` … `stash-9` | Converted stash stack. Messages include superseded / "not part of PR." Read before acting. |
| `wsl-handoff/sky11213-create-scene-local` | Diverged local vs remote; pushed without clobbering. |
| `wsl-handoff/sky11791-column-ref-local` | Same. |
| `wsl-handoff/detached-sky11791-before` | Detached worktree rescue. |
| Draft release `wsl-handoff-2026-09-15` | 12 git bundles / ~572 MB. Only copy of 15 agent clones. **Do not edit, republish, or attach more assets in a cleanup PR.** |

After the quarry (cherry-pick anything still valuable onto a normal PR), the `wsl-handoff/*` heads can move to a later archive release or a `archive/wsl-handoff-*` tag. Deleting them before that is how the WSL lesson repeats.

Also treat as archive-until-quarried (same handoff commit pattern, not under the prefix):

- `claude/beta4-m19` (+16 / −522, 2026-09-15, "uncommitted work from WSL worktree mythos-sky6979-m19")
- Other 2026-09-15 `chore(handoff): uncommitted work from WSL worktree …` tips (`docs/sky-11031-…`, `feat/sky-9878-…`, several `fix/sky-*`). List by `git log --all --grep='chore(handoff)'`.

### 5.3 Delete candidates (later branch-hygiene PR; owner-approved list)

Safe-looking once a human glances at the closed PR / ticket:

**A. Evidence-only screenshot branches (36)** — 1 unique commit, typically `+1 / −1477`:

```
screenshots/pr-1438
screenshots/pr-1533
screenshots/pr-1550
screenshots/pr-1572
screenshots/pr-sky10367
screenshots/pr-sky11186
screenshots/pr-sky11187
screenshots/pr-sky11192
screenshots/pr-sky11220
screenshots/pr-sky11223
screenshots/pr-sky11237
screenshots/pr-sky11238
screenshots/pr-sky11242
screenshots/pr-sky11336
screenshots/pr-sky11356
screenshots/pr-sky11449
screenshots/pr-sky11450
screenshots/pr-sky11456
screenshots/pr-sky11458
screenshots/pr-sky11490
screenshots/pr-sky11491
screenshots/pr-sky11492
screenshots/pr-sky11501
screenshots/pr-sky11528
screenshots/pr-sky11590
screenshots/pr-sky11591
screenshots/pr-sky11591-anchors
screenshots/pr-sky11615
screenshots/pr-sky11619
screenshots/pr-sky11676
screenshots/pr-sky11717
screenshots/pr-sky11804
screenshots/sky-10604
screenshots/sky-9013-m1
screenshots/sky-9825
screenshots/sky-9826
```

**B. July 2026 PR scratch aliases** (duplicate tips of long-merged Beta 4 PRs):

`pr914`, `pr914v`, `pr914x`, `v914c`, `v914d`, `pr917`, `pr917v`, `v917`, `pr926`, `pr932`, `pr932new`, `pr932v`, `pr937`, `pr938`, `pr939`, `pr939b`, `pr939c`, `pr940`, `pr941`, `pr943`, `pr945`, `pr949`, `v949`, `pr950`, `pr953`, `pr953v`, `pr953w`, `pr954`, `pr955`, `fix914`, `fix953`, `pr-1283-check`, `pr-1350-review`, `pr-1388`, `pr-1559-check`, `pr1292-ref`, `pr1331-ref`, `pr-screenshots/pr-1406-sky11244`

**C. Head refs of recently squash-merged PRs that were never deleted** (15 of the last 100 merged PRs still have their head on the remote), including:

`cursor/lift-gap1-fixme-ce64` (#1584), `fix/sky-11887-kokoro-wasm-windows` (#1582), `fix/sky-11891-legacy-migration-grouped-layout` (#1583), `feat/sky-11787-panel-text-backing`, `fix/sky-10407-remove-upgrade-ui`, and others listed by:

```bash
comm -12 \
  <(gh pr list --repo SkyyPlayz/Mythos-Writer --state merged --limit 200 --json headRefName --jq '.[].headRefName' | sort -u) \
  <(git ls-remote --heads origin | awk '{print $2}' | sed 's|refs/heads/||' | sort)
```

**D. Stale agent / QA / test / ci prefixes** after confirming no unique uncommitted work (most are July Beta 4 milestone branches, 470–650 commits behind):

- `claude/beta4-m12` … `m29`, `claude/beta4-handoff`, `claude/sky-*` (21 heads) — **except** any 2026-09-15 handoff-capture tip in §5.2
- `qa/sky-*` (6), `test/sky11184-e2e-ac*` (5), `ci/fuzz-concurrency-cancel-sky-7338`, `ci/sky-6933-wire-orphaned-e2e-specs`, `ci/speed-patch-2026-07-17`
- `chore/bump-0.5.0-beta.4`, `chore/bump-v0.5.0-beta.2`, `chore/version-bump-v0.5.0-beta.3`, `chore/disable-macos-budget-burn`, `chore/copilot-rules-of-engagement`, `chore/wei-1811-production-start`
- `rebase-sky9027-onto-main`, `rebase/sky-10963-pr1314`
- `worktree-sky11318-reveal-point`, `worktree-sky11444-preview-mode-leak-rebase2`

**E. The long `fix/*` (72) and `feat/*` (19) and `sky-*` / `SKY-*` (44) lists** — assume leftover until proven otherwise. Delete only after the `comm` intersection with merged PR heads, or after a week of "any unique commit we still want?" review.

### 5.4 Review before delete (may hold unique commits)

| Ref | Why review |
|---|---|
| `wip/qa-e2e-section-controller-shelf` | +48 / −657, explicitly "shelve" from Fable handoff |
| `wip/sky-9022-m6-rebase-on-m5-20260807` | Named rebase WIP |
| `plan/agent-architecture-block`, `plan/fidelity-rebuild` | Planning branches |
| `spec/sky-11018-fact-ledger` | Spec branch |
| `design/liquid-neon-prototype-refresh` | May predate the 2026-07-30 prototype export |
| `ops/self-hosted-off-while-public` | Historical CI policy |
| `ivy/pipeline-smoke-20260723` | Ivy smoke |
| `assets/sky-8265-ac17-screenshot` | Evidence branch |
| `m22x` | Timeline axis spike |
| `sky-8881-repro-no-fix` | Named "repro, no fix" |
| `fix/sky-7108-missing-scene-prose` | +18 on a July base; check if still an open hole |

### 5.5 Process changes (P2, owner)

- Enable **automatically delete head branches** on GitHub so the next 200 PRs don't repeat this.
- Ban `screenshots/*` as a long-lived remote prefix; attach images on the PR.
- One shared clone + worktrees (HANDOFF §4). Do not recreate per-agent full clones.
- Never force-push `main`. Never delete `wsl-handoff/*` from a cleanup script.

---

## 6. Cleanup phases (concrete paths)

### P0 — Safe, docs-only, do immediately after this audit

Goal: stop agents and humans from acting on lies. No deletes.

| Action | Paths |
|---|---|
| Land this file | `docs/REPO_AUDIT.md` (this PR) |
| Follow-up docs PR: tell the truth about CI | `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md` — replace "three required checks: ci + build-linux + build-macos" with live jobs (`ci`, `notes-windows`; packaging on `main` / `release.yml` only) |
| Point the docs index here | `docs/README.md` |
| Redact PAT mention + rotate if the full token ever existed | `docs/ci-gate-audit-2026-06.md` (and `git log -S 'github_pat_' --all`) |
| Wallpaper defect ticket (already in HANDOFF) | `frontend/src/assets/wallpapers/pack/winter-2.webp` — replace, don't delete the slot |
| Confirm draft release untouched | `wsl-handoff-2026-09-15` |

### P1 — High value, reversible, no history rewrite

Goal: shrink what new clones fetch *from the tip* and kill dead automation. History will still contain the blobs until P2.

**P1a — media off `main`**

```
git rm -r pr-screenshots/
# keep README user-facing shots; remove ticket folders:
git rm -r docs/screenshots/sky11480 docs/screenshots/sky-11589 docs/screenshots/sky11186 \
  docs/screenshots/sky-11799 docs/screenshots/sky11361-palette docs/screenshots/sky11494 \
  docs/screenshots/sky11448 docs/screenshots/sky11452 docs/screenshots/vault-icons-sky9310 \
  docs/screenshots/sky-11069-board-tabs docs/screenshots/sky9824-scenes-tab \
  docs/screenshots/sky-11377-vault-rail-neon-glow docs/screenshots/sky-11209-liquid-neon-views \
  docs/screenshots/sky-10917-editor-shell-fidelity docs/screenshots/sky-10914-liquid-neon-glass-bridge \
  docs/screenshots/sky10575 docs/screenshots/sky-8435-dyslexia-typography \
  docs/screenshots/sky-8111 docs/screenshots/sky-11132-open-folder-guard \
  docs/screenshots/sky-11047-brainstorm-glass docs/screenshots/idle-cpu-fix-sky8566 \
  docs/screenshots/folder-ops-sky7995 docs/screenshots/timeline-views \
  docs/screenshots/timeline-right-panel-resize-sky7956 docs/screenshots/sky9019-m5-nav \
  docs/screenshots/sky-7649-wizard-provider-step docs/screenshots/sky11787 \
  docs/screenshots/sky11717 docs/screenshots/sky11566 docs/screenshots/sky-11489-dead-color-family \
  docs/screenshots/sky-11489-dead-bg-family docs/screenshots/sky-11359-idea-board-rename \
  docs/screenshots/sky-11210-story-cluster-toggle docs/screenshots/sky-11058-notes-vault-picker \
  docs/screenshots/sky-11049-suggested-card-selection docs/screenshots/sky-10908-reduced-transparency-glass \
  docs/screenshots/sky-10738 docs/screenshots/rename-cascade-sky10712 docs/screenshots/pr1191 \
  docs/screenshots/vault-graph-bounds-sky10933 docs/screenshots/split-pane-tab-strips-sky8907 \
  docs/screenshots/sky9710-notes-empty-state docs/screenshots/sky-8943 \
  docs/screenshots/sky-11429 docs/screenshots/sky-11376-vault-location-picker \
  docs/screenshots/sky-11360 docs/screenshots/sky-11221-beta-reader-consolidation \
  docs/screenshots/sky-11212-tag-priority docs/screenshots/sky-11211 \
  docs/screenshots/sky-11188 docs/screenshots/sky10929 \
  docs/screenshots/notes-split-pane-tab-strips-sky9784
git rm docs/brand/company-logo-temp.png
git rm -r docs/evidence/SKY-9335
git rm -r plans/fidelity-rebuild/screenshots
git rm -r "plans/ProjectGoalOverView/Liquid-Neon-theme-examples"
git rm -r "plans/ProjectGoalOverView/Liduid-Glass-Dark-Neon- theme- exampels"
git rm -r "plans/Bug reports/bug refrence photos"
git rm -r e2e-visual-artifacts
```

Then add to `.gitignore`:

```
pr-screenshots/
e2e-visual-artifacts/
```

Keep: `docs/screenshots/onboarding-wizard.png`, `getting-started-panel.png`, `brainstorm-panel.png`, `settings-vault-badge.png`, plus any user-guide images still linked.

Optional: tarball the deleted tree and attach it to a **new** draft release `media-archive-2026-09` before `git rm`.

**P1b — Paperclip / WSL CI residue**

Disable (or delete) workflows:

- `.github/workflows/close-ping.yml`
- `.github/workflows/runner-watchdog.yml`
- Push-trigger block in `.github/workflows/vr-baselines.yml` (`branches: [claude/ci-github-runners]`)

Then `git rm` (after disable, so a revert is easy):

```
scripts/notify-board.sh
scripts/notify-board-test.sh
scripts/paperclip/
tests/paperclip/
scripts/ci-power-keepalive.ps1
```

Strip the WSL keep-alive steps from `.github/workflows/ci.yml` in the same PR or a carve-out follow-up (that file is a carve-out path — `carve-out-check` will flag it; do not bury it in a feature PR).

**P1c — branch delete (no force-push, no `wsl-handoff/*`)**

A dedicated hygiene PR is the wrong vehicle — this is a `git push origin --delete` list run from a laptop with owner credentials, after publishing the list as a GitHub issue for 48 hours. Start with §5.3 A + B + C only (~90 heads). Leave `fix/*` / `feat/*` / `claude/*` for a second pass.

### P2 — Structural, after P1 has soaked

| Action | Paths / notes |
|---|---|
| Archive obsolete docs | Root `SKY-456-SPEC.md`, `SKY-2968-component-spec.md`, `SKY-2970-onboarding-v0-3-ux-spec.md`, `FABLE-PICKUP.md`; `docs/releases/BETA-LIQUID-NEON.md`, `BETA4-PICKUP-2026-07-15.md`; `plans/BETA-2-ROADMAP.md`, `plans/PROJECT_PLAN.md`; `design-handoff/` root stub; ProjectGoalOverView 01–12 (leave 00/13/14/15) |
| Relocate lessons | `ENGINEERING_LESSONS.md` → `docs/ENGINEERING_LESSONS.md` |
| Capture-spec fold | `e2e/capture-*.spec.ts` → `e2e/capture/` or delete once media is archived |
| VR decision | Commit baselines **or** remove shard-3 `test:e2e:visual-regression` |
| Plugin extract | `plugin/Liquid-Neon-Companion/` → `SkyyPlayz/liquid-neon-companion` if that is still the public home |
| Sample dedup | `sample-project/` vs `electron-main/resources/samples/` — both are packaged (`extraResources`). Confirm they are not duplicates before merging. |
| History rewrite / LFS | Only with owner backup + coordinated clone reset. Removes the 118 MB of `pr-screenshots` from `.git`, which a tip-only `git rm` will **not** do. |
| GitHub settings | Auto-delete head branches; decide whether product releases stay draft; do not touch the handoff draft |
| Dependabot `pull_request_target` review | Public repo + write token is a classic confused-deputy shape. Keep if still trusted; otherwise drop auto-merge. |

Out of scope for cleanup but blocking "more app work" quality:

- Align frontend/electron-main `package.json` versions with root `0.5.0-beta.4`.
- Decide the real PR required-check set and configure branch protection to match (this audit could not read protection: API 403).
- Product releases all draft — users following README cannot download a published build.

---

## 7. Deletion risks per category

### 7.1 App / packaging code

| If you delete… | What breaks |
|---|---|
| `frontend/`, `electron-main/`, `shared/` | Everything |
| `sample-project/` | Packaged extraResource; first-run sample path |
| `electron-main/resources/samples/` | In-app templates |
| `electron-main/resources/kokoro/LICENSE` + fetch script | TTS packaging / legal |
| `frontend/src/assets/wallpapers/pack/` | Theme-match UI (empty pack) |
| `build/icon.*`, `entitlements`, `notarize.js`, `uninstall-vaults.nsh` | Installers |
| `scripts/fetch-kokoro-assets.mjs` | Every `dist:*` |
| `scripts/check-dead-wiring.mjs` | Frontend lint goes red or silent |
| Prototype `babel.min.js` / `react*.min.js` | Offline fidelity (`fidelity:verify-offline`) |

**Risk: high. Do not include these in cleanup PRs.**

### 7.2 Living specs

Deleting `plans/design-handoff/v2/**`, `docs/releases/BETA-REFINE.md`, `PERFORMANCE.md`, `HANDOFF.md`, or ProjectGoalOverView 14/15/00/13 will immediately mis-brief every agent (CLAUDE.md mandates those reads).

**Risk: high for agents, not for the compiled app.**

### 7.3 `pr-screenshots/` and ticket screenshot folders

- **Runtime risk:** none. Not imported by the app or CI shards.
- **Process risk:** old PRs that deep-link `https://github.com/SkyyPlayz/Mythos-Writer/blob/main/pr-screenshots/...` will 404 on `main`. The images remain on the PR timeline and in git history.
- **Clone-size risk if you only `git rm`:** new clones of `main` get smaller; `.git` stays huge until a filter-repo.

**Risk: low for product, medium for archaeology. Mitigate with a new archive release, not by keeping 118 MB on `main`.**

### 7.4 `e2e-visual-artifacts/` (tracked + gitignored)

Removing the tracked SKY-94 PNGs is safe. The directory is already supposed to be generated. **Risk: none.**

### 7.5 Visual-regression suite

Removing the spec without a decision: shard 3 loses a "test" that currently only writes uncommitted PNGs. Keeping it: first CI run on a fresh checkout "passes" by creating baselines that vanish with the runner — **false confidence.**

**Risk: medium (quality illusion), not a ship-breaker.**

### 7.6 Paperclip scripts / `close-ping.yml`

If anything still listens on that Paperclip company UUID, disabling close-ping re-opens the SKY-3005 token-waste loop the workflow was built to stop. HANDOFF §5 says the host automation fleet "does not carry over."

**Risk: low if Paperclip is gone; confirm with Skyy before P1b.**

### 7.7 `issue-finder.yml`

May still file GitHub issues from fuzz logs. Disable first (workflow `if: false`), watch one Monday, then delete.

**Risk: low.**

### 7.8 Root SKY specs / FABLE-PICKUP

Agents that glob `*.md` in the repo root will treat July onboarding specs and a dead PR queue as current. **Leaving them is riskier than moving them.**

**Risk of move: low** (break bookmarks). **Risk of leaving: medium** (wrong agent behavior).

### 7.9 Branches

| Delete… | Risk |
|---|---|
| `screenshots/*`, `pr9xx` aliases | Low. Unique content is images or duplicate July tips. |
| Squash-merged `fix/sky-11887-*` etc. | Low. Work is on `main`. |
| `wsl-handoff/*` | **High.** Only GitHub copy of rescued stashes / the 641-file quarry. |
| `claude/beta4-m19` and other `chore(handoff)` tips | **High** until quarried. They are not on `main` by design. |
| `wip/*`, `sky-8881-repro-no-fix` | Medium. May be the only repro. |
| Draft release `wsl-handoff-2026-09-15` | **Critical.** 15 agent clones, 572 MB. Irreplaceable once the WSL disk is gone. |

### 7.10 History rewrite (`git filter-repo` / BFG)

Removes media from clones forever, and **rewrites every SHA**. Breaks every open discussion link, every agent's remembered commit, and the handoff bundles' ability to merge cleanly onto rewritten `main`.

**Risk: critical. Owner-only, after a full mirror clone + the handoff draft is copied elsewhere. Not P0/P1.**

### 7.11 Security leftovers

- Truncated PAT in `docs/ci-gate-audit-2026-06.md` — assume compromised; rotate. Grep history for `github_pat_11ARTSEHA0`.
- Hardcoded Paperclip UUIDs in `close-ping.yml` — not GitHub credentials, but they document a retired control plane.
- `dependabot-auto-merge.yml` on a **public** repo uses `pull_request_target` + `contents: write`. Worth a dedicated security pass, not a drive-by delete.

No live `sk-ant-api0` / cloud keys were found in tracked source (test fixtures use obvious fakes).

---

## 8. Verified tree map (tip of `main`)

Tracked bytes / file counts by top-level path:

| Bytes | Files | Path | Cleanup bucket |
|---|---|---|---|
| 118,220,009 | 288 | `pr-screenshots/` | P1 archive |
| 81,803,870 | 263 | `docs/` | Keep text; P1 most of `docs/screenshots/` |
| 30,002,285 | 99 | `plans/` | Keep v2 + 14/15/00/13; P1 moodboard PNGs; P2 archive 01–12 |
| 11,217,347 | 940 | `frontend/` | Keep |
| 4,920,264 | 588 | `electron-main/` | Keep |
| 3,549,654 | 277 | `e2e/` | Keep shard specs; P2 capture-* |
| 1,576,121 | 5 | `build/` | Keep |
| 1,137,888 | 15 | `plugin/` | Keep or extract (P2) |
| 729,704 | 25 | (repo root files) | Keep README/CI/HANDOFF; P2 move SKY-* / FABLE |
| 453,785 | 18 | `e2e-visual-artifacts/` | P1 `git rm --cached` |
| 203,070 | 24 | `scripts/` | Keep live; P1 paperclip/one-offs |
| 134,439 | 18 | `.github/` | Keep ci/release; P1 close-ping/watchdog |
| 25,965 | 2 | `tests/` | P1 with paperclip |
| 15,118 | 5 | `design-handoff/` | P2 archive (MOVED stubs) |
| 13,473 | 6 | `shared/` | Keep |
| 9,328 | 15 | `sample-project/` | Keep |

Remote branch buckets (283):

| Count | Bucket | Default action |
|---|---|---|
| 1 | `main` | Keep |
| 14 | `wsl-handoff/*` | Archive forever (this wave) |
| 36 | `screenshots/*` | Delete after 48h notice |
| ~36 | `pr*` / `v9*` / `fix914` scratch | Delete after 48h notice |
| 72 | `fix/*` | Delete if merged-PR intersection; else review |
| 44 | `sky-*` / `SKY-*` | Same |
| 21 | `claude/*` | Review handoff-capture tips; delete the rest |
| 19 | `feat/*` | Same as `fix/*` |
| 6 | `chore/*` | Delete after confirm |
| 6 | `qa/*` | Delete after confirm |
| 5 | `test/*` | Delete after confirm |
| 3 | `ci/*` | Delete after confirm |
| 2 | `docs/*` | Review |
| 2 | `wip/*` | Review |
| 2 | `worktree-*` | Review |
| 2 | `rebase*` | Delete |
| 11 | other (`plan/`, `spec/`, `ops/`, `ivy/`, `m22x`, …) | Review |

---

## 9. What this PR did **not** do

- Did not delete, rename, or `git rm` any existing path.
- Did not push `--delete` for any branch.
- Did not force-push.
- Did not edit `HANDOFF.md`.
- Did not create, edit, publish, or attach files to draft release `wsl-handoff-2026-09-15`.
- Did not change workflows, CI, or ignore rules (those are later PRs).
- Could not read GitHub branch-protection settings (API 403). Confirm required checks in the repo settings UI before changing agent docs.

---

## 10. Suggested issue titles for the follow-up PRs

1. `docs: align agent CI contract with live ci.yml (no build-macos on PRs)`
2. `chore: remove pr-screenshots and ticket screenshot trees from main`
3. `ci: disable Paperclip close-ping and runner-watchdog`
4. `chore: delete leftover screenshots/* and merged PR head branches` (ops, not a code PR)
5. `docs: archive Beta 2/3 and root SKY v0.3 specs`
6. `chore: decide visual-regression baselines — commit or drop`
7. `security: rotate PAT referenced in docs/ci-gate-audit-2026-06.md`
