# Timeline Views — Design-Ahead Spec (M24 / M25)

**Issue:** SKY-7253
**Designer:** UXDesigner
**Status:** Ready for build — land before M24/M25 coding starts
**Goal:** Beta 4 "Refine" (`4e7ee5ee`)
**Authoritative sources:** `plans/design-handoff/v2/FULL-SPEC.md` §8 (Timeline) wins on
any conflict with this doc. `docs/releases/BETA-REFINE.md` M24/M25 define scope and
acceptance. This doc fills the gap those two leave: switching between views,
problem-flag surfacing, empty/loading/syncing/error states, and the token mapping —
none of which exist in the prototype yet.

**Named constraint — dyslexia-friendly, adjustable not forced** (owner is dyslexic,
SKY-3941): every view stays scannable at default settings; every density/motion/glow
knob is a real Settings toggle, never a hidden requirement to get a readable screen.

---

## 0. Scope

Five views, per the issue: **Progress, Structure, Spreadsheet, Relationships,
Subway.** Plotlines and Tension are the other two modes in FULL-SPEC §8.5/§8.4 —
they are out of scope for this doc (tracked separately) and are not in the
mode-switcher list below.

Reference renders (synthetic data, 1440×900, real token values) live in
`docs/screenshots/timeline-views/`. These are a harness built from the approved
prototype's own markup (`plans/design-handoff/v2/prototype/…dc.html` lines
1901–2074) plus new elements this doc specifies (flags, states) — not the shipped
app. Treat them as redline references, not final pixels; the prototype still wins
on anything they disagree about for the four already-speced views.

| Render | File |
|---|---|
| Progress (live) | `view-progress.png` |
| Structure (live) | `view-structure.png` |
| Spreadsheet (live) | `view-sheet.png` |
| Relationships (live) | `view-rel.png` |
| Subway (live) | `view-subway.png` |
| Empty state | `state-empty.png` |
| Loading state | `state-loading.png` |
| Syncing state | `state-syncing.png` |
| Error state | `state-error.png` |
| Density: comfortable / compact | `density-comfortable.png` / `density-compact.png` |

---

## 1. Switching between views

One segmented control, top of the Timeline header, immediately right of the
"Timeline" title (`view-progress.png`) — reusing the existing `tlModeSeg` chrome
already built for all seven modes (FULL-SPEC §8.4 toolbar, prototype line 1907).
This doc only adds the five labels in scope: **Progress · Structure · Spreadsheet ·
Relationships · Subway**.

