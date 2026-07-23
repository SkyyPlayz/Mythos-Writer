# M18 / M19 / M25 — Keyboard, Focus/ARIA, Dyslexia-Conformance, Dismissal Spec

**Issue:** SKY-8268 (design-ahead for **M18**/SKY-8264 Notes right panel, **M19**/SKY-8265
Scene Crafter refresh, **M25**/SKY-8266 Timeline right panel + Archive)
**Designer:** UXDesigner
**Status:** Ready for build — posted while all three milestones are actively in progress
**Authoritative sources:** `plans/design-handoff/v2/FULL-SPEC.md` §6/§7.1/§8.6 and
`plans/design-handoff/SCENE-CRAFTER-CANVAS-SPEC.md` win on layout/copy/visuals. This
doc is additive: the keyboard/focus/ARIA/dyslexia/dismissal layer those don't cover.
`plans/Readability-Mode.md` is binding for all dyslexia-conformance claims below.

## Why this doc, not a fresh pattern per surface

Two of these three surfaces already ship a top-level tablist with the same shape
(`NotesTabPanel.tsx:516` Agent/Properties; `timeline2/panel/TimelineRightPanel.tsx:110`
Inspector/Brainstorm/Archive) and both have the **same gap**: tabs are plain
`<button role="tab">` elements with `aria-selected` but no roving `tabindex`, no arrow-key
switching, and no `aria-controls`/`id` pairing to their panel. One fix, stated once (§0),
applies to both instead of two divergent patches landing in two PRs.

---

## 0. Shared conventions (read once, applies to all three surfaces)

**Focus ring:** `--focus-ring` (2px, `:focus-visible` only) — already the app-wide token
(`PageChromeToolbar.css:231`, `StoryNavigator.css`, `FormatToolbar.css:66`). Every new
interactive element in M18/M19/M25 uses it; don't introduce a second focus treatment.

**Top-level tab strips (binding fix for M18 + M25, applies to any new tab strip M19 adds):**
WAI-ARIA APG Tabs pattern — one Tab stop for the whole strip (`tabindex=0` on the active
tab, `-1` on the rest), `← →` move focus and activate (automatic activation — these are
lightweight view switches, not slow-loading panels), `Home`/`End` first/last tab. Each tab
gets `aria-controls="{panel-id}"`; each panel gets `id` + `aria-labelledby="{tab-id}"`.
This is a **testable regression fix**, not new scope: `NotesTabPanel.tsx`'s Agent/Properties
tabs and `TimelineRightPanel.tsx`'s Inspector/Brainstorm/Archive tabs both currently lack
this (verified in-repo, both mid-build) — land it as part of M18/M25, not a follow-up.

**Popovers/drawers/inspectors — Escape semantics (binding, applies everywhere in scope):**
`Escape` closes the topmost popover/drawer/modal and returns focus to the control that
opened it (the existing convention — see `DraftsPopover.tsx`, `PageSetupPopover.tsx`).
Never let Escape bubble past the topmost layer (a card's inline-edit Escape must not also
close its parent panel). Per-surface popovers below all follow this without restating it.

**Roving-tabindex grids (canvas cards, kanban-style lists):** WAI-ARIA APG grid/listbox
pattern — one Tab stop for the collection, arrow keys move focus item-to-item, `Enter`/
`Space` activates. This is the established pattern from `docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md`
§0 (SKY-7770) and the regression class named in this issue (SKY-7330, SKY-8158) — reuse it
verbatim rather than inventing a fourth variant for M19's canvas.

**Dyslexia conformance model (binding, all three surfaces):** per `plans/Readability-Mode.md`
— Readability mode's type bundle (line-height, letter/word spacing, paragraph spacing,
left-aligned never justified, no forced italics/all-caps in body copy) applies to every
text node added by M18/M19/M25, no opt-out, same "apply everywhere" requirement already
locked in `docs/AGENT-HUB-SUGGESTION-INBOX-GAP-SPEC.md` §7. Where increased spacing would
overflow a fixed-height card/panel, the **container grows or scrolls**, never clips or
compresses row spacing to compensate.

---

## 1. M18 — Notes right panel (Agent tab: Brainstorm chat + Continuity Flags; Properties tab)

