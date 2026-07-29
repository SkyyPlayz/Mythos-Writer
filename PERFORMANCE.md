# PERFORMANCE.md — Baseline numbers & packaged perf-trace procedure

**Status:** restored 2026-07-22 (SKY-7936, premortem SKY-7934). This file went
missing while `docs/releases/BETA-REFINE.md` still asserted the perf gate
against it — the gate was checking a doc that didn't exist. This file is the
one **BETA-REFINE.md's Definition of Done and W0.5** point at.

For the qualitative fix-order plan (why the shipped v0.4.0-beta.1 is slow,
what to change) see `plans/design-handoff/v2/PERFORMANCE.md`. This file is the
**measured-numbers companion**: what we actually recorded, on what build, on
what hardware, and the procedure to reproduce it.

## Rule: every wave re-runs this, not just at M30

Each merged Beta 4 wave (M-numbered PR/PR-set that lands on `main`) **must**
re-run the procedure below before the wave is considered closed, and append
its numbers to the [Wave-boundary log](#wave-boundary-log). This is a change
from the original plan (perf gate only at the final M30 sign-off) — the
premortem found regressions accumulate silently for 7+ waves if perf is only
checked once at the end. A wave that regresses >25% on any metric without a
documented reason is a bug, same policy as `plans/PERF_BUDGET.md`.

## 1. Packaged-build cold start (window + editor interactive)

**Procedure** (packaged build, not `electron-vite dev` — dev server/HMR skews
every number below):

```bash
npm run build:electron                     # electron-vite build -> out/
xvfb-run -a node_modules/.bin/electron \
  --disable-gpu-sandbox --enable-logging=stderr --v=0 \
  out/main/main.js --user-data-dir=<scratch-dir>
```

Seed `<scratch-dir>/vault-settings.json` + `app-settings.json` to point at a
vault before launch (see `e2e/export-formats.spec.ts`'s `seedUserData` for the
exact shape) — an unseeded profile shows the onboarding flow instead of a
cold-start editor path.

Read the `[perf]` marks from stdout/stderr: `app:startup → window` (main
process, `app.whenReady()` to `BrowserWindow` created), `app:fts-build` (FTS5
index build, deferred off the IPC path per `docs/perf/editor-cold-start.md`),
and the renderer's `settingsGet IPC` / `renderer:interactive` console marks
(forwarded to the terminal via `--enable-logging=stderr`).

**Baseline — measured 2026-07-22, packaged build (`electron-vite build`),
headless Linux via Xvfb, WSL2 host.** Raw logs committed at
`docs/perf/traces/cold-start-*-2026-07-22.log`.

| Scenario | window created | fts-build | settingsGet → interactive | Total to interactive |
|---|---:|---:|---:|---:|
| Empty vault (0 scenes) | 71 ms | 1 ms | 34 ms | **~106 ms** |
| Large vault (1 000 scenes, 5.1 MB) | 105 ms | 98 ms | 75 ms | **~278 ms** |

These are headless/Xvfb numbers on shared CI-class hardware — expect faster
wall-clock on a real display/GPU, but the *relative* cost of FTS build on a
large vault (98 ms, ~35% of total) is the number to watch for regression.

## 2. Editor open (click a scene → ProseMirror visible)

**Not yet automated.** Attempting to script this via Playwright against a
freshly-seeded vault hit the onboarding/"upgrade your vault format" overlay
that a scripted `vault-settings.json` seed produces (real user vaults created
through the app don't hit this). Follow-up: extend
`e2e/export-formats.spec.ts`'s `seedUserData` pattern with the fields that
suppress the legacy-format banner, then measure story-navigator-expand → scene
click → `.ProseMirror` visible under the same headless/Xvfb harness as §1.
Tracked as a fast-follow child of this issue; do not block the Wave-0 gate on
it, but the next wave that touches editor mount/navigation must close it.

## 3. Large-vault data operations (packaged Node bench, not UI)

**Procedure:**

```bash
cd electron-main
NODE_PATH=../node_modules npm run perf
cat ../plans/PERF_BUDGET.md
```

This runs the vitest bench in `electron-main/src/perfBudget.bench.ts` against
a synthetic 1 000-scene / 5 000-entity vault — real `better-sqlite3` +
FTS5 + Archive Agent code paths, not mocked. Full report + regression policy
live in `plans/PERF_BUDGET.md`; machine-readable baseline in
`plans/PERF_BASELINE.json`. Refreshed as part of this issue (2026-07-22);
flagged 4 regressions vs. the stale 2026-05-24 baseline (`db_open_ms` +258%,
`vault_reindex_ms` +42%, `fts5_build_ms` +43%, `archive_index_ms` +117%) —
filed separately, not blocking this doc restoration since the baseline itself
was updated to today's numbers (`PERF_UPDATE_BASELINE=1 npm run perf`).

## 4. UI-runtime targets (packaged build, headless CDP/rAF/`/proc` harness)

**Procedure** (packaged build, same headless launch pattern as §1/§3 —
`e2e/scene-save-perf.spec.ts` / `e2e/export-formats.spec.ts`'s `seedUserData`
shape, never `electron-vite dev`):

```bash
npm run build:electron
xvfb-run -a npm run perf:ui-runtime   # builds again + runs the 4-metric spec
# or, if out/ is already fresh:
xvfb-run -a npm run test:e2e:perf-ui-runtime
```

This runs `e2e/perf/ui-runtime.spec.ts` (support modules in
`e2e/perf/ui-runtime/`), which measures the 4 targets below against a real
Electron process — no metric here is mocked/stubbed; only the
`agent:writing-assistant` IPC handler is replaced with a deterministic
streaming mock for target 4, exactly like `e2e/writing-assistant.spec.ts`
already does for its own tests:

1. **Keystroke → paint** — a CDP `Tracing` session captures `RunTask`
   scheduler-task durations around real `page.keyboard.type` input into the
   live ProseMirror editor; reports p50/p95 main-thread-busy ms per keystroke.
2. **Idle CPU** — polls `/proc/<pid>/stat` for the Electron main and renderer
   processes over a 5s idle window (no interaction), converts utime+stime
   tick deltas to a CPU percentage. Linux-only (matches this repo's headless
   Xvfb CI target); refuses to report a number on other platforms.
3. **Ambient animation fps** — samples real `requestAnimationFrame` deltas
   against the always-on ambient wallpaper layer for 3s. The one launch
   variant that must NOT set `--force-prefers-reduced-motion` (that flag
   collapses the ambient animation to a no-op, per
   `frontend/src/theme/liquidNeon.css`), so this is measured with real motion.
4. **Dropped frames with agents live** — reuses the fps sampler from target 3
   while a mocked Writing Coach chat stream is actively emitting chunks, and
   compares the streaming window's dropped-frame rate against the same run's
   own idle baseline.

This harness is a **measurement tool, not a CI regression gate** — a target
miss does not fail the spec (only a broken measurement pipeline does; see the
spec file's top-of-file note). Pass/fail against each target is recorded in
`plans/PERF_UI_RUNTIME_BASELINE.json` (JSON) and the console table `npm run
perf:ui-runtime` prints. It is not wired into `.github/workflows/ci.yml` (out
of scope for SKY-8217) — run it manually per wave, same cadence as §1/§3.

**Baseline — measured 2026-07-23, packaged build, headless Xvfb, WSL2 host**
(the same class of virtualized environment as §1's cold-start numbers — see
that section's caveat about expecting faster wall-clock on real display/GPU
hardware):

| Metric | Result | Target | Status |
|---|---:|---:|:---:|
| Keystroke → paint (p95, n=20) | 47.2 ms | < 16 ms | ❌ |
| Idle CPU (main + renderer, 5s window) | 4.8% (main 0.2%, renderer 4.6%) | ~0% (harness bar: ≤ 1%) | ❌ |
| Ambient animation fps floor (95%-of-frames, n=181) | 59.5 fps | ≥ 57 fps (60fps target) | ✅ |
| Dropped-frame delta, streaming vs. idle | 0.0 pp | ≤ 5 pp | ✅ |

Full sample data in `plans/PERF_UI_RUNTIME_BASELINE.json`. The two misses are
tracked as a follow-up, not blocking this harness — see SKY-8217's close-out
comment on SKY-8216 for the filed issue.

### SKY-8224 fixes (2026-07-28) — targeted root causes, re-measure blocked on a quieter host

Root-caused and fixed two concrete regressions the SKY-8217 numbers pointed
at:

1. **Keystroke → paint.** `AutoLinkerExtension` (`frontend/src/AutoLinkerExtension.ts`)
   rebuilt entity-mention decorations by walking the **entire document** and
   text-scanning every node against every entity name/alias on **every**
   `docChanged` transaction — i.e. every keystroke, cost scaling with total
   document size regardless of what changed. `WikiLinkResolutionExtension`
   and `NoteLinksBlockExtension` have the same full-doc-walk shape but scan
   for specific node types rather than doing a text scan per character, so
   they're cheaper; not changed in this pass. Fixed `AutoLinkerExtension` to
   scope the rebuild to the changed textblock(s) only (map old decorations
   through the transaction, rescan just the edited paragraph(s), same
   pattern ProseMirror's own decorate-changed-ranges recipe uses). Verified
   with an isolated microbenchmark (`frontend/src/AutoLinkerExtension.test.ts`
   — see PR for the throwaway bench script) on a synthetic 300-paragraph /
   150-entity document: full-doc rebuild **9.3 ms/keystroke** vs. scoped
   rebuild **0.025 ms/keystroke**, a 377x reduction, isolated from
   Electron/Xvfb noise. This directly targets the top suspect the SKY-8217
   baseline flagged.
2. **Idle CPU (partial, spec-compliance fix, not the main driver).**
   `useWritingScheduler`'s constant-interval heartbeat mode did not skip a
   tick while the user was actively typing, contradicting this doc's own §4
   prescription ("skips when the user typed in the last N seconds"). Fixed:
   the constant-interval tick now defers if a keydown happened within the
   last 5s. This does **not** move the harness's idle-CPU number (that
   window has zero interaction by definition — the bug this fixes only
   matters while typing), but it is a real behavior fix and closes the gap
   between this doc and the code.

**Re-measurement in this execution's sandbox was inconclusive and not
committed as a new baseline.** A same-sandbox control run of the *unmodified*
pre-fix code measured keystroke p95 **179.7 ms**, idle CPU **2.6%**, fps
floor **10.0 fps** — all far worse than this doc's 2026-07-23 WSL2-host
baseline (47.2 ms / 4.8% / 59.5 fps) for the *identical* code, meaning this
particular sandbox is roughly 4-5x noisier than the host that produced the
existing baseline (heavier virtualization contention, not a code
regression). Repeated post-fix runs in the same sandbox landed in the same
noisy band (keystroke p95 228-254 ms, idle CPU 2.4-3.0%) — no clean signal
either direction at the full-harness level, because CDP `RunTask` timing and
`/proc` CPU sampling both capture total system noise, not just this code
path. The isolated microbenchmark above is the reliable evidence for the
keystroke fix; **re-running `xvfb-run -a npm run perf:ui-runtime` on a host
comparable to the original 2026-07-23 measurement (or a dedicated CI runner,
not a shared dev sandbox) is required to record a trustworthy new §4
baseline** and confirm whether idle CPU needs further work beyond the
heartbeat fix above (e.g. profiling the `backdrop-filter` stack noted as
unaddressed per §2, or the other 30s IPC pollers in `DesktopShell.tsx`,
`AgentHubPanel.tsx`, `CoachPage.tsx`, `useArchiveScheduler.ts` — none showed
as continuously-running loops in this pass's code review, so they remain
plausible but unconfirmed contributors). Tracked as a follow-up
re-measurement task; not blocking merge of the code fixes themselves.

### SKY-8566 — idle-CPU driver root-caused and fixed: the ambient/border loops never actually stop

**Root cause.** SKY-8224 flagged the `backdrop-filter` stack and the 30s IPC
pollers as the two unconfirmed suspects and found the pollers innocent (each
is correctly `setInterval`-gated, not a tight loop). The actual driver is
`backdrop-filter`, but not through the pollers or through `prefers-reduced-
motion` failing to apply as *design* intent — it fails to apply as a
*mechanism*: launching the packaged app with Electron's
`--force-prefers-reduced-motion` (the flag `e2e/perf/ui-runtime/launch.ts`
uses for every metric except §4 target 3) does **not** flip the
`(prefers-reduced-motion: reduce)` media query in this Electron/Chromium
build. Confirmed directly against the packaged app:
`page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)`
returns `false`, and `document.getAnimations()` at the start of the
SKY-8217 idle-CPU window shows `.ln-bg-wallpaper` (`lnDrift`, 70s),
`.ln-bg-ambience` (`lnRiseT`, 46s/70s), and `.ln-border-overlay`
(`lnBreathe`, 4.6s) all `playState: 'running'` at full, un-reduced duration.

This means every SKY-8217 idle-CPU measurement to date (including the
2026-07-23 baseline) was taken with these "ambient, always-on" loops fully
live, not reduced to a no-op as `liquidNeon.css`'s
`@media (prefers-reduced-motion: reduce)` block assumes. A CDP `Profiler`
capture of the renderer's V8 main thread during the 5s idle window showed
**99.7% idle JS** (no hot userland function) — ruling out a JS-level cause —
while a CDP `Tracing` capture of the same window showed the compositor
producing a full frame every ~16ms indefinitely (`cc::AnimationHost::
TickAnimations` / `viz::DisplayScheduler::BeginFrame` at a steady ~60/s,
`viz::SoftwareRenderer::DoDrawQuad` ~6,500/s under this sandbox's software
rendering). That is exactly `plans/design-handoff/v2/PERFORMANCE.md` §2's
"backdrop-filter is a per-frame tax": `.tiptap-content`'s live
`backdrop-filter: blur()` (the one persistent surface, by design — see
`BlockEditor.css`) sits above the wallpaper/ambience layers, so as long as
those layers keep animating underneath it, the compositor must re-resolve
the blur every frame, forever — independent of the 30s IPC pollers.

A second, smaller gap: `.wtb-agents-dot` (`WorkspaceTabBar.css`, the
always-visible "agents idle/working" status dot) had **no**
`prefers-reduced-motion` handling and was not covered by the existing
hidden-window pause at all — it pulses (`lnPulse`, 3s) forever, including
while the window is minimized.

**Fix.** `plans/design-handoff/v2/PERFORMANCE.md` §3 already prescribes the
missing half: "every infinite animation must ... pause on blur/**idle** via
`document.hidden` + a global reduce-motion switch." Only the `document.hidden`
half was implemented (`BackgroundStack.tsx`'s `ln-anim-paused` class, audit
P4). `BackgroundStack.tsx` now also arms a 5s no-activity timer
(`pointerdown`/`pointermove`/`keydown`/`wheel`) and folds it into the same
`ln-anim-paused` class — reusing the existing CSS rule and the "5s of no
recent input" recency window `useWritingScheduler` (SKY-8224) and
`useArchiveScheduler`'s `SAVE_DEBOUNCE_MS` already established elsewhere in
this codebase. This does not touch the OS-level reduced-motion path (still
broken as a mechanism, tracked separately below) or change the ambient
animation's visible behavior while the user is actually present — it only
stops the compositor tick once there is genuinely no input, which is when
the idle-CPU target is measured. `WorkspaceTabBar.css`'s `.wtb-agents-dot`
gets both the missing `@media (prefers-reduced-motion: reduce)` block and a
hook into the same `ln-anim-paused` class.

**Evidence — isolated, controlled A/B, not the full noisy harness** (same
sandbox as SKY-8224's inconclusive re-measurement attempt, so absolute
numbers aren't comparable to the 2026-07-23 baseline host, but the
before/after comparison is on identical hardware/process in the same run):
a throwaway script launched the packaged build exactly like
`e2e/perf/ui-runtime/idleCpu.ts` does, opened the seeded scene, then sampled
`/proc/<rendererPid>/stat` over two consecutive 5s windows — window A
starting 1s after scene-open (matches the harness's own timing, animations
still live because of the `--force-prefers-reduced-motion` gap above),
window B starting ~4s later (idle-pause engaged). Three runs:

| Run | Window A (pre-idle-pause) | Window B (idle-pause engaged) |
|---|---:|---:|
| 1 | 4.80% | 5.20% (pre-fix code — no reduction, confirms the loops don't stop on their own) |
| 2 | 4.00% | 0.20% |
| 3 | 3.60% | 0.20% |
| 4 (fix-branch rebuild) | 3.80% | 0.40% |

Run 1 is the pre-fix code (verified via `git stash` on the same build/
environment) — window B stays flat or drifts up, confirming the ambient
loops do not self-quiet without this fix. Runs 2–4 are post-fix: renderer
idle CPU drops roughly 10–20x once the idle-pause engages, landing at
0.2–0.4%, comfortably under the harness's `≤ 1%` pass bar and trending to
the ~0% target. A companion CDP `Tracing` capture of window B (post-fix)
shows `SoftwareRenderer::DoDrawQuad` drop from 32,691 to 580 events and
`AnimationHost::TickAnimations` drop from 276 to 40 over the same 5s window.

**Not fixed here, tracked separately:** the `--force-prefers-reduced-motion`
mechanism itself not flipping `matchMedia` in this Electron/Chromium build.
That's an OS-integration gap (affects real users who set the OS-level
reduced-motion preference, not just this harness) worth its own scoped
investigation; the idle-pause fix above closes the actual idle-CPU driver
regardless of whether that flag ever gets fixed, so it isn't a blocker here.

## Acceptance targets (unchanged from the fix-order plan)

- Keystroke → paint under 16 ms with all panels open.
- Idle CPU ~0%, GPU steady, no repaints while nothing moves.
- All ambient animation at 60fps, or off under `prefers-reduced-motion` / the
  in-app toggle.
- Typing with Writing Assistant + watcher live: no dropped frames.

§4 above is the now-automated harness for these 4 targets (SKY-8217). The
cold-start, editor-open, and data-layer numbers in §1–§3 are the
previously-automated subset restored by SKY-7936.

## Wave-boundary log

| Wave | Date | Cold start (empty / large) | Data bench status | UI-runtime (keystroke / idle CPU / fps floor / stream-drop) | Notes |
|---|---|---|---|---|---|
| Restoration (SKY-7936) | 2026-07-22 | 106 ms / 278 ms | 4 regressions vs. stale baseline, baseline refreshed | not yet automated | First entry; establishes the format for future waves |
| UI-runtime harness (SKY-8217) | 2026-07-23 | — | — | 47.2 ms / 4.8% / 59.5 fps / 0.0 pp | Harness added; 2 of 4 targets miss (keystroke, idle CPU) — follow-up filed, not blocking |
| Perf fixes (SKY-8224) | 2026-07-28 | — | — | not re-baselined (see write-up above) | AutoLinker decoration rebuild scoped to changed textblock (377x isolated-bench speedup); writing-assistant heartbeat now skips ticks while typing. Full-harness re-measure blocked on a low-noise host — this execution's sandbox is ~4-5x noisier than the 2026-07-23 baseline host even for unmodified code |
| Idle-CPU root cause (SKY-8566) | 2026-07-28 | — | — | not re-baselined on the full harness (see write-up above); isolated A/B: renderer idle CPU 3.6–4.8% → 0.2–0.4% | Root cause: `--force-prefers-reduced-motion` doesn't flip `matchMedia` in this build, so the ambient wallpaper/ambience/border-breathe loops (and the ungated `.wtb-agents-dot` pulse) never actually stop, forcing `.tiptap-content`'s live `backdrop-filter` to re-resolve every frame forever. Fix: idle-timeout (5s no pointer/keyboard/wheel activity) folded into the existing `ln-anim-paused` hidden-window pause class |
