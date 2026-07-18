# Scene Crafter Canvas — UX Spec (M19)

**Issue:** SKY-7250 · **Owner:** UXDesigner · **Status:** Design-ahead spec, cross-checked against PR #973
**Source of truth:** `plans/design-handoff/v2/prototype/Mythos Writer - Liquid Neon.dc.html`
(`isCrafter` region, template lines 328–344 + 1279–1441; state/behavior lines 4408, 6938–6997)
**Plan references:** `docs/releases/BETA-REFINE.md` §M19, `plans/design-handoff/v2/FULL-SPEC.md` §7.1,
`plans/design-handoff/v2/DESIGN-SPEC.md` §1/§4, `plans/design-handoff/v2/GAP-REPORT-v2.md` #12

## Note on timing

This was supposed to land before coding started (design-ahead). A session failure delayed it, and
FoundingEngineer opened **PR #973** implementing M19 in the meantime. Rather than write a spec that
ignores reality, this doc is grounded in the prototype (still the design authority per `CLAUDE.md`)
and cross-checked line-by-line against the actual PR #973 diff. Section 8 is the delta: what already
matches, and the three concrete gaps I'm posting to the PR. Treat this doc as canon for any follow-up
work on this surface and for M20 (Brainstorm board, PR #958), which reuses the same `canvas/CanvasBoard.tsx`
engine.

## Named constraint — dyslexia-friendly (owner is dyslexic, SKY-3941)

Adjustable-not-forced. Applies to every surface below:
- Card titles: one line, ellipsis-truncated, never wrapped mid-word.
- Card body copy: ≤4 lines clamped (`-webkit-line-clamp`), 1.5–1.8 line-height, sentence case.
- Labels before detail: section headers (SCENE TITLE, BEATS, TONE, LENGTH) always precede their
  control, never inline-mixed.
- Short labels: "Add to scene board" not "Submit this draft to the board for later manuscript use."
- High contrast: card body text `#9cabc4`/`#c8d3e7` on `rgba(13,17,30,.92)` — passes WCAG AA at these
  sizes; don't let per-theme customization push a slot color below AA against that near-black card fill.
- Respect reduced motion (see §5).

## 1. Board layout

### 1.1 Two-state model
The Scene Crafter module has two views under `isCrafter`, not one:

1. **Scene Crafter (closed)** — `data-screen-label="Scene Crafter"`. A planning workspace: Scene Setup
   column (title/POV/goal/conflict/beats/tone/length + BOARDS list) + Scene Draft column (quick
   summary, plan cards from vault, Generate button, draft-card states) + inline vault-reference columns
   (Characters/Locations/Items & Systems) to their right. This is the form/generation surface.
2. **Canvas Board (open)** — `data-screen-label="Canvas Board"`, entered by clicking a board under
   BOARDS or the editor's "Open full →". A dedicated pan/zoom canvas, back button returns to (1).

Never merge these into one screen — the setup form needs full-width fields; the canvas needs full-bleed
space. The prototype's separation is correct and PR #973 preserves it (`SceneCrafterPage.tsx` +
`canvas/CanvasBoard.tsx`).

### 1.2 Canvas
- World size: **2200×1500px** fixed, independent of viewport — cards are absolutely positioned within it.
- Surface: dotted grid, 22px pitch, `radial-gradient(rgba(158,178,214,.14) 1px, transparent 1.3px)`, over
  a soft radial vignette wash. 14px corner radius on the viewport container, 1px border
  `rgba(255,255,255,.06)`.
- **Pan:** drag empty canvas space (cursor `grab`→`grabbing`).
- **Zoom:** scroll wheel, ×1.1 per notch in / ×0.92 out, clamped **40–240%** (0.4–2.4). Dock buttons
  (−/+) step ×1.15/0.87 within the same clamp. **Fit** resets zoom to 100% and pan to origin — it is
  not a bounding-box fit-to-content in the current implementation; name it "Reset view" in a future pass
  if that's confusing, but don't change behavior without an engineering ticket (out of scope here).
- **Connections:** cubic bezier between card-center anchors, `stroke:rgba(158,190,230,.45)` width 2,
  soft drop-shadow glow. Drawn in an SVG layer behind cards, sized to the full 2200×1500 world so
  connections never clip at the viewport edge.
- **Dock:** floating pill, bottom-center, `rgba(15,19,33,.94)` bg, 1px purple (`--b2`) border, glass
  blur. Contains: Add card, divider, zoom out, zoom %, zoom in, Fit. 27×27 / 24×24px hit targets.

