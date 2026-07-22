# Timeline View Modes — Plotlines & Tension Layout + Keyboard/A11y Spec (all 5 modes)

**Issue:** SKY-7770 (design-ahead for **SKY-6980**, M24: Timeline remaining modes)
**Designer:** UXDesigner
**Status:** Ready for build — land before FableEngineer starts M24 coding
**Authoritative sources:** `plans/design-handoff/v2/FULL-SPEC.md` §8.4–§8.5 wins on
any conflict with this doc. `docs/TIMELINE-VIEWS-DESIGN-SPEC.md` (SKY-7253) wins on
redlines/theming/states for the three modes it already covers (see Relationship to
SKY-7253 below).

## Relationship to the existing SKY-7253 design-ahead spec

`docs/TIMELINE-VIEWS-DESIGN-SPEC.md` already shipped (PR #982, merged) redlines,
6-slot theming, the flag-surfacing pattern, and the empty/loading/syncing/error state
model for **Progress, Structure, Spreadsheet, Relationships, Subway** — but it
explicitly punted **Plotlines and Tension** as "out of scope for this doc (tracked
separately)" (§0). SKY-6980's actual acceptance criteria require all 7 mode-seg slots
working, including those two. Separately, SKY-7770 (this ticket) asks specifically for
**keyboard nav** and **screen-reader/focus-order a11y** at G6-voice-panel depth
(SKY-3192) across Plotlines/Spreadsheet/Tension/Relationships/Subway — a layer SKY-7253
only touches lightly (mode-seg keyboard, a few color-independence notes).

So this doc does two things and doesn't repeat what SKY-7253 already settled:

1. **Full layout + interaction + states for Plotlines and Tension** — genuinely new,
   not in SKY-7253 or the prototype in interaction detail.
2. **Keyboard-nav + WCAG 2.5.7 (dragging alternative) + screen-reader labeling** for
   all 5 modes named in SKY-6980, including the three SKY-7253 already redlined
   visually. Where this doc references Spreadsheet/Relationships/Subway layout, defer
   to SKY-7253's exact grid-template-columns/colors/component names — don't re-derive
   them here.

Empty/loading/syncing/error states for Plotlines and Tension **reuse SKY-7253 §4's
four-state model verbatim** (Empty / Loading / Syncing / Error, header chrome always
interactive, error keeps last-synced canvas visible) — see §3 and §4 below for the
one piece of per-mode copy each needs.

**Scope guard (binding, from SKY-6980):** all 5 modes are **display-only** views of
`timelines.json` — the only in-mode data entry is Plotlines' card create/move.
Everything else routes to the Inspector tab (M25/SKY-6981). Don't add editing
affordances beyond what's listed here.

---

## 0. Shared conventions across all 5 modes (read once)

**Selection → Inspector** (FULL-SPEC §8.6, unchanged): clicking any item in any mode
opens the Inspector tab on that item. One consistent answer to "how do I edit this"
across all 7 modes (Occam's Razor, Tesler's Law) — don't add a second path per mode.

