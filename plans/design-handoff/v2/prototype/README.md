# Prototype of record — Liquid Neon (2026-07-30 export)

This is the ONLY prototype. It is interactive — render it and click it; do not spec from screenshots or memory.

- `Mythos Writer - Liquid Neon.dc.html` — 859,135 bytes. Contains the dual-diamond margin ruler AND the AI master toggle (manual mode).
- `support.js` — the dc-runtime that evaluates the sc-if/sc-for bindings. The HTML is dead without it.
- `react*.min.js`, `babel.min.js` — pinned copies of the runtime's CDN deps (P0.1 team task: patch support.js to load these locally).

## To render

    cd "$(dirname "$0")" && python3 -m http.server 8899
    # open http://127.0.0.1:8899/Mythos%20Writer%20-%20Liquid%20Neon.dc.html

Headless: Playwright chromium (`/usr/bin/google-chrome` on the host), wait ~3.5s after networkidle for the React mount. Working driver scripts: `plans/fidelity-rebuild/harness/`.

Theme note: the prototype has 10 color sets (`colorSet` prop, default `winter`). Palette differences are NEVER findings. See `plans/fidelity-rebuild/PLAN.md` §0.