### 1.3 Empty / loading / error states

| State | Where | Current copy | Verdict |
|---|---|---|---|
| No boards yet (Scene Crafter) | Scene Setup → BOARDS section | `Draft board builds a canvas here — click it to open, drag cards, draw connectors.` | OK — plain caption text under a clearly-labeled section is fine here; it's a hint, not a dead-end. |
| No boards yet (editor Scenes tab) | `ScenesPanel.tsx` | `No scene boards yet.` / `Draft one in Scene Crafter — it'll show up here.` | **Gap** — plain text, no glyph. This is the exact pattern GAP-REPORT-v2 #12 named ("Scene Crafter drop zone... prototype pairs a glyph + one-line hint + a primary action button"). Fix in §8. |
| Loading (editor Scenes tab) | `ScenesPanel.tsx` | `Loading scene board…` (`role="status"`) | OK — has the ARIA live role; needs a lightweight skeleton (match `.sc-skel` pattern) instead of bare text once this panel gets real load latency, but not a blocker. |
| No story selected | `ScenesPanel.tsx` | `Select a story to see its scene board.` | OK for a panel this small. |
| Draft generation error | Scene Draft column | Inline `role="alert"` banner + Retry/Discard | Good — see §4. |
| Empty canvas (board created, zero cards) | Canvas Board | *(none specified — falls through to blank dotted grid)* | **New spec**: add a centered ghost hint, `Drag a suggested card here, or click + to add one.`, dismissed once the first card lands. Small addition, cheap, closes the "blank void" moment Nielsen's heuristics flag for any first-run canvas. |

## 2. Card anatomy

**Canvas card** (draggable, absolutely positioned, `w:190/min-h:80` default, corner-resizable, min 130×60):
- Header row (drag handle, `cursor:grab`): avatar chip (20×20, rounded 6px, filled with the card's
  slot color, initials) → click opens the attached vault note if `nid` is set, else toasts
  "No note attached yet"; title (11px/600, single line, ellipsis); connect button (⚯, 18×18); delete
  button (×, 18×18, hover → red `rgba(255,80,110,.35)`).
- Body: description/excerpt, 10px, `#9cabc4`, line-height 1.55, no clamp needed at default card height
  (content overflow is hidden, not scrolled — a card that's too full should be resized by the writer,
  not silently truncated with no indicator; if this becomes a real complaint, add a corner "expand"
  affordance rather than clamping silently).
- Border + glow: 1px border + soft box-shadow in the card's slot color (`--cvb-border`/`--cvb-glow`),
  intensity bumps when linking mode targets this card.
- Resize handle: 13×13px bottom-right corner, `nwse-resize`, two-sided border glyph.

**Suggested card** (left panel, `SUGGESTED CARDS`, grouped by vault category, searchable):
- Row: 26×26 avatar chip + title (11.5px/600) + one-line description (9.5px, ellipsis).
- `cursor:grab`; click OR drag onto the canvas both place it. Hover = purple border glow.
- Grouped under category headers (uppercase, 9px, letter-spaced) sourced live from the vault
  (Characters/Locations/Items & Systems today — extensible to any vault folder).

**Vault-reference card** (inline columns beside Scene Draft, same visual family as suggested cards, plus
a "remove from board" × in the top-right corner of the avatar swatch).

**Draft card** (Scene Draft column — the AI first-pass output):
- Header: ✎ avatar + `<Scene title> — first pass`.
- Body: full generated text (this is a planning-scaffold artifact, not a manuscript excerpt — the
  copy already frames it that way, keep that framing anywhere this card is echoed, e.g. a future
  notification).
- Meta: live word count.
- Actions, in this order, gradient-primary first: **Add to scene board** / Retry / Discard.
  - *Add to scene board* is the only path off this card that persists it — it creates a **new canvas
    board** with this text as a card (never edits the manuscript; ruling B4-9). Tooltip should state
    this every time, not just on first use — a writer who hasn't touched Crafter in weeks won't
    remember, and the cost of the reminder is one line of muted text.
  - *Retry* discards the current stream and starts a new generation with the same setup.
  - *Discard* cancels/dismisses without creating anything. **PR #973 already adds this as a third
    button** (the prototype only shows two — Add to board / Retry). Keep it; it's a straightforward
    forgiveness-heuristic improvement over the prototype and costs nothing.

## 3. Right kanban (beats / cast / places)

