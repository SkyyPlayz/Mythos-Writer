# Paste this into the "Mythos Writer" Claude Code chat

---

I'm handing off the approved Liquid Neon redesign. The handoff package is in `design-handoff/` in the repo (README.md, PROCESS.md, DESIGN-SPEC.md, and `prototype/` containing the approved interactive prototype — it's the single source of truth for every visual and interaction).

Read `design-handoff/README.md` and `design-handoff/PROCESS.md` first, then:

1. **Plan first:** write `docs/releases/BETA-LIQUID-NEON.md` — make this design the next beta release goal, clearly written out and explained, with a detailed 100% end-to-end plan (milestones in dependency order, mapped to concrete repo files and to the spec/prototype sections, acceptance criteria each). Open it as the first PR.
2. **Then build:** build first, build everything you can, one PR per milestone. Don't worry about CI tests or merging — only merge when a PR must be merged for later work to continue.
3. **The rest of my team is out** — I'm the only one who can merge. Ping me directly in this chat whenever you're blocked waiting on a merge or need a decision.

Port exact values (hex, px, radii, shadows, animations) from the prototype source rather than approximating. Where the current app conflicts with the prototype, the prototype wins.
