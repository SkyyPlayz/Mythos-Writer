# Prototype of record — Liquid Neon (2026-07-30 export)

This is the ONLY prototype. It is interactive — render it and click it; do not spec from screenshots or memory.

- `Mythos Writer - Liquid Neon.dc.html` — 859,135 bytes. Contains the dual-diamond margin ruler AND the AI master toggle (manual mode).
- `support.js` — the dc-runtime that evaluates the sc-if/sc-for bindings. The HTML is dead without it.
- `react*.min.js`, `babel.min.js` — pinned copies of the runtime's CDN deps. `support.js` loads these vendored files first and falls back to unpkg only if the local load fails (SKY-9257), so the prototype renders fully offline. Verify with `npm run fidelity:verify-offline`.

## To render

    cd "$(dirname "$0")" && python3 -m http.server 8899
    # open http://127.0.0.1:8899/Mythos%20Writer%20-%20Liquid%20Neon.dc.html

Headless: `npm run fidelity:proto` (self-serves this directory, captures every surface). Driver scripts live at `e2e/fidelity/`; wait ~3.5s after networkidle for the React mount.

Theme note: the prototype has 10 color sets (`colorSet` prop, default `winter`). Palette differences are NEVER findings. See `plans/fidelity-rebuild/PLAN.md` §0.