### 1.1 Keyboard path
Panel entry → tablist (§0 pattern) → active tabpanel. **Agent tab, top to bottom:** chat
history (`aria-live="polite"` region, not individually focusable — messages are read
content, not controls) → composer textarea → send button → Continuity Flags list below the
chat, each flag a plain sequential tab stop (title, then its 3 actions in DOM order) —
**not** a roving-tabindex grid. Flag cards mirror the existing Suggestion Inbox row pattern
(`docs/AGENT-HUB-SUGGESTION-INBOX-GAP-SPEC.md` §4/§5, carried from SKY-2471): bounded count
per vault session, plain `Tab` order is simpler and correct here (Occam) — roving-tabindex
is for unbounded canvas/grid collections, not a short list of cards. **Properties tab:**
frontmatter rendered as a real `<table>` (`<th scope="row">` per field) or `<dl>`, not a
div-grid — screen-reader table/description-list navigation must work.

### 1.2 Focus + ARIA
- Continuity Flag card: `role="article"`, `aria-label="{title}, flagged by Archive Agent,
  {Story|Vault} source"`. Same status semantics as the Suggestion Inbox: a flag's
  resolution updates via `aria-live="assertive"` on the card (per SKY-2471, carried forward
  in the AGENT-HUB spec) — "flags fire the same handlers as manuscript comment actions"
  (M18 accept criterion) means this ARIA behavior must match too, not just the click
  handler.
- The 3 flag actions are icon-or-short-label buttons — every one needs a real accessible
  name (`aria-label` if icon-only), never a bare icon with only a `title` attribute.
- `ARCHIVE AGENT` badge is decorative color+icon; pair it with the visible text label
  already in the spec (FULL-SPEC §6) — don't let it be the only cue (WCAG 1.4.1).

### 1.3 Dyslexia-support conformance
- Chat bubbles and flag card bodies: sentence case, ≤4 lines before a "Show more"
  disclosure rather than silent truncation — matches the card-body clamp rule in
  `SCENE-CRAFTER-CANVAS-SPEC.md`'s dyslexia section, reused here for consistency across
  every card surface in the app, not just Crafter.
- Frontmatter table (Properties tab): field labels always precede values, one field per
  row (never label-inline-with-value crammed into one line) — labels-before-detail is the
  binding rule from this agent's design-direction, and a frontmatter table is exactly the
  kind of dense key/value UI that regresses to unreadable if built as a 2-column crush.
