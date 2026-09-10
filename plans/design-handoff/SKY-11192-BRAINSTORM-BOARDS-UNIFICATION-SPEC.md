# SKY-11192 — Brainstorm/Boards unification UX spec

Design-ahead spec for SKY-11192 (Notes Board 9/9). Written against
`BOARDS-SPEC.md` v2 §11–§12 and the parent owner ruling on SKY-10724:
*"Same board system replaces the Brainstorm page's board, editable from
either location."* There is exactly one board component (`CanvasBoard`,
`frontend/src/canvas/CanvasBoard.tsx`) and one board API (`notesBoard.ts`
IPC surface). Brainstorm's Board page is a client of both, not a fork.

Tokens only — no new tokens invented. Dyslexia-friendly baseline applies
everywhere: short lines, generous line-height (`--dyslexia-line-height:
1.6`), left-aligned text, labels before detail, no icon-only controls
without a text label or `title`/`aria-label`.

Today, Brainstorm has its own free-form idea canvas
(`components/BrainstormBoard/BoardCanvas.tsx`, `BrainstormBoardData`, its
own JSON store) — a *different* component from the Notes Board's
`CanvasBoard`. This spec replaces that fork: Brainstorm's Board page starts
rendering `CanvasBoard` over a real vault folder, the same folder the Notes
Board tab can navigate to. `BrainstormBoard/BoardCanvas.tsx`,
`brainstormBoard.ts`'s free-floating category/world model, and
`brainstormBoardStore.ts` are retired by this change (build ticket: migrate
existing local brainstorm-board JSON into real vault notes once, then
delete the old store — flag as its own AC, not silently dropped).

---

## 1. The shared canvas in two homes

**What must NOT differ.** Same component (`CanvasBoard`), same instance of
board state for a given folder — not two copies kept in sync. Card visuals,
drag/resize/connect/delete, keyboard behavior (arrow-key move, Enter/Space
to connect, Delete to remove, Escape to cancel a link), pan/zoom range,
color slots, and the zoom/fit dock are pixel-identical in both homes. A
card moved in one home is exactly where it was left when the user opens the
same folder's board in the other home — this is one state, not a sync, so
there is no "last saved" moment to show and no merge conflict to design for.

**What differs is chrome around the canvas, never the canvas itself:**

- **Notes Board tab** — the canvas fills the tab under the existing folder
  breadcrumb / board-tile navigation already shipped by SKY-11184–11190.
  No change from this ticket.
- **Brainstorm tab, Board page** — header keeps its existing seg control
  (`Agent Chat | Board`) and session pill. Directly under the header, add a
  **folder-scope pill row**: three pills, one per mapped folder — `Plot &
  Story`, `Characters`, `Worldbuilding` — plus a fourth, `Browse vault…`,
  that opens the Notes Board tab's own folder tree in a lightweight picker
  popover for any other folder. The active pill shows which folder's board
  is currently on screen. This exists because Brainstorm's Board page has
  no folder-tree navigator of its own (that lives in the Notes tab) — the
  pill row is the minimum wayfinding a user needs to know *which* board
  they're looking at, per **Recognition over Recall**: don't make the user
  remember which folder they last opened.
  - Default pill on first visit: whichever mapped folder was most recently
    filed into via Idea Collections this session; otherwise `Plot & Story`.
  - Pill state persists per-session (not per-launch) — reopening the Board
    page mid-session returns to the same folder.

**What the user is meant to understand.** The pill row + a one-line caption
under it — `This is your Notes Vault, viewed here.` — is the whole
affordance. No modal, no onboarding tooltip: the caption is plain-language,
present every time (Jakob's Law — a returning user doesn't need it
re-explained, but removing it costs nothing and helps first-time users;
Postel's Law says be generous to the reader here since dyslexia readers
benefit from a standing label over a one-time toast that might be missed).
Do not add a "synced" badge or spinner distinct from the Notes Board tab's
own save-state indicator — showing two different-looking sync indicators
for one save operation would imply two operations happening, which is
false and would violate **trust** (Norman's principle: the model should
match the real system, not a plausible-looking wrong one).

---

## 2. The Agent Chat inline board strip

Sits under the transcript on the Agent Chat page, toggled by the existing
`Board` toggle in the chat header. Resizable by a drag-bar on its top edge
(cursor: `row-resize`; keyboard-focusable, Home/End jump to min/max, arrow
keys step by 16px — same keyboard-resize idiom `CanvasBoard` already uses
for cards, so the interaction vocabulary stays one thing across the app).