Inline aside beside the canvas-adjacent Scene Draft column (not a separate app-level right panel —
distinct from the editor's "Scenes" tab, which is a different, read-only mini-canvas surface, §6).
Three columns, each a vertical card stack:
- **BEATS** — mirrors the Scene Setup beat list live.
- **CAST** — vault Characters notes; click opens the note.
- **PLACES** — vault Locations notes; click opens the note.
Empty-column copy should say what's missing and where to fix it (`No Characters notes in your vault
yet.`) rather than just "Empty" — this is already how PR #973 wrote it; keep that pattern for any new
column added later.

## 4. Interaction spec

### 4.1 Create
- **Canvas:** dock `+` button adds a card at a fixed offset from current pan/zoom origin, default
  text "New card" / prompt to edit. Suggested-card drag-drop places at drop coordinates.
- **Setup form:** `Add` button or Enter in the beat input appends a beat chip.

### 4.2 Move
- Card header drag, zoom-scaled delta (drag distance ÷ current zoom, so movement tracks the cursor
  1:1 regardless of zoom level).
- Beats in Scene Setup: **drag-and-drop reorder** (native HTML5 DnD) **plus** ↑/↓ icon buttons per row
  — PR #973 added the buttons specifically so beat reordering has a non-drag path. Good; this is the
  kind of parallel-path design this spec asks for everywhere motion-based interaction exists.

### 4.3 Connect
- Click the ⚯ button on a card → enters linking mode (header banner: "Connecting — click a target
  card…", pulsing cyan). Click a second card completes the link. No explicit cancel affordance is
  specified in the prototype — **add Escape-to-cancel** (§4.4) since there's currently no way out of
  linking mode except completing it or reloading.

### 4.4 Delete
- × button per card, immediate (no confirm dialog) — acceptable for a low-stakes planning artifact,
  but pair it with a "Card deleted" toast + Undo per the Forgiveness heuristic, matching how the app
  already handles "Empty scene discarded" elsewhere. Deleting a card also removes its connections.

### 4.5 Keyboard paths — **not yet implemented, spec proposal**

Verified against the shipped code: `canvas/CanvasBoard.tsx` has no `tabIndex`, `onKeyDown`, or `role`
on any card — the canvas is currently mouse-only end to end (create/move/connect/delete all require a
pointer). This is a real gap against this issue's own DoD line ("keyboard paths") and against WCAG
2.1.1 (keyboard operable), and it isn't unique to Scene Crafter — `canvas/CanvasBoard.tsx` is shared
with the M20 Brainstorm board (PR #958), so fixing it here fixes both surfaces.

Proposed model (component-agnostic, applies to any board built on this engine):
1. `Tab` into the canvas focuses the first card in DOM order; `Tab`/`Shift+Tab` cycle cards.
   Focused card gets `var(--focus-ring)` outline (not `--color-accent}` — per the existing
   accessibility lesson already logged for this codebase).
2. Arrow keys nudge the focused card 8px per press, `Shift+Arrow` = 40px — mirrors the mouse-drag
   granularity without requiring pixel-perfect pointer control.
3. `Enter`/`Space` on a focused card with the connect action reachable via Tab starts linking mode
   (same visual state as the mouse path); `Enter` on a second focused card completes the link.
4. `Escape` cancels linking mode at any point (also fixes the missing mouse-path cancel from §4.3).
5. `Delete`/`Backspace` on a focused card deletes it (same undo-toast as §4.4).
6. Each card needs `role="group"` + `aria-label` combining title and category so a screen reader user
   gets equivalent information to the visual avatar+title.

This is scoped as its own follow-up (see §8) — it's a shared-engine change, not a one-file fix, and
shouldn't block PR #973's merge.

### 4.6 Reduced motion
- The busy-state skeleton pulse (`sc-pulse`, `SceneCrafterPage.css`) is a 1.1s infinite animation with
  **no `prefers-reduced-motion` override** — every sibling CSS file in this codebase (including
  `canvas/CanvasBoard.css`, which this same PR touches) has one; this file is the exception. Concrete
  fix in §8.
- Canvas pan/zoom itself is user-driven (not an ambient loop) so it isn't subject to this — only the
  `lnPulse`-style looping animations (busy skeletons, the "Connecting…" pulse text) need the guard.

## 5. Liquid Neon theming — the 6 slots

| Slot | Role (design system) | Default hex | Used on this surface for |
|---|---|---|---|
| A (`n1`) | left panel / primary accent | `#00f0ff` | Input focus borders, suggested-card active states, primary CTA text-on-gradient context |
| B (`n2`) | center panel / wiki-links | `#9b5fff` | Draft preview panel border/glow, CANVAS badge, "Connecting…" busy accents |
| C (`n3`) | right panel / agents | `#ff4dff` | Card slot 3 (reserved for an agent-attributed or third vault category) |
| D (`n4`) | warm data (ideas & items) | `#ff9a3d` | Card slot 4 — default color for a freshly-added blank card, and "Items & Systems" vault column |
| E (`n5`) | cool data (systems) | `#2fe6c8` | Card slot 5 |
| F (`n6`) | nav rail / timeline / frame | `#3d9bff` | **Not used for cards** — reserved for chrome, correctly excluded from the 5-color card palette (`[c1,c2,c3,c4,c5]`) |

