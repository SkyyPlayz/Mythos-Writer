# Prototype of record — Liquid Neon v2.5 (2026-09-28 handoff)

This is the ONLY prototype. It is interactive — render it and click it; do not spec from screenshots or memory.

- `Mythos Writer design.dc.html` — **of-record** file from the 2026-09-28 Liquid Neon v2.5 handoff (~1.4 MB).
- `Mythos Writer - Liquid Neon.dc.html` — identical copy kept under the legacy harness filename so `fidelity:*` / freshness scripts keep working this tip.
- `support.js` — dc-runtime (SKY-9257: prefers vendored `react` / `react-dom` / `babel.min.js`, falls back to unpkg).
- `react*.min.js`, `babel.min.js` — pinned CDN mirrors for offline fidelity.
- `assets/` — slim mirror (logo, cosmic-bg.webp, thumbs). Wallpaper PNGs (`bg-*.png`, `assets/wp`) remain Desktop-only until a theme surface hard-requires them.

## To render

    cd "$(dirname "$0")" && python3 -m http.server 8899
    # open http://127.0.0.1:8899/Mythos%20Writer%20design.dc.html
    # or the legacy: .../Mythos%20Writer%20-%20Liquid%20Neon.dc.html

Headless: `npm run fidelity:proto` (self-serves this directory). Wait ~3.5s after networkidle for the React mount. Verify offline: `npm run fidelity:verify-offline`.

When prose and this prototype disagree, **the prototype wins**.