| | value | why |
|---|---|---|
| Default height | **240px** | Enough for one full-size note card (154px, or 272px with a thumbnail — floor the strip at showing the card top edge, not a full thumbnail card, since it's a peek not a workspace) plus the dock and status line without clipping either. |
| Minimum height | **140px** | Below this a card head + one line of body cannot render without clipping (`CanvasBoard`'s card min-height is enforced at 60px per §6 layout maths for the *card*; 140px is the *strip's* floor so the dock and status line still fit above/below it). Dragging below the floor snaps to it, doesn't hide the strip — hiding is only ever the explicit `Board` toggle. |
| Maximum height | **480px**, or 60% of the chat panel's rendered height, whichever is smaller | Caps the strip so the transcript never drops below a readable few lines — this is a peek/preview surface, not a substitute for opening the Board page. |

The strip renders the **same folder's board** as the pill row on the Board
page (same active-folder state, not its own selection) — read-only is
*not* used here; the ticket's own scope note says this is the same
editable canvas, just shorter. Drag/resize/connect/delete all work in the
strip exactly as on the full Board page.

**Empty state (folder has zero children):** centered, one line —
`No ideas here yet. File one from Idea Collections, or open the Board page
to add a card.` — no illustration; this is a low-height strip, an
illustration would just get clipped by the 140px floor.

**Too-short-for-a-card state:** this only applies while the user is
mid-drag on the resize handle between 140px and roughly 190px (a card
head alone is ~40px; below that plus the dock/status chrome, a full card
cannot render without its body clipping). In that band, cards collapse to
**head-only chips** (avatar + title, no body, no resize handle) rather than
clipping — the same card data, a shorter render, never truncated mid-word.
This reuses the card's existing head markup (`cvb-card-head`) with the body
`div` and resize handle hidden via a `cvb-card--collapsed` class, so it's a
CSS state, not a second component.

---

## 3. Idea Collections

**The mapping (fixed, not user-editable):**

| Idea Collections category | Target folder |
|---|---|
| Story Beats, Themes, Tropes, Loose Ideas (`beats`, `theme`, `trope`, `loose`) | **Plot & Story** |
| Character Relationships (`rel`) | **Characters** |
| Worldbuilding Clusters (`world`) | **Worldbuilding** |

**Confirmation affordance.** The row's trailing control is a **text button
labeled `File`**, not a bare `+` icon — per the constraints section
("clear labels rather than icon-only controls") and because this action
now has real, visible consequences (creates a vault note, may create a
folder) where the old `+` just added an in-memory board card. Clicking
`File` performs the action immediately — no second confirm dialog. This
is intentionally *not* a two-step confirm: creating a note is cheap and
fully reversible (delete the note, same as any note), so a confirmation
modal here would be friction without safety benefit (**Doherty**: keep it
under 400ms, no modal round-trip) — the forgiveness comes from undo, not
a gate. `File` immediately becomes a toast with an `Undo` action (same
toast+undo idiom `CanvasBoard`'s card-delete already uses), and undo
deletes the just-created note and reverts the row to unfiled. This is
the app's existing forgiveness pattern, reused rather than inventing a
disable-and-confirm.

Every click path here is a **direct user click on `File`** — this is a
hard constraint per the ticket, not a default: no code path may call the
filing function from an agent turn, a timer, or a batch action. Flag this
explicitly to the build agent as a review-blocking acceptance criterion,
and to QA as a thing to try to break (e.g., confirm the agent's own
"suggest this as an idea" chat action stops at *suggesting* — highlighting
the row in Idea Collections — and never calls the file path itself).

**States, left to right in the row:**

1. **Unfiled** — `File` button, default/secondary button style (not the
   accent-filled primary style — filing one of a dozen suggested ideas
   isn't *the* action on this screen, Agent Chat is).
2. **Filed** — button becomes a static label `Filed ✓` (still
   announced to screen readers as text, not an icon-only checkmark) plus a
   secondary text link `Open` that navigates to the note's board and
   scrolls the card into view. No `File` control remains — see next point
   for why re-filing is blocked, not just discouraged.
3. **Filing** (brief, mid-action) — button shows `Filing…` and is
   disabled; this state is expected to resolve in well under a second (a
   local file write), so no cancel affordance is needed here — matches
   Doherty's <400ms feedback floor without needing a progress state for
   something this fast.

**Already-filed detection** (per BOARDS-SPEC §11): computed by matching the
idea's text against existing note names in the target folder, not by a
separate "filed" flag — so an idea filed in a prior session, or a note a
user created by hand with a matching name, both correctly show `Filed ✓`
and block a duplicate. This means the check re-runs whenever the target
folder's contents change (a note renamed away from the matching name
un-blocks that idea; this is intentional, not a bug to guard against).

**Target folder does not exist.** `Plot & Story`, `Characters`, and
`Worldbuilding` are the three folders the *whole vault-side-panel entities
feature already expects* (they're the standard top-level folders offered
by templates/onboarding) — but a hand-built or imported vault may lack
one. On `File` click, if the target folder is missing, create it
**silently as part of the same click** (it is still the direct result of
the user's own click on `File` — the hard constraint is about *agent*
autonomy, not about a folder being an implicit side effect of a user
action the user just took), then create the note inside it, then navigate.
No separate "create folder?" prompt — that would be friction for a
same-click, expected, reversible structural op, and it matches
BOARDS-SPEC §5's existing precedent that the Note/Board tools create their
target directly rather than asking first.

---

## 4. Empty, loading, and error states

### Notes Board tab (unchanged, ships already under SKY-11184–11190)
Out of scope for this ticket — noted here only so the two Brainstorm
surfaces below are specified relative to something concrete.

### Brainstorm → Board page
- **Empty** (folder has zero children): full-height centered state —
  heading `Nothing on this board yet`, one line of body copy `Add a card
  from the dock, or file an idea from Idea Collections on the left.`, and
  the dock stays visible/usable (this is not a blocking empty state, it's
  a normal empty canvas — per **Aesthetic-Usability**, don't make "empty"
  look broken, make it look like the start of something).
- **Loading** (folder/board metadata not yet read from disk — should be
  near-instant for a local vault, but cross the Electron IPC boundary so
  design for it): skeleton dock + skeleton status line + a centered
  spinner-free pulse placeholder card outline (no spinner — a static
  pulse reads as "settling in," a spinner over a canvas reads as "your
  cards are loading," which isn't true; this mirrors the app's existing
  skeleton idiom elsewhere rather than introducing a new loading motif).
  Cap at Doherty's 400ms — if the read hasn't resolved by then, this state
  is indistinguishable from empty on a fast machine, which is fine.
- **Error** (board metadata file is present but malformed, or the folder
  itself has been deleted out from under the open pill): replace the
  canvas area with a single-line message, left-aligned, no modal —
  `Couldn't open Plot & Story. It may have been moved or deleted.` plus a
  secondary text button `Choose another board` that reopens the pill
  picker. Per `notesBoard.ts`'s own degrade-to-safe-default philosophy
  (§ header comments — a malformed sidecar never crashes, it falls back
  to an empty board), a malformed metadata file is NOT an error state at
  all from the user's point of view — it silently degrades to the empty
  state above with all positions reset to auto-layout. Reserve the true
  error state for the folder being genuinely gone.

### Agent Chat inline board strip
- **Empty**: per §2 above — one centered line, no illustration.
- **Loading**: the strip mounts collapsed to its last-known height with a
  static pulse across the card area; no separate skeleton dock (the dock
  is cheap to render immediately since it doesn't depend on board data).
- **Error**: same "malformed metadata degrades to empty" rule as the Board
  page — the strip has no room for a message-plus-button error state at
  140–480px, so a genuinely-deleted folder here just shows the strip's
  empty state text swapped to `This board is no longer available. Open
  the Board page to choose another.` (still a single line, no button —
  tapping/clicking the strip's folder-scope indicator, shared with the
  Board page's pill, is the way out).

---

## Component/token reuse for handoff

- Canvas engine: `frontend/src/canvas/CanvasBoard.tsx` (existing, unmodified
  API — `board`, `onChange`, `onOpenNote`, `readOnly`, `pendingExternalCard`).
  Brainstorm's Board page and chat strip both instantiate this component
  against the active folder's `CanvasBoardData`, sourced from the same
  `notesBoard.ts` IPC calls the Notes Board tab uses (`getBoard`,
  `patchLayout`, `patchColors`, `furnitureCreate/Update/Delete`).
- Toast + undo: `frontend/src/components/Toast/Toast.tsx` +
  `useToast` hook — reuse verbatim for the Idea Collections `Undo`.
  affordance (§3) and the strip/page's existing card-delete undo.
- Card collapse state (§2): new CSS class only, `cvb-card--collapsed`, on
  the existing `CanvasBoard` card markup — no new component.
- Color slots: reuse `CANVAS_COLOR_SLOTS` (0–5) exactly as Notes Board
  cards use them today; do NOT reintroduce the retired `BOARD_CATEGORIES`
  six-category color set — that model is retired by this ticket (§ intro).
- Spacing/type: `--space-*`, `--text-*`, `--radius-*` per tokens.css;
  no new values. Empty/error state body copy uses `--text-sm` /
  `--text-body` at `--dyslexia-line-height: 1.6`, left-aligned.
- New copy strings are listed inline above (§1–§4) — treat those as final
  copy, not placeholder, unless engineering finds a character-count
  constraint that forces a rewrite (flag back to design if so, don't
  silently shorten).

## Definition of done — build-readiness checklist

- [ ] Brainstorm's Board page instantiates `CanvasBoard` against a real
      vault folder; `components/BrainstormBoard/BoardCanvas.tsx`,
      `brainstormBoard.ts`'s category/world model, and
      `brainstormBoardStore.ts` are deleted after a one-time migration of
      any existing local board data into real vault notes.
- [ ] Folder-scope pill row ships on the Board page (§1); chat strip reads
      the same active-folder state, no separate selection.
- [ ] Chat strip resize: 240px default / 140px min / 480px-or-60% max,
      collapsed-card state below ~190px (§2).
- [ ] Idea Collections row uses labeled `File` / `Filing…` / `Filed ✓` +
      `Open`, not icon-only (§3); filing creates the target folder
      silently if missing; filing is verified reachable ONLY via direct
      user click in code review (hard constraint, §3).
- [ ] Empty/loading/error states per §4 on both Brainstorm surfaces;
      malformed-metadata degrades to empty, not error, matching
      `notesBoard.ts`'s existing safe-default philosophy.