Card-to-slot mapping is **by vault category**, not fixed 1:1 with panel regions — a Characters card and
a Locations card both live on the same canvas (center/B context) but carry different slot colors (A and
B respectively in the sample data) to visually group by entity type. This matches Gestalt similarity/
common-region: same-type cards read as a group at a glance without needing a legend. Keep this
per-category (not per-panel) assignment if new categories are added later — don't reuse slot F (chrome)
for a 6th category; if a 6th type is needed, differentiate by icon/glyph within an existing slot color
rather than breaking the chrome/content color separation.

All glass/blur/glow values (`--glass2`, `--gr`, `--bw`) inherit the user's global intensity/glass/blur
Appearance settings — nothing on this surface should hardcode an opacity or blur radius that bypasses
those sliders.

## 6. Relationship to the editor's "Scenes" tab

`ScenesPanel.tsx` (right sidebar, `Scenes` panel id) is a **separate, read-only** surface: a shrunk
`CanvasBoard` in `readOnly` mode (pan/zoom live, no drag/resize/connect/delete/add) showing the story's
most recent board, plus "Open full →" into the real Scene Crafter. Correct scope — don't add mutation
affordances here; if a writer wants to edit, "Open full" is one click away and the full canvas is a
better editing context (more space, dock, suggested cards). The current "latest board = the scene's
board" approximation (noted in the component's own comment) is a known data-model limitation, not a
UX defect — flag it back to product if per-scene board scoping becomes a real request.

## 7. Component inventory (for engineering handoff)

| Component | File | Status |
|---|---|---|
| `SceneCrafterPage` | `frontend/src/pages/SceneCrafter/SceneCrafterPage.tsx` | Implemented, PR #973 |
| `crafterState` (setup, draft prompt, card composition helpers) | `frontend/src/pages/SceneCrafter/crafterState.ts` | Implemented, PR #973 |
| `CanvasBoard` (shared engine, `readOnly` prop) | `frontend/src/canvas/CanvasBoard.tsx` | Implemented M18 (#864), extended PR #973 |
| `ScenesPanel` (editor right-panel mini canvas) | `frontend/src/ScenesPanel.tsx` | Implemented, PR #973 |
| Keyboard interaction layer (§4.5) | `frontend/src/canvas/CanvasBoard.tsx` | **Not implemented — spec only, follow-up issue** |
| Canvas empty-state ghost hint (§1.3) | `frontend/src/canvas/CanvasBoard.tsx` | **Not implemented — small follow-up** |

## 8. Cross-check against PR #973 — disposition

Confirmed matching prototype + this spec (no action needed): two-view model, canvas world size/zoom
range/pan behavior, card anatomy, dock, right kanban, draft generation flow including the added
Discard button, POV-from-cast dropdown with Custom escape hatch, keyboard-accessible beat reordering
(↑/↓ buttons alongside drag), draft error state with Retry/Discard.

Three concrete findings posted to PR #973 as review comments:
1. **`ScenesPanel.tsx` empty states have no glyph** — reproduces the exact anti-pattern GAP-REPORT-v2
   #12 already named for this surface. Small CSS/markup fix.
2. **`SceneCrafterPage.css`'s `sc-pulse` animation has no `prefers-reduced-motion` override** — every
   sibling stylesheet in the codebase has one; this is the one exception. One-block fix.
3. **Canvas cards have no keyboard path** (create is keyboard-reachable via the dock button, but
   move/connect/delete are pointer-only) — real WCAG gap, but shared-engine scope (also affects M20).
   Scoped as a follow-up issue, not a blocker for this PR.

Findings 1–2 are small enough to land in PR #973 directly before merge. Finding 3 is filed as a
follow-up child issue (canvas keyboard accessibility) since it touches shared engine code used by two
in-flight milestones.
