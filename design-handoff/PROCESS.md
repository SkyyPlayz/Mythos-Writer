# Working process (Skyy's instructions — follow exactly)

## Phase 0 — Write the plan into the repo (do this FIRST)

1. Create `docs/releases/BETA-LIQUID-NEON.md` in the repo:
   - **Release goal**, clearly written for the whole team: the app becomes the Liquid Neon design — a macOS-liquid-glass feel on Windows, neon-bordered glass panels over a user-changeable background, four built-in agents, heading-zoom manuscript, canvas boards, Aeon-class timeline, Obsidian-parity notes.
   - A **detailed 100% end-to-end plan**: every milestone from current `main` to the finished beta, in dependency order, each milestone mapped to the concrete files/components in the repo it touches (`frontend/src/tokens.css`, `DesktopShell.*`, panel components, etc.) and to the matching section of `DESIGN-SPEC.md` / the prototype source.
   - Milestone list should roughly follow the build order in Phase 1 below.
   - Include acceptance criteria per milestone ("panel borders driven by `--bw`/`--gr` vars", "arrow keys hop scenes", …).
2. Open this as the **first PR** and ping Skyy that the plan is ready to review — then continue building without waiting.

## Phase 1 — Build (build first, build everything you can)

Suggested dependency order (refine it in the plan doc):

1. **Theme engine** — tokens, 6 color slots, CSS custom properties, presets + per-theme animated backgrounds, frame ring, settings Appearance page. Everything else depends on this.
2. **Shell** — title bar (menus, command palette, notifications, account), workspace tabs (drag/reorder/context menu), nav rail (customize/slim/vaults/stories), resizable panels, status bar.
3. **Story Writer** — heading-zoom manuscript, toolbar, page modes, comments, drafts/diff, reader (TTS), dictation stub, navigator, Structure + Book views.
4. **Notes Editor** — vaults, tree (drag + context menu), templates, wiki links, tags, properties/backlinks, agent-first right panel, splits.
5. **Scene Crafter** — setup, suggested cards, canvas boards (drag/resize/connect/pan/zoom), Scenes sidebar mini canvas.
6. **Brainstorm / Timeline / Graph** — board+map+clusters, all five timeline views incl. Subway and Plan-vs-Progress, star-node graph.
7. **Agents & data plumbing** — 4 agents, identity files, autonomy, continuity flags → comments, auto-link + timeline build.
8. **Settings remainder + import/export + onboarding.**

## Rules of engagement

- **PRs:** one per milestone (or smaller). Clear titles, link the plan doc section, screenshots/GIFs vs the prototype.
- **CI:** do NOT block on CI tests. Fix nothing CI-related unless it blocks a build.
- **Merging:** do not merge yourself unless a later milestone literally cannot proceed without it. When that happens (or a PR needs human review to unblock), **stop and ping Skyy directly in the chat** — the rest of the team is out; Skyy is the only merger.
- **Fidelity:** the prototype is the spec. When the repo's existing behavior conflicts with the prototype, the prototype wins. Reuse repo components where they exist; port exact values (hex, px, radii, shadows) from the prototype source rather than approximating.
- **Preserve:** don't revert or "clean up" unrelated existing repo code.
