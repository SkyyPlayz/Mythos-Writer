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
