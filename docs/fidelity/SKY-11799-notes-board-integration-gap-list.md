# SKY-11799 — Notes Board design-lens integration pass

Read-only review. No product code changed. Walked the real built app
(`out/main/main.js`, rebuilt from current `origin/main` + one unrelated
test-only commit) at 1440×900 under Playwright/xvfb, exactly as a user
would reach it — nothing pre-seeded beyond vault files (COMPANY-STANDARDS
§4c). Screenshots: `docs/screenshots/sky-11799/`.

Contract used: `plans/design-handoff/v2/FULL-SPEC.md` (no dedicated Notes
Board section — it postdates FULL-SPEC and is governed by the Paperclip
owner-concept epic instead), the SKY-11188/89/90/92 slice ACs, and the
owner rulings on that epic. `BOARDS-SPEC.md` does not exist in this repo
and was not searched for (per standing note).

**Coverage-area 3 (legibility over wallpaper) and area 5 (icons) turned
out to be gated by two other open slices, not board-surface bugs** — see
the closing verdict. Where a gap traces to a slice ticket that is already
`todo`/in-progress rather than a fresh defect, the fix line says so
instead of proposing a new ticket.

## Gaps (blockers first)

### NB-1 — Board canvas and Brainstorm's board are still two separate, differently-built surfaces — **blocker**

Screenshot: [08-brainstorm-tab](../screenshots/sky-11799/08-brainstorm-tab.png) vs.
[01-empty-board](../screenshots/sky-11799/01-empty-board.png)

