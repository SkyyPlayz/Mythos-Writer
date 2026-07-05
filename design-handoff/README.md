# Mythos Writer — Liquid Neon: Claude Code Handoff

**From:** Skyy's design session (approved prototype)
**To:** Claude Code chat "Mythos Writer" (linked to the Mythos-Writer repo)
**Date:** 2026-07-05

## What this package contains

- `prototype/Mythos Writer - Liquid Neon.dc.html` — the **approved interactive prototype**. This file is the single source of truth for look, feel, and behavior. It is an HTML file with an inline template + a `Component` logic class; every color, spacing, border, glow, and interaction pattern to replicate is in here. Open it in a browser (needs `support.js` + `assets/` beside it) or read the source directly.
- `prototype/support.js`, `prototype/assets/` — runtime + images the prototype needs (`logo.png` is the real app logo, `cosmic-bg.webp` is the Neon Classic wallpaper).
- `DESIGN-SPEC.md` — complete feature inventory extracted from the prototype, organized by module, with the token system and default values.
- `PROCESS.md` — the exact working process Skyy wants (read this first).
- `PROMPT.md` — the message Skyy pastes into the Claude Code chat to kick this off.

## The mission in one paragraph

Take this new Liquid Neon design and make it the **next beta release goal** of the Mythos-Writer repo: first write it up in the repo as a clearly explained release goal with a detailed, 100% end-to-end build plan; then build it. Build first, build everything you can, open PRs as you go. Do not worry about CI tests or merging — only merge when a PR must be merged for later work to continue, and **ping Skyy** whenever you are blocked waiting on a merge (the rest of the team is out).