- Single row, no wrapping, no overflow menu at 1440px — five short labels fit
  (Hick's Law: five is comfortably below the point where a picker/dropdown would
  be needed; Miller's Law headroom for the two out-of-scope modes elsewhere).
- Selection persists **per story**, restored on reopen (state lives beside
  `S.tlMode`, keyed by story id) — respects the user's last working context
  instead of always resetting to Progress (Recognition over recall / Jakob's Law:
  it should behave like every other "last tab" in the app).
- Keyboard: arrow left/right moves selection when the seg has focus, Home/End jump
  to first/last; `role="tablist"` / `role="tab"` with `aria-selected`. This is a
  view switch, not navigation to a new page — no route change, no scroll reset.
- Switching views **never re-fetches** — all five read the same in-memory
  `timelines.json` model (per-story), so switching is instant (<100ms, Doherty
  threshold) with no loading flash between views. Only the *initial* per-story
  load can show the Loading state (§4).

### Progress vs. Structure — same rows, different intent

Structure reuses the exact lane engine as Progress (FULL-SPEC §8.4: "Structure
identical minus progress styling") — same rows, same axis, same drag/resize/click
interactions (§8.3). The **only** difference:

- Progress adds: the written/planned legend, dim/greyscale styling on
  not-yet-written items, and the "you are here" ring + label.
  (`view-progress.png` vs `view-structure.png`)
- Structure drops all three — every item renders at full color/opacity regardless
  of draft status. Reading intent: Progress asks "how much have I written";
  Structure asks "does the shape of the story work," without draft-status noise
  competing for attention (Gestalt: removing the written/planned encoding removes
  a grouping variable so the eye reads pacing/shape instead).
- Do not build Structure as a second component. It is Progress with
  `showProgressStyling={false}` — one lane-row engine, one set of interaction
  handlers, two callers. (Reuse > extend > new.)

---

## 2. Problem-flag surfacing — actionable, non-blocking

The Archive Agent flags contradictions, gaps, and ordering skips as it auto-builds
the timeline. This must never block reading or editing the timeline — flags are an
affordance you can ignore indefinitely.

**Reuse, don't invent:** this is the exact pattern already shipped in
`ArchivePanel.tsx`/`.css` for scene-level continuity flags (`.ap-badge`,
`.ap-card`, `.ap-card-inconsistency`'s left-bar treatment, Jump + Resolve actions,
`aria-live` scan status). Timeline's flags are the same component vocabulary
pointed at the Archive Agent's timeline-level findings instead of scene-level
ones. Do not design a second flag UI.

- **Badge**: a pill next to the mode-seg, header-level so it reads regardless of
  which of the 5 views is open (`view-progress.png`, top row: "● 3 flags"). Color
  is the existing `--state-warning` / `--color-warning-bg` / `--color-warning-border`
  triad (already used for `.ap-mock-banner` / `.ap-card-inconsistency`) — not a new
  hue. Count only, no severity breakdown in the badge itself (avoid a second
  numeric system to parse at a glance — Miller's Law).
- **Click → opens Inspector's existing Archive tab** (FULL-SPEC §8.6), scrolled to
  a **Flags** section using the identical `.ap-section-header` / `.ap-badge` /
  `.ap-card` markup as ArchivePanel, each card: one-line description, anchor
  ("Between Ch. 17 and Ch. 18"), **Jump to scene** + **Resolve…** actions
  (`view-progress.png` right rail).
- **Jump to scene** selects the flagged item on the canvas and opens it in
  Inspector — same click-to-select path every other timeline item already uses
  (§8.3), so it needs no new interaction code.
- **Resolve…** opens the same confirm/dismiss pattern as
  `ArchiveConfirmDialog.tsx` (accept the agent's fix / edit manually / dismiss) —
  reuse that dialog rather than a new one.
- **Non-blocking guarantee**: flags never gate rendering, never appear as a modal,
  and never disable canvas interaction. A flagged item still drags, resizes, and
  opens normally; the flag is metadata on it, not a lock.
- **Per-item cue on the canvas itself**: the specific lane item a flag points at
  gets a 2px `--state-warning` outline (same visual language as the `.ap-card`
  left-bar, translated to a canvas item) so a flag is discoverable by scanning the
  timeline, not only by opening the drawer — but it is a thin outline, never a
  blocking overlay or forced popover (Von Restorff effect used sparingly: one
  extra outline color reads as "look here," a whole highlighted row would be
  noise).
- **Zero-flags rule**: when the timeline has no data (Empty state, §4) the badge
  and Flags list are both absent — there is nothing to flag yet. Don't show "0
  flags"; absence of the badge already says that.
- **Count badge in the nav rail / tab strip is out of scope here** — that's a
  cross-surface notification-center decision (§2 in `DESIGN-SPEC.md`), not a
  Timeline-specific one. Flag this to CTO if Timeline needs a rail-level indicator
  too.

---

## 3. Per-view redlines

Shared chrome for all 5 (from FULL-SPEC §8.3–8.4, carried forward unchanged):
ERAS bar, adaptive tick labels, zoom seg + Ctrl-scroll (Progress/Structure only,
see §5 interaction table), universal direct manipulation (drag = move, edge
handles = resize, click = select→Inspector), auto-stacking lanes, filter selects
(View / Group By / Show), Today button. This section only calls out per-view
deltas and the redline measurements coders need.

### 3.1 Progress (default mode)

- Lane order top→bottom: ERAS · BOOKS · ARCS · CHAPTERS · PLOTLINES · KEY EVENTS ·
  CHARACTERS · WORLD · THEMES · CUSTOM ROWS (FULL-SPEC §8.4 verbatim order — do
  not reorder).
- Legend, left-aligned under the header, 3 chips: written (filled) / planned
  (dashed, dim) / you-are-here (ring). One line, no wrap at 1440px.
- Item states: written = filled fill + solid 1px border in the row's color slot;
  planned = `rgba(150,150,160,.18)` fill + 1px dashed `rgba(180,180,190,.4)`
  border, text dimmed to `#aebad0`. Contrast check: dimmed planned-item text on
  the dark canvas background still clears 4.5:1 — verify against the final canvas
  background color once implemented (the dashed border is decorative, not the
  only signal — color-independent: shape (dashed vs solid) carries the
  written/planned distinction, not color alone).
- "You are here": 2px `--n6`/`--b6` outline + glow, current chapter only, plus the
  text label in the legend ("you are here · Ch 17") — never color-only, always
  paired with the label so it doesn't rely on color perception.
- Key event cards: 215px wide (FULL-SPEC §8.4), icon tile + title + chapter +
  2-line description + FLASHBACK badge when out of chronological order.

### 3.2 Structure

Identical to 3.1 minus the legend and the written/planned/here styling (§1). Same
215px key-event cards, same lane order, same interactions.

### 3.3 Spreadsheet

- Columns, fixed order: EVENT · CH · DATE/ERA · POV · LOCATION · IMPACT
  (`grid-template-columns: 2fr .5fr 1.1fr 1fr 1fr 1fr`, 8px gap, 14px horizontal
  padding — exact values from prototype line 2016, carried forward).
- Group header rows (one per Group-By value) use the violet data-slot color
  (`--n2`), bold, uppercase, letter-spacing `.12em` — visually distinct from data
  rows without needing a separate background color per group (Gestalt: common
  region via the row's own background tint is enough).
- **Narrative ⇄ Chronological** toggle, small seg above the table
  (`view-sheet.png`): Chronological re-sorts by in-world date and is the one case
  where a FLASHBACK badge (gold, `#ffd319` text on `rgba(255,211,25,.1)`) appears
  on out-of-narrative-order rows. Caption line under the toggle states this in
  plain language every time — don't make the user infer what the toggle does from
  the badge alone (Plain Language, Recognition over recall).
- Row click → Inspector, same as every other item (§8.6). Row hover:
  `background: var(--gs6)` (timeline's own slot, see §6) at 8% — consistent with
  the rest of the app's row-hover treatment.
- No zoom control — a data table has no time-axis to zoom (§5).

### 3.4 Relationships

- Header row: 110px name gutter (empty) + one column per event, icon + short
  label, centered, `9px` label size, truncated with ellipsis rather than wrapping
  (`view-rel.png`).
- One row per character: 110px right-aligned name (color = that character's
  assigned line color) + a thin baseline + one dot per event column, filled when
  present, empty ring when absent.
- **Finding from the render pass:** two characters whose assigned colors both land
  near the "cool" end of the palette (cyan `--n1` and teal `--n5`) were hard to
  tell apart in `view-rel.png` at a glance. Character line-color assignment must
  enforce a **minimum hue separation** between any two characters visible in the
  same view (not just cycle through the 6 slots in order) — same requirement
  carries into Subway (§3.5), where it matters even more since color is the only
  way to tell two lines apart. This needs a small assignment algorithm (hash → hue
  bucket, skip adjacent buckets already in use), not a fixed palette lookup.
  Flagging to FoundingEngineer/ProductEngineer as a concrete acceptance item, not
  just a nice-to-have.
- No zoom control (categorical columns, not a continuous axis).

### 3.5 Subway

- Station row: one icon + one truncated label per event, centered above its
  column (`view-subway.png`).
- One colored line per character, 4px stroke, rounded caps/joins, subtle glow
  (`filter: drop-shadow`) matching the app's existing neon-line treatment
  elsewhere (character lifespan lines in Progress, vault-graph edges) — reuse the
  same glow recipe, don't invent a new one.
- Station dot: 7px radius, dark fill (`#0b0d17`), 3px stroke in the line's color —
  reads as "hollow bead on a glowing wire," consistent at any zoom.
- A dip/gap in a character's line at a given station = that character sits that
  beat out. Caption states this in plain language every time (same principle as
  §3.3's toggle caption) — don't make absence-of-a-dot the only explanation.
- Legend below, one chip per character (swatch + name) — same minimum-hue-
  separation requirement as §3.4.
- No zoom control.

---

## 4. Empty / Loading / Syncing / Error states

One shared state model across all 5 views — the header (title, mode-seg, filters)
never disappears; only the content viewport below it changes. This keeps the view
switcher and Today/filters usable even mid-error, so the user is never stuck
(`state-*.png`).

| State | What shows | Notes |
|---|---|---|
| **Empty** | Centered card: "No events yet" + one line explaining the Archive Agent builds this from notes/scenes + a **Run Archive Agent now** button (`state-empty.png`). | Flag badge absent (§2). This is the fresh-story / brand-new-vault case, not an error — framed as an invitation, not a dead end (Kano: a working empty state is a baseline expectation now, not a delighter). |
| **Loading** | 3 skeleton bars in place of lane rows, shimmer animation, header chrome fully interactive (`state-loading.png`). | First load only (§1) — under ~1s typical for a single story's `timelines.json`; if it's ever slower, the skeleton is what prevents a blank-screen flash (Doherty). |
| **Syncing** | A slim strip above the canvas: pulsing dot + "Archive Agent is syncing this timeline from your manuscript — content stays interactive while it works." Canvas underneath is the **last-known-good** data, fully interactive (`state-syncing.png`). | This is the common case (auto-build runs on save, debounced — same pattern as `useArchiveScheduler`). It must never block editing; that's the whole point of "self-maintaining." `aria-live="polite"` on the strip's text so screen readers hear it once, not on every poll. |
| **Error** | A banner above the canvas: "Couldn't reach the Archive Agent — showing the last synced timeline." + **Retry**. Canvas underneath still shows the last-synced data, fully interactive — **not** a blank viewport (`state-error.png`). | Caught a real inconsistency while building the reference render: an error state that also blanks the canvas contradicts its own "showing the last synced timeline" message. The canvas must stay exactly as it was before the failed sync. |

Reduced-motion: the syncing pulse and loading shimmer both respect
`prefers-reduced-motion` / the app's reduce-glow setting — replace the animated
pulse with a static dot and the shimmer with a flat skeleton tone. Never the only
way state is communicated (the text label is always present too).

---

## 5. Interaction spec

| Interaction | Progress | Structure | Spreadsheet | Relationships | Subway |
|---|---|---|---|---|---|
| Zoom (seg + Ctrl-scroll) | ✅ | ✅ | — | — | — |
| Filters (View/Group/Show) | ✅ | ✅ | ✅ (Group By drives section headers) | ✅ | ✅ |
| Drag to move-in-time | ✅ | ✅ | — (edit via Inspector) | — | — |
| Edge-handle resize | ✅ | ✅ | — | — | — |
| Click → select → Inspector | ✅ | ✅ | ✅ (row click) | — (read-only view) | — (read-only view) |
| Jump-to-scene (from a flag or a row) | ✅ | ✅ | ✅ | — | ✅ (station click) |
| Today | ✅ (scrolls + selects) | ✅ | — (no axis position) | — | — |

Carried forward from FULL-SPEC §8.3 verbatim for the ✅ cells in Progress/
Structure — this table exists so a coder building Spreadsheet/Relationships/
Subway doesn't wire up zoom or drag handlers that have nothing to act on. The
prototype already encodes this (`tlShowZoom: tlIsLanes || tlIsPlot`, prototype
line 7168) — this table makes it visible without reading the prototype's JS.

---

## 6. Theming — Liquid Neon, 6 slots

Per `frontend/src/tokens.css` (Beta 3 slot engine) and `DESIGN-SPEC.md` §1, the six
slots are: **1** left panel/primary · **2** center/wiki-links · **3** right panel/
agents · **4** warm data · **5** cool data · **6** nav rail/timeline.

**Finding:** the prototype's Timeline markup (authored before the slot engine
existed) reaches for `var(--n1, …)` / `var(--n2, …)` positionally wherever a neon
accent was needed — "you are here," Today, group headers, tension/today markers —
without regard to the documented slot semantics. At Neon Classic defaults this
looks correct by coincidence (slot 1 and the prototype's literal `#00f0ff` are the
same hue). It stops being correct the moment a user recolors **slot 6 (their
Timeline slot)** in Settings: nothing in the Timeline view would actually change
color, because the view isn't wired to slot 6 at all.

**Build rule:** every Timeline-frame accent — mode-seg active state, zoom-seg
active state, "you are here" ring, Today button, ERAS-bar hover, ambient
border/glow on the whole panel — must resolve to **`--n6`/`--b6`/`--g6`/`--gs6`**,
not `--n1`/`--n2`. This is the one thing recoloring the Timeline slot in Settings
should visibly change everywhere at once. The reference renders in
`docs/screenshots/timeline-views/` already use `--n6` for this reason — they are
not a literal copy of the prototype's current hardcoded values.

Per-item data still uses its own semantic slot, unchanged from FULL-SPEC:

- **Key events** → slot 4 (warm data, `--n4` orange family) — matches "warm data"
  in the token comment and the prototype's existing orange key-event cards.
  Contradiction/gap flags reuse the app's existing `--state-warning` token, not a
  neon slot — flags are a system-status color, not a story-data color, and must
  stay legible regardless of which theme preset or custom palette the user picks.
- **World/systems rows** → slot 5 (cool data, `--n5` teal family).
- **Arcs, plotline dots, group headers** → slot 2 (center/wiki-links family, `--n2`
  violet) — matches existing usage.
- **Characters** (lifespan lines, Relationships rows, Subway lines) → per-
  character assigned color, NOT tied to a single slot — see §3.4's minimum-hue-
  separation requirement. These are user data, not chrome, so they should stay
  stable per character even if the user later changes their theme preset (store
  the assignment, don't re-derive it from slot order every render).

Glass/blur/glow, unchanged from the shell: `--glass`/`--glass2` panel fills,
`--bw` (border width, 1–4px per Appearance settings), `--gr` (glow radius,
8–160px), `--blur`. The whole Timeline panel is a standard glass panel like every
other view — no new chrome primitive.

Reduce-glow / reduced-motion (existing Appearance toggles) apply here exactly as
everywhere else: reduce-glow drops the `box-shadow`/`drop-shadow` glow layers
without touching layout or the underlying fill/border colors — items stay just as
identifiable, only stop emitting light.

---

## 7. Component inventory

New/formalized components this spec introduces, for FoundingEngineer/
ProductEngineer to name in the actual codebase:

| Component | Reuses | Notes |
|---|---|---|
| `TimelineModeSeg` | Existing `tlModeSeg` segmented-control chrome pattern (shared with Zoom seg, Order seg) | 5 labels in scope; keyboard per §1 |
| `TimelineFlagBadge` | `.ap-badge` (ArchivePanel.css) | Header-level, count-only |
| Archive tab **Flags** section | `.ap-section-header` / `.ap-card` / `.ap-card-inconsistency` / `.ap-actions` (ArchivePanel.tsx/.css) | Same markup, timeline-scoped data |
| Flag resolve dialog | `ArchiveConfirmDialog.tsx` | Reuse, don't fork |
| `TimelineEmptyState` | App's existing empty-state pattern (e.g. `.ap-empty-section`, `feat/sky-89-notes-vault-empty-state` precedent) | CTA: Run Archive Agent now |
| `TimelineSyncStrip` | New, but styled from `--n6` slot tokens, `aria-live="polite"` | Non-blocking, sits above canvas |
| `TimelineErrorBanner` | `.ap-error` (ArchivePanel.css) | Adds Retry action |
| `TimelineSkeletonRows` | New shimmer primitive — check for an existing app-wide skeleton component before building one (grep `skeleton` in `frontend/src`) | 3 bars, matches lane height |
| Per-character color assignment | New utility (hash → hue bucket, min-separation) | Feeds Relationships, Subway, Progress character lifespans |

---

## 8. Acceptance checklist (mirrors the issue)

- [x] All 5 views specified with redlines + states — §3, §4.
- [x] Problem-flag surfacing designed (actionable, non-blocking) — §2.
- [x] Theming mapped to the 6 slots — §6 (plus the slot-6 correction finding).
- [x] Dyslexia-friendly constraint named and satisfied — density is a real,
      pre-existing Settings toggle (Comfortable/Cozy/Compact, §6/§4 renders),
      short row labels, plain-language captions on every non-obvious control
      (§3.3, §3.5), color never the sole carrier of state (§3.1, §3.4).

## Handoff

- **Implementation** → FoundingEngineer/ProductEngineer for M24 (Spreadsheet,
  Relationships, Subway, Structure-diff-from-Progress) and M25 (flag surfacing +
  states, wired to the Archive Agent). Component names and token rules above are
  the acceptance surface; cite this doc's section numbers in the PR description.
- **Visual/flow verification** → QA once built, across all 5 views × the 4 states
  in §4, at 1440×900 and the app's min supported width, plus the reduce-glow and
  reduced-motion toggles.
- **Archive Agent flag data contract** (what a flag object needs: kind,
  description, anchor, affected item id) is a backend/CTO concern this doc doesn't
  own — flagging that the Inspector Archive tab needs that contract defined
  before M25 starts.