**Mode switch preserves selection** where the item exists in both modes (Zeigarnik:
don't make the user re-find what they had); falls back to no selection if the item has
no representation in the new mode (e.g. a Plotlines-only unwritten beat card has no
Tension-mode point).

**States:** reuse SKY-7253 §4's Empty/Loading/Syncing/Error model exactly — same
banner/strip treatment, same "canvas underneath stays interactive," same
`aria-live="polite"` on the syncing strip. Per-mode empty-state copy in §3/§4 below;
Spreadsheet/Relationships/Subway keep SKY-7253's existing copy unchanged.

**Color independence (WCAG 1.4.1, binding):** every color-only cue in these modes
(plotline dot color, character line color, presence dot, FLASHBACK badge) also carries
a redundant non-color cue — text label, shape, or line-dash pattern. This extends
SKY-7253 §3.4/§3.5's minimum-hue-separation requirement (which solves "can two sighted
users with different color vision tell two lines apart") with a second requirement:
grayscale/no-color legibility (which hue separation alone doesn't solve). Spelled out
per-mode below.

**Focus ring:** `--focus-ring` (`--neon-cyan`), 2px, `:focus-visible` only, on every
keyboard-focusable element added by this doc — the glass/blur panels reduce native
outline contrast, same reasoning SKY-7253 applies to its own interactive elements.

**Keyboard grid pattern (Plotlines, Spreadsheet, Relationships):** WAI-ARIA APG
"grid" pattern, roving `tabindex`, one Tab stop for the whole grid:
`→ ← ↑ ↓` move focus one cell (no wrap) · `Home`/`End` first/last cell in row ·
`Ctrl+Home`/`Ctrl+End` first/last cell in grid · `Enter`/`Space` activate (opens
Inspector, or in Plotlines enters move-mode, §1) · `Tab` leaves the grid. One pattern,
three modes — Jakob's Law: learn it once.

**Dragging Movements (WCAG 2.5.7, binding):** every pointer-drag interaction below has
a single-key keyboard equivalent doing the same operation without a drag gesture.
Specified per-mode (§1 Plotlines, §2 Tension). This is a hard AA requirement, not
optional polish.

**Reduced motion:** curve/line draw-in (Tension path) runs once on first entry,
≤200ms ease-out, skipped entirely when Reduce Motion is on — matches SKY-7253 §6's
reduce-glow/reduce-motion handling for the other three modes.

---

## 1. Plotlines (Plottr-style grid) — net-new

**Layout:** sticky left column (plotline dot + name + scene count) × 12 chapter
columns (or actual chapter count; `YOU ARE HERE` highlight on the current chapter,
same convention as FULL-SPEC §8.4's Chapters row). Cells hold 0–N scene cards:
written = solid left border in the row's color, template/unwritten beat = dashed
border (the existing written-vs-planned visual language from Progress mode — SKY-7253
§3.1 — reused here, not reinvented). Row height grows to fit its tallest cell (Gestalt:
Common Region — a plotline's cards read as one row regardless of height).
`min-width` scales with the shared zoom seg (FULL-SPEC §8.5).

**Interaction:**
- Drag a card between any cell, 3px threshold (matches axis drag convention, §8.3).
- `+` per cell (hover/focus-visible) adds a blank card; empty title on blur discards
  silently, toast `Empty card discarded — nothing was saved` (existing provisional-
  creation pattern, FULL-SPEC §1.5).
- Click a card (no drag) → Inspector (§0).

**Keyboard nav:** grid pattern (§0); focus lands on cards, or on an empty cell's `+`
child stop via `Enter`/`Space`.
**Keyboard move (WCAG 2.5.7 equivalent):** focus a card → `Enter` enters move mode
(dashed "lifted" outline + `aria-live` announcement `"Moving {title} — arrow keys to
choose a cell, Enter to drop, Escape to cancel"`) → arrow keys move a ghost target
cell-to-cell → `Enter` commits, `Esc` cancels and restores the card + focus to its
original cell.

**States:** follows SKY-7253 §4 exactly. Empty-state copy: `No plotlines yet` +
`Add a Plotline from the toolbar, or apply a template (Three-Act, Save the Cat, Hero's
Journey) to seed one` (points at the existing `+ Plotline`/`Templates ▾` toolbar
controls, §8.4 — doesn't duplicate that entry point inside the grid).

**A11y:**
- `role="grid"`/`row`/`gridcell`, `columnheader`/`rowheader` on the header row and
  sticky plotline column.
- Card `aria-label`: `"{title}, {written|planned}, {plotline name}, chapter {N}"` —
  status is legible without relying on the border-style cue (§0 color independence).
- `YOU ARE HERE` header cell: `aria-current="date"`, not visual-only.
- Cell `+` button: `aria-label="Add scene card to {plotline name}, chapter {N}"`
  (disambiguates identical buttons across the grid for screen-reader users —
  Recognition over Recall).

---

## 2. Tension — net-new

**Layout:** SVG canvas, x-axis = chapters (same column set as Plotlines — Gestalt:
Similarity), y-axis = unlabeled 0–100 tension. Solid path = story's per-chapter points
(draggable); dashed reference path = classic dramatic arc, non-interactive. Vertical
ACT I/II/III separators (dashed rules + label chips) at 25%/75%, set only via template
application (not manually dragged in v1 — avoids a second drag-target type competing
with tension points on a dense SVG). Legend: `your story` (solid) / `classic arc`
(dashed).

**Interaction:**
- Drag a chapter's point vertically (ns-resize) to set its tension; solid path
  re-draws live as a smooth spline through all points.
- Click a point (no drag) → Inspector for that chapter's key event if one exists;
  no-op if none (don't open an empty Inspector for a bare value with nothing behind
  it).

**Keyboard nav:** points are a 1-D roving-tabindex row, `role="slider"` each — APG
slider pattern, not the §0 grid pattern (this is a sequence along one axis, not a 2-D
grid):
`Tab` — one stop into the region, lands on first/last-focused point · `← →` move focus
chapter to chapter · `↑ ↓` adjust value ±1 (`Shift+↑/↓` = ±10) — this **is** the
WCAG 2.5.7 equivalent for the drag gesture, no separate move-mode needed since each
press is already a complete, reversible action · `Home`/`End` first/last chapter.
Value commits per keypress; rapid repeats within ~500ms coalesce into one Undo entry.

**States:** follows SKY-7253 §4. Empty-state copy doubles as a first-use nudge
(Progressive Disclosure): `No tension data yet` + `Drag a point on any chapter to
start plotting your story's rise and fall`.

**A11y:**
- Each point: `role="slider"`, `aria-valuemin="0"`, `aria-valuemax="100"`,
  `aria-valuenow="{n}"`, `aria-valuetext="Chapter {n}: tension {value}"` (chapter +
  value together — a bare number isn't meaningful).
- Classic-arc reference path: `aria-hidden`, meaning carried by the legend's real text
  (`classic arc`); both legend swatches pair color with line-style (solid vs. dashed),
  not color alone.
- ACT separators: visual rule is `aria-hidden`, paired with a real text label (`ACT I`)
  in the reading order so screen-reader users hit "ACT II" between the right points
  without depending on the line.

---

## 3. Spreadsheet, Relationships, Subway — keyboard/a11y layer on top of SKY-7253

Layout, redlines, colors, and states for these three are already specified in
`docs/TIMELINE-VIEWS-DESIGN-SPEC.md` §3.3–§3.5 and §4 — build to that, not a
restatement here. This section adds only the keyboard-nav and screen-reader depth
SKY-7770 asks for that SKY-7253 doesn't cover.

### 3.1 Spreadsheet

- Build as a native `<table>` (SKY-7253 specifies the grid-template-columns visually;
  underlying markup should still be real `<table>`/`<th scope="col">`/`<td>` so
  screen-reader table-navigation commands work, not a div-grid with CSS grid layout
  only).
- Keyboard: §0 grid pattern layered onto the table semantics. Column headers get
  `aria-sort="ascending|descending|none"` where the Narrative⇄Chronological toggle
  makes DATE·ERA sortable.
- `<caption class="sr-only">Timeline events, {Narrative|Chronological} order{, grouped
  by {group}}</caption>` — announces current sort/group state on entry, since the
  toggle lives in the toolbar outside the table's own reading order.
- FLASHBACK badge (SKY-7253 §3.3, `#ffd319`, reuses `.ax-event-flash`): the badge text
  must be a real DOM text node (`FLASHBACK`), not CSS `::before`/`::after` content,
  which some screen readers skip.

### 3.2 Relationships

- Native `<table>`, same reasoning as Spreadsheet.
- Keyboard: §0 grid pattern. Empty cells are inert (no click target, no focus stop) —
  don't make "nothing happened here" a dead-end tab stop for a screen-reader user
  crossing a mostly-empty row.
- `<caption class="sr-only">Character presence by chapter</caption>`.
- Filled dot: `aria-label="{character} present in chapter {n}"`. Empty cell: plain `—`
  text content (not an icon, not `aria-hidden`) so it reads as "chapter 4, dash" rather
  than being silently skipped — matches real spreadsheet-tool behavior (Jakob's Law).
- Filled dot is already color-independent by construction (filled circle vs. empty
  ring — shape, not hue, carries presence/absence); the per-character swatch color
  layered on top is redundant with the row-header name label, so no separate fix
  needed here beyond SKY-7253's hue-separation rule.
- **Open item, not resolved by this doc or SKY-7253** (SKY-6980 already flags this):
  whether "presence" is an explicit tagged field or derived from event POV data is a
  CTO data-contract call. UX recommendation: derive automatically from existing
  participant/POV data (Recognition over Recall — don't make users re-tag who's in a
  scene), with a manual override later in the Inspector event editor (M25). The
  filled/empty-dot UI contract above holds regardless of which shape wins.

### 3.3 Subway

- Stations: `role="button"`, `aria-label="Chapter {n}: {title}"`, roving-tabindex row
  (same 1-D pattern as Tension's points — `← →` station to station, `Home`/`End`
  first/last, `Enter`/`Space` → Inspector for that chapter). `↑ ↓` unused/no-op in this
  mode (single row, not a 2-D grid — reserves the keys without conflicting with
  Relationships' use of them, since only one mode is visible at a time).
- Character lines: `aria-hidden` on the SVG path itself — tracing raw path data via a
  screen reader is worse than skipping it; the line's meaning is fully covered by the
  station labels + the table alternative below.
- **New: `View as table` toolbar toggle** (`aria-pressed`, sits beside the mode-seg,
  visible only in Subway mode) swaps the SVG for the **identical table markup as
  Relationships mode** (§3.2) in place, moving focus into the table on activation.
  This is the primary accessible path for this mode, not a fallback: free-form
  connected-line diagrams have no APG pattern that conveys "which line belongs to
  this station" with the nuance a sighted user gets from color + position, so rather
  than a half-working bespoke ARIA scheme, screen-reader and keyboard-only users get
  the exact same data Relationships already provides, accessibly, on day one. Add this
  to SKY-7253 §7's component inventory as `TimelineSubwayTableToggle`.
- Legend swatches pair color with a distinct line-dash pattern (solid / dashed /
  dotted / dot-dash, cycling for >4 characters) so low-vision/colorblind users can
  still distinguish lines directly on the diagram, not only via the table toggle (§0
  color independence — the toggle is the complete accessible path; the diagram itself
  still shouldn't be color-only for users who can see shape but not hue).

---

## Addendum to FULL-SPEC §14 / SKY-7253 §8 acceptance checklists

1. Plotlines: arrow-key nav reaches every card; `Enter` enters move mode (dashed lift
   + live-region announcement), arrow keys retarget, `Enter` drops, `Esc` cancels and
   restores focus — no card is movable by mouse-drag only.
2. Tension: `Tab` once into the curve, `←/→` walks chapters, `↑/↓`
   (`Shift+↑/↓`) adjusts value without the mouse; `aria-valuetext` announces
   "Chapter N: tension NN" on every change.
3. Subway: `View as table` renders identical presence data to Relationships, focus
   lands inside the table on toggle.
4. Spreadsheet: Narrative⇄Chronological toggles by keyboard; `aria-sort` and the
   `<caption>` update; FLASHBACK badge has a real text node.
5. Every dot/line/badge across all 5 modes still reads its status with a grayscale/
   protanopia color-filter applied.

## Cross-links

- Parent build ticket: **SKY-6980** ("[Beta4/M24] Timeline remaining modes").
- Sibling design-ahead spec (redlines/theming/states, 3 of these 5 modes):
  **SKY-7253** → `docs/TIMELINE-VIEWS-DESIGN-SPEC.md`.
- Concurrent dependency: **SKY-6981** (M25, Inspector tab) — this doc assumes the
  click-to-Inspector routing in FULL-SPEC §8.6 lands there.
- Sibling a11y-spec depth reference: **SKY-3192** (G6 voice-panel a11y spec).
- Open item needing a CTO ruling before build: Relationships/Subway presence data
  contract (§3.2) — same item SKY-6980 already flags.