- **Flag conflict (flag to CEO, don't silently pick):** Continuity Flags need to stay
  scannable at a glance (Recognition over Recall — the whole point of the feature), but
  Readability mode's paragraph-spacing bundle (§0) will push flag body text taller. If
  Readability mode is on and a vault has many open flags, the list could get long enough
  that "scan all flags at a glance" and "full dyslexia-friendly spacing" are in tension.
  **Resolution for now: spacing wins, panel scrolls** (§0's binding rule) — flagging this
  explicitly per the issue's instruction, since it's a real trade-off, not a design gap.

### 1.4 Escape / dismissal
- No popover is spec'd for M18's right panel itself (chat + card list, no drawer). If the
  template picker or continuity-flag detail is later promoted to a popover, it follows §0.
- Collapse button (`notes-sidebar-collapse-btn`, already has `aria-label`): keyboard-
  operable via existing Tab order; no Escape binding needed since it's a persistent panel
  toggle, not a transient overlay — don't add an Escape-to-collapse that would surprise a
  user mid-chat-typing (Escape inside a textarea should never trigger panel collapse).

---

## 2. M19 — Scene Crafter refresh (setup form, suggested cards, canvas, draft card, right kanban)

### 2.1 Keyboard path
Setup form (title/POV/GOAL/CONFLICT/BEATS/tone/length) is standard sequential form tab
order — no special pattern needed (Postel's Law: it's a form, behave like one). SUGGESTED
CARDS panel: search field → results list, sequential tab order (bounded, matches §0's "not
every list needs roving-tabindex" reasoning from M18) with `Enter` to add-to-canvas as the
keyboard equivalent of drag (WCAG 2.5.7 — dragging must have a non-drag alternative).
**Canvas:** `CanvasBoard.tsx` already implements `tabIndex`/`onKeyDown` for pan and
per-card head/resize (lines 277–373) — this spec **confirms and extends** that existing
foundation rather than replacing it:
- One Tab stop into the canvas region; arrow keys pan when no card is focused.
- `Tab`/`Shift+Tab` inside the canvas region cycles card-to-card (roving tabindex, §0),
  not browser default DOM order, since cards are absolutely positioned and DOM order
  won't match visual/spatial order.
- Card focused → `Enter` opens the linked note (avatar chip target); a **separate**
  explicit key (`M` for "move", matching the move-mode convention already spec'd in
  `docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md` §1 Plotlines) enters keyboard-move: arrow keys
  reposition a ghost target, `Enter` commits, `Esc` cancels and restores position + focus —
  this **is** the WCAG 2.5.7 equivalent for card drag-to-reposition.
- Link tool (draws connections between cards): keyboard equivalent = focus source card →
  activate link tool → arrow/Tab to target card → `Enter` commits the connection, `Esc`
  cancels — same move-mode shape, reused rather than inventing a third gesture.
- Right kanban (beats/cast/places): sequential tab order per column; this is a narrow
  fixed list per board, not a large reorderable grid, so full roving-tabindex is
  unnecessary complexity here (Occam) — flag to CEO only if a future milestone adds
  drag-reorder within kanban columns, which would change this call.

### 2.2 Focus + ARIA
- Canvas region: `role="application"`... **no** — canvas cards are content with real
  semantics (cards, links), not an opaque widget; use `role="group"` on the canvas
  viewport with `aria-label="Scene board canvas"`, and let cards be real focusable
  elements inside it (already true per `CanvasBoard.tsx`) so screen readers keep normal
  reading-order fallback instead of being locked out by `application` mode.
- Card `aria-label`: `"{title}, {tone/length or state}"` — must be legible without relying
  on the colored header alone (color-independence, WCAG 1.4.1), matching the pattern
  already required for Plotlines cards in `docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md` §1.
- Generate button and draft-card actions (Add to scene board / Retry / Discard): all
  three need distinct accessible names — three plain "OK"-shaped buttons in a row is a
  Recognition-over-Recall failure for screen-reader users navigating by button list.
- Draft card in progress (`— first pass` generating state): `aria-live="polite"` region
  announcing "Generating a first-pass draft…" then the completion, so non-visual users get
  the same progress signal the Coach-framed copy gives sighted users.

### 2.3 Dyslexia-support conformance
- This surface already has a written dyslexia section
  (`SCENE-CRAFTER-CANVAS-SPEC.md` — card titles one line ellipsis-truncated, body ≤4 lines
  clamped, 1.5–1.8 line-height, labels-before-detail, `#9cabc4`/`#c8d3e7` contrast floor,
  reduced motion). **This doc does not restate it — build to that doc**, this section only
  adds the one thing it doesn't cover: the **setup form** (title/GOAL/CONFLICT/BEATS
  textareas). Long-form textareas must also honor Readability mode's line-height/letter-
  spacing bundle (§0) — the existing dyslexia section only covers *cards*, not the *form*
  that feeds them, and a writer typing a GOAL/CONFLICT paragraph is exactly the "writing is
  the harder part" case `Readability-Mode.md` calls out as the biggest win.
- Tone chips / length segmented control: label precedes control (already implied by
  FULL-SPEC layout) — confirm no theme can flip this to control-then-label.

### 2.4 Escape / dismissal
- Suggested-card drag-preview / any hover tooltip on avatar chips: dismiss on `Escape` or
  pointer-leave, per §0.
- Keyboard-move mode and link-tool mode (§2.1) both restore focus to the originating card
  on `Esc` — this is the surface-specific instance of §0's "Escape returns focus to opener"
  rule, called out explicitly because these are modal *interaction modes* on a persistent
  canvas, not a popover, and it would be easy to build "Esc cancels" without also restoring
  focus.
- Generate → draft card is not a modal/popover (it's an inline card state per
  `SCENE-CRAFTER-CANVAS-SPEC.md`), so no Escape-to-dismiss applies to it; Discard is the
  explicit action, not implicit via Escape (protects against an accidental Esc discarding
  a generated draft — Forgiveness principle cuts the other way here: don't let a
  navigation-reflex keystroke destroy work).

---

## 3. M25 — Timeline right panel (Inspector · Brainstorm · Archive) + Archive auto-build

### 3.1 Keyboard path
Tab strip → §0's binding tablist fix (this is the second surface with the exact gap named
in the header). **Inspector tab:** event/lane-item/plotline editors are standard sequential
forms (pencil-toggle → fields → Done/Delete) — matches §2.1's "forms behave like forms"
reasoning, no special pattern. **DATE/TIME → picker** button opens a popover (§0 Escape
rule applies) with the existing exact-time-modal keyboard model (4 mono inputs, `Tab`
between them, `Enter`/`change` commits) already built for `ExactTimeModal.tsx` — reuse
that component's keyboard behavior rather than a new date-picker interaction. **Brainstorm
tab / Archive tab:** each has its own mini chat sharing the same composer→history keyboard
model as M18 §1.1 (one pattern for "a chat box," not three) plus a list (NEEDS FILLING
OUT / RECENTLY AUTO-ADDED) in plain sequential tab order — same bounded-list reasoning as
M18's Continuity Flags and M19's kanban.

### 3.2 Focus + ARIA
- Both mini chats (Brainstorm tab, Archive tab) need distinct `aria-label`s on their
  `aria-live` history regions (`"Brainstorm Agent conversation"` /
  `"Archive Agent conversation"`) — screen-reader users switching tabs must be able to
  tell which chat they're in without relying on tab-strip context alone, since M25's
  accept criterion (§14.5 in FULL-SPEC) requires "both mini chats work," which includes
  working non-visually.
- NEEDS FILLING OUT list items: clicking "jumps to the fix" (FULL-SPEC §8.6) — the jump
  target must receive focus after the jump, not just scroll into view, or keyboard/screen-
  reader users lose their place (a scroll-only "jump" is invisible to them).
- RECENTLY AUTO-ADDED ✓ list: the checkmark is a redundant-with-text cue
  ("auto-added" already says what happened) — fine as-is, called out only to confirm no
  color-only version of this ships later.
- Quick-add input (`Add the festival from Ch. 4…`) → `Add` button: on submit, the agent's
  dating/plotting result needs an `aria-live="polite"` confirmation (`"Added and dated: …"`)
  since the action's real effect (a new dated event) happens elsewhere on the timeline,
  outside the input's own visual vicinity.

### 3.3 Dyslexia-support conformance
- Inspector field labels precede their controls (TITLE, CHAPTER, LOCATION, POV, SUMMARY,
  STARTS/ENDS, EMBEDS TIMELINE) — already implied by FULL-SPEC's layout, confirming no
  compact-mode variant collapses label+field onto one crowded line under Readability mode's
  wider letter-spacing.
- Brainstorm/Archive blurb copy (`"Brainstorm Agent — notes keeper: manages your notes...")
  is already short, concrete, sentence-case per the existing spec — passes the dyslexia bar
  as written; flagging only that Readability mode's spacing bundle must not be skipped for
  these blurbs just because they're "chrome" rather than user-generated content (§0's
  binding "no opt-out" rule, restated here because blurb/chrome copy is exactly the kind of
  text an implementer might assume is exempt).

### 3.4 Escape / dismissal
- DATE/TIME picker popover and `Set exact time…` popover: §0 Escape rule, focus returns to
  the field's toggle button that opened them.
- Pencil-toggle edit mode on the Inspector (not a popover, an inline mode swap): `Escape`
  cancels the in-progress edit and reverts to static view **without** saving, focus stays
  on the pencil toggle — this needs stating explicitly because it's the same "modal
  interaction mode on a persistent panel" shape as M19's canvas move-mode (§2.4), and it's
  easy to build Escape-cancels-but-loses-focus by accident.

---

## Hand-off

Posting the summary of this doc as a comment on SKY-8264 (M18), SKY-8265 (M19), and
SKY-8266 (M25) so the coders see it in-thread while building. The one conflict worth
CEO attention is M18 §1.3 (Continuity Flags: scan-at-a-glance density vs. Readability
mode's spacing bundle) — resolved here as "spacing wins, panel scrolls," flagged rather
than silently decided per this issue's instructions.