This is coverage area 1 itself. SKY-11192 (9/9, "Brainstorm Board-page
unification") is the ticket that makes Brainstorm's Board page render the
*same* canvas component/state as the Notes Board tab. On `origin/main`
today it has not landed: `frontend/src/components/BrainstormBoard/BoardCanvas.tsx`
(Brainstorm's own canvas) and `frontend/src/pages/Boards/BoardCanvas.tsx`
(Notes Board's canvas) are two independent implementations. Brainstorm's
Board is reached via an `Idea Board` toggle next to `Agent Chat`
(`BrainstormPage.tsx`) and has no furniture toolbar, no minimap, no
wikilink overlay — none of the chrome the Notes Board tab has. A user who
opens both sees two different products, not one canvas reused in two
places.

**Fix:** none needed from this ticket — this *is* SKY-11192's scope, and
it is already an open slice. Flagging so the "is Notes Board beta-ready"
verdict below is honest about why it isn't a single closed loop yet.

### NB-2 — New furniture spawns on top of existing note/folder tiles, illegible overlap — **blocker**

Screenshot: [03-all-furniture-types](../screenshots/sky-11799/03-all-furniture-types.png),
close-up: [04-column-furniture-closeup](../screenshots/sky-11799/04-column-furniture-closeup.png)

`handleFurnitureCreate` in `frontend/src/pages/Boards/BoardsTabPanel.tsx:639-650`
places each new furniture item on a 4-column grid keyed only off
`furniture.length` (`x = 48 + col*300`, `y = 44 + row*260`). It never
checks where the board's *note/folder* items (`items`) already sit. The
very first "+ Column" on any board that already has a tile near the
canvas origin — which is every board a user has actually been using —
lands directly on top of that tile: two titles rendered in the same box,
text bleeding through the translucent furniture panel, both illegible.
Reproduced from a cold Boards-tab visit with three seeded notes; not an
edge case.

**Fix:** feed `items` (and `furniture`) bounding boxes into the same
placement pass so a new card's default slot is chosen against the union
of both, not furniture alone — same "Tidy up" comment already acknowledges
collisions are expected between furniture, just not against note tiles.

### NB-3 — Minimap overflows its own frame into a tall column that spills over the canvas and the zoom cluster — **blocker**

Screenshot: [06-folder-with-50-notes](../screenshots/sky-11799/06-folder-with-50-notes.png)

Opening a folder with 50 notes (the coverage-area-4 "many items" case)
turns the minimap — a fixed `168×116` panel per `BoardMinimapPanel.tsx`
(`MINIMAP_W`/`MINIMAP_H`) — into a narrow strip of dots that visibly
extends well past its own bottom-left panel border, overlapping both the
canvas content behind it and the zoom control row (`100% − +`) next to
it. `minimapProjection()` in `boardMinimap.ts` is a correct uniform
fit-to-frame scale given a `world` size, so the likely cause is
`minimapWorld` (`BoardCanvas.tsx:893-896`, derived from `containerWidth`/
`canvasHeight`) not yet reflecting the just-navigated folder's real
content extent at the moment this renders — a stale-world render rather
than a math error in the projection itself. Whichever it is, the shipped
minimap breaks exactly where it matters most: a folder large enough to
need one.

**Fix:** verify `minimapWorld` recomputes synchronously with
`resolvedItems`/`canvasHeight` on folder navigation (not just on drag/
resize), and add `overflow: hidden` to `.board-canvas__minimap` as a hard
backstop so a stale-world frame clips instead of spilling onto the canvas.

### NB-4 — Board tiles carry no per-item icon; SKY-11190 hasn't landed on main — **fidelity**

Screenshot: [05-board-with-solo-and-bulk-folder](../screenshots/sky-11799/05-board-with-solo-and-bulk-folder.png)

`BoardCard.tsx` has no `IconPicker`/`icons.json` wiring — only a comment
about the thumbnail fallback. Confirmed the SKY-11190 icon-parity commits
exist but are not ancestors of `origin/main` yet (still open, per the
ticket's own description of the two open slices). Every tile scans purely
by title text today; the "24-glyph × 8-colour" Iconize-parity affordance
the slice AC calls for isn't on the assembled surface to review.

**Fix:** none needed from this ticket — this is SKY-11190's own scope,
still open. Re-run this coverage area once 11190 merges; specifically
check icon rendering survives folder-rename (its own AC) and reads
correctly against the Liquid Neon token set, not a raw hex per glyph.

### NB-5 — First-visit toast lands on top of the canvas's own zoom/minimap cluster — **polish**

Screenshot: [01-empty-board](../screenshots/sky-11799/01-empty-board.png)

`DesktopShell.tsx:1603` fires a one-time, 5-second `showUpgradeToast('Your
notes are in the new Notes tab.')` on first Boards-tab visit after
onboarding. Its fixed bottom-center anchor sits directly over the zoom
percentage readout, partially abutting the `+`/`−` buttons and the
minimap frame — the one spot on this surface with the densest cluster of
small interactive controls. It's non-blocking and self-dismisses, so this
is not reachable repeatedly, but a toast should never choose the one
occupied control cluster on the page it lands on (Doherty / feedback
placement).

**Fix:** anchor app-shell toasts to a lane that doesn't overlap
known per-surface chrome (e.g. top-center, or bottom-center offset above
the canvas toolbar row), rather than a single global fixed position.

### NB-6 — Right-side panel chrome (Assistant/Agent) differs in structure across Board, Notes Editor, and Brainstorm — **needs-owner**

Screenshots: [02-note-tiles-and-long-title](../screenshots/sky-11799/02-note-tiles-and-long-title.png) (Board — Assistant/Scenes/Notes/References tabs + Getting Started checklist + Agents roster) vs.
[07-notes-editor-brainstorm-sidebar](../screenshots/sky-11799/07-notes-editor-brainstorm-sidebar.png) (Notes Editor — Agent/Flags/Properties tabs, note-scoped) vs.
[08-brainstorm-tab](../screenshots/sky-11799/08-brainstorm-tab.png) (Brainstorm — Agent Activity/Continuity/Detected Facts)

All three share the same dark-panel-with-magenta-top-glow treatment, but
the tab models, content density, and information architecture are three
distinct designs bolted onto the same visual shell, at exactly the seam
this ticket asks to inspect (Board ↔ Notes Editor ↔ Brainstorm). This may
be intentional — each panel is scoped to a different task — but a
newcomer clicking through all three in one session will feel three
different apps in the same chrome.

**Fix:** none proposed — this is a taste/IA call, not a bug. Flagging per
the bounds instructions: needs an owner ruling on whether the right-panel
IA should converge, not a coder dispatch.

## Coverage note — area 3 (legibility over wallpaper)

SKY-11787 (per-panel text-backing) is described as in-flight in this
ticket's brief. On the surfaces walked here the Board canvas root already
sits behind the fixed 42% scrim fill (`--board-canvas-fill`, verified
against the mockup by the existing SKY-11494 BD-1 test) rather than raw
wallpaper, and tile titles render on the `rgb(20 25 42 / 0.9)` tile fill,
not on wallpaper directly — so **the Board surface itself does not need
SKY-11787's fix**; its text never sits directly on the brightest wallpaper
tier the way an un-backed panel would. No gap filed for this area.

## Suggested dispatch order

| # | Gap | Why here |
|---|-----|----------|
| 1 | NB-2 | Reachable on any board with one existing item; corrupts the newest, most basic interaction (adding a card). |
| 2 | NB-3 | Breaks a core navigation affordance under realistic content volume (many notes is the normal case, not an edge case). |
| 3 | NB-5 | One-line anchor fix, low risk, improves first-run polish. |
| — | NB-1, NB-4 | No new dispatch — already tracked by SKY-11192 and SKY-11190 respectively; re-review once merged. |
| — | NB-6 | Owner ruling needed before any dispatch. |

Not fixes: NB-1, NB-4 (already-scoped open slices), NB-6 (needs-ruling).

**Total: 6 gaps — 3 blocker, 2 fidelity (1 of which is a not-yet-landed
slice), 1 needs-owner, 1 polish.** Verdict: **the Notes Board is not
beta-ready as an integrated surface yet.** Two of the six coverage areas
this ticket asked about are gated on slices still marked open in this
same epic (icons, Brainstorm unification), and of the areas that could be
walked end-to-end, the canvas itself has two newly-found, easily-reachable
rendering blockers (furniture placement, minimap overflow) that would
surface on the very first session a real user has with more than a
handful of notes.
