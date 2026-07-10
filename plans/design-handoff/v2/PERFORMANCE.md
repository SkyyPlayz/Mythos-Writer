# PERFORMANCE.md — Why the beta is slow, and the fix order

**For:** Claude Code · Mythos-Writer repo · companion to GAP-REPORT-v2.md
**Symptom report (Skyy, powerful PC):** frame skips everywhere, input latency up to ~1 minute, Liquid Neon animations unusable.

The Liquid Neon look is heavy in exactly the ways Chromium punishes. None of this needs a redesign — it needs the effects moved onto the GPU and the render loop taken off the typing path. Work top to bottom; measure after each.

## 0. Profile before touching anything
- Open DevTools → Performance in the packaged app, record 10s of typing + 10s idle. Three numbers matter: main-thread time per keystroke, paint area per frame, and how much runs while the app is IDLE (should be ~0).
- React DevTools Profiler: count components re-rendering per keystroke. If the whole shell re-renders on every character, that alone explains the latency.
- `chrome://gpu` inside Electron: confirm hardware acceleration is ON.

## 1. Window transparency (likely the #1 killer)
If the BrowserWindow is `transparent: true` / frameless-with-alpha to get the glass look: stop. Transparent windows disable or cripple GPU compositing on Windows and cause exactly this full-window jank.
**Fix:** opaque window; render the wallpaper INSIDE the app (it already does — `--wp` layer). Nothing about the look changes.

## 2. backdrop-filter is a per-frame tax
Every panel with `backdrop-filter: blur() saturate()` re-blurs everything behind it on every frame it or anything under it changes. The shell stacks many of them (title bar, rail, panels, popovers, tabs).
**Fix:**
- At most ONE backdrop-filter surface on screen (e.g. popovers only).
- Panels: fake the glass — semi-opaque `--glass` fill over a **pre-blurred copy of the wallpaper** (blur it once at load, in a canvas or offline asset), not live backdrop blur.
- Kill `backdrop-filter` entirely during typing / scrolling (add a `.perf-typing` class toggle from the editor).

## 3. Animations must be transform/opacity only
Current offenders (from the prototype spec the app copied):
- `lnDrift` animates `background-position` on a cover-size wallpaper → full-screen repaint every frame. → Animate `transform: translate` on an oversized wallpaper layer instead (composited, free), or make it static.
- Breathing borders animate `box-shadow`/`border-color` on many panels simultaneously → paint storm. → Pre-render the glow as a blurred pseudo-element and animate its **opacity** only; stagger or drop to a couple of surfaces.
- Any conic-gradient ring / hue-rotate filter animation: remove (design has dropped the window frame ring) or render to a small canvas.
**Rules:** every infinite animation must (a) be transform/opacity, (b) pause on `blur`/idle via `document.hidden` + a global "reduce motion" switch, (c) respect `prefers-reduced-motion`.

## 4. Typing must not re-render the app
The minute-long latency smells like synchronous work per keystroke: whole-shell React re-render + whole-book word count + autosave + agent scans all firing on input.
**Fix:**
- The Tiptap editor owns its document; the app subscribes to it **debounced** (300–500ms) for counts/status. No `setState` on the app shell per keystroke.
- Memoize the shell: nav rail, sidebars, tab strip, status bar in separate memoized subtrees; editor updates must not touch them.
- Word/char counts: incremental (per-scene cache) — never re-walk the whole book on input.
- Autosave snapshots: debounced, serialized in a worker or the main process, never on the render thread. Never re-index / re-watch the vault on your own writes (echo suppression on the file watcher).
- Agent cadence ("heartbeat") runs on a timer, never on keystroke, and skips when the user typed in the last N seconds.

## 5. Big DOM = slow everything
- Virtualize: notes tree, story navigator, timeline spreadsheet, brainstorm feeds (the duplicated-folder seeding bug in GAP-REPORT #1 also multiplies DOM size).
- `content-visibility: auto` + `contain: layout paint` on offscreen panels, cards, and closed-tab content.
- Editor: only the visible scene mounted at Full Book zoom; neighbors lazy.

## 6. Electron hygiene
- One BrowserWindow; no hidden always-running renderer doing agent work — agents belong in the main process / a utility process, messaging deltas, not whole documents.
- Check for a runaway IPC loop (vault watcher → renderer → save → watcher…). The every-boot re-seeding bug suggests exactly this class of loop.
- Ship with `backgroundThrottling` left ON; disable dev source maps in production builds.

## Reference implementation — the prototype already does this

`prototype/Mythos Writer - Liquid Neon.dc.html` now demonstrates the GPU-clean patterns. Copy them, don't reinvent:
- **Wallpaper drift** (`lnDrift`): animates `transform: scale/translate` on the wallpaper layer — never `background-position`.
- **Ambient snow/embers** (`lnSnowT`/`lnRiseT`): oversized layers (`inset: -72vh 0`) with `will-change: transform`, animated via `transform: translate3d` only, inside an `overflow: hidden` clip.
- **Breathing panel glow**: the glow is a dedicated absolutely-positioned overlay whose **opacity** animates (`lnBreathe`/`lnPulse`) — the border/box-shadow itself is static.
- **Visibility pause**: `visibilitychange` toggles `body.ln-hidden`, and `body.ln-hidden * { animation-play-state: paused !important }` freezes every ambient animation when the window is hidden.
- **Reduced motion**: global `@media (prefers-reduced-motion: reduce)` kill-switch.
- **Typing path**: manuscript editing commits on blur/Enter — no app-shell state update per keystroke.

## Acceptance targets
- Keystroke → paint under 16ms with all panels open.
- Idle CPU ~0%, GPU steady, no repaints while nothing moves.
- All ambient animation at 60fps, or automatically off under `prefers-reduced-motion` / the in-app toggle.
- Typing with Writing Assistant + watcher live: no dropped frames.
