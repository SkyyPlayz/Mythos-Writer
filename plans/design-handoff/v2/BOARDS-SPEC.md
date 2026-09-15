# Boards (Milanote-style canvas) — implementation spec

Everything the prototype does today, and what the backend must store for it. Written against
`Mythos Writer - Liquid Neon.dc.html` (Boards tab + Brainstorm → Board tab).

---

## 1. The core idea

**A board IS a folder. A card IS a note.** There is no second hierarchy.

| Vault concept | Board concept | Created/renamed/deleted from |
|---|---|---|
| Folder | Board tile (double-click to enter) | either side |
| Note file | Note card (preview + optional thumbnail) | either side |
| — | Column, connector line, image, sketch, to-do, table, swatch | board only |

So the tree in the Notes tab and the canvas in the Boards tab are two renderings of one
filesystem. Anything structural done on the canvas is a real vault mutation. Anything
decorative (position, size, colour, furniture) is **board metadata** that Obsidian never sees.

That split is the single most important thing for the backend: **two stores, one truth.**

- **Store A — the vault** (already exists): folders + `.md` files on disk.
- **Store B — board metadata** (new): positions, sizes, colours, furniture, thumbnails, icons.
  Keyed by vault path. Never authoritative about what exists — only about how it looks.

If Store B references something Store A no longer has, the entry is ignored (and should be
garbage-collected). If Store A has something Store B doesn't, it gets an auto-layout slot.
**Store B is never allowed to hide a note.**

---

## 2. Identity and keys

The prototype addresses everything on a board with a two-character prefix:

```
v:<folderId>     board tile   (vault folder)
n:<noteId>       note card    (vault note)
x:<furnitureId>  board-only item
```

Position/size maps are keyed `"<boardId>|<itemKey>"`, e.g. `"wb|n:gate"`.

**For the backend, replace the ids with vault-relative paths** — paths survive restarts and
sync, and they're what Obsidian-compatible tooling already uses:

```
v:Worldbuilding/Locations
n:Worldbuilding/Locations/The Sunken Gate.md
x:01J9F0C7Q2                       (ULID, generated per furniture item)
```

Renames must rewrite these keys (or store a stable file id in frontmatter — see §9).

---

## 3. Board metadata schema

One record per board (= per folder). Recommended on-disk shape: a sidecar file per folder,
so it moves/copies/syncs with the folder and merges cleanly in git/Dropbox.

`<folder>/.mythos-board.json`

```jsonc
{
  "version": 1,
  "updated": "2026-08-19T14:02:11Z",
  "layout": {                          // positions of this board's children
    "v:Locations":      { "x": 48,  "y": 44 },
    "n:Mira Veynn.md":  { "x": 316, "y": 44, "w": 236, "h": 272 }
  },
  "colors": {                          // accent override per child
    "n:Mira Veynn.md": "#ffd319"
  },
  "furniture": [                       // board-only items, see §4
    {
      "id": "01J9F0C7Q2", "k": "column", "x": 1140, "y": 44,
      "title": "Quick links",
      "items": [ { "t": "Mira Veynn", "ref": "Characters/Mira Veynn.md" } ]
    },
    {
      "id": "01J9F0C7Q3", "k": "line",
      "from": "v:Locations", "to": "n:Mira Veynn.md",
      "label": "shared lore", "color": null
    }
  ],
  "view": { "zoom": 100, "panX": 0, "panY": 0 }   // optional, per user not per vault
}
```

Notes on the fields:

- `layout[key].w/h` are **absent unless the user resized the item**. Absent = use the default
  size (§6), which lets defaults change in a future release without rewriting user data.
- `layout` entries for children that no longer exist are dropped on load.
- Children with no `layout` entry get an auto-layout slot (§6) — they are still shown.
- `colors` is the accent used for the card border, glow, board-tile chip and connector.
- `view` is UI state; if you sync it, sync it per-device, not per-vault.

---

## 4. Furniture types (board-only)

All share `id`, `k`, `x`, `y`, and optional `title`, `color`.

| `k` | Extra fields | Notes |
|---|---|---|
| `column` | `items: [{ t, ref? }]` | `ref` = vault path; renders as a clickable link, opens the note |
| `check` | `items: [{ t, done }]` | checkbox toggles persist |
| `table` | `rows: [[cell, cell], …]` | first row is the header row |
| `image` | `w`, `h`, `src?` | prototype renders a drop placeholder; backend needs an attachment path |
| `sketch` | `w`, `h`, `strokes?` | prototype renders a canned SVG; real version needs stroke data |
| `swatch` | `colors: [hex, …]` | clicking a swatch applies that colour to the current selection |
| `line` | `from`, `to`, `label`, `color` | endpoints are **item keys**; deleted when either end is deleted |

`line` is the only item that references other items. On delete of an item, cascade-delete every
line whose `from`/`to` matches it (the prototype does this in `bdDelete`).

---

## 5. Vault-mutating operations

These must hit the real filesystem, and the Notes tab must reflect them immediately.

| Board action | Vault effect |
|---|---|
| Note tool → click canvas | create `<board>/New note.md`, select it, start inline rename |
| Board tool → click canvas | create `<board>/New board/` |
| Rename (inspector or context menu) | rename file/folder |
| Move to trash | move file/folder to trash; record enough to restore (§7) |
| Restore from trash | move it back to its original parent |
| Drag a card | metadata only — **no vault change** |
| Tidy up | metadata only (clears this board's layout + furniture x/y) |

Guard rails in the prototype worth keeping:

- Creating a note at **Home** (vault root) is refused — root holds boards only.
- Renaming to empty string is a no-op.
- Board tiles show `N boards, M cards[, K items]` — counts come from the vault, not metadata.

---

## 6. Layout maths (so the backend's defaults match the UI)

```
world canvas      3200 × 2200 px
auto-layout       4 columns, cell 268 × 216, origin (48, 44)
                  x = 48 + (i % 4) * 268
                  y = 44 + floor(i / 4) * 216   (i = index among the board's children)
default sizes     board tile   190 × 138
                  note card    236 × 154   (236 × 272 when it has a thumbnail)
                  column       248 × (66 + items × 44)
                  check        238 × (60 + items × 26)
                  table        252 × (56 + rows × 29)
                  image/sketch w × (h + 48)
                  swatch       238 × 92
resize clamps     w 150–720, h 100–760
grid snap         20 px (position and size), toggleable
align guides      shown when an edge/centre is within 7 px of another item's
zoom              40–170 %; wheel ±8, buttons ±10; pan clamped to ≤ 0
```

---

## 7. Trash

Trash is per-vault and must survive a restart. Each entry stores what is needed to put the
thing back exactly where it was:

```jsonc
{ "kind": "note",            // note | board | furniture
  "path": "Characters/Kael Thorne.md",
  "parent": "Characters",    // restore target
  "board": null,             // for furniture: which board it belonged to
  "payload": { … },          // for furniture: the full item record
  "deleted": "2026-08-19T14:02:11Z" }
```

Restore rules the prototype implements:

- Restoring a note/folder whose **parent is also trashed** fails with a clear message
  ("its board is in the trash too — restore that first"). Don't silently re-root it.
- Restoring furniture puts it back on its original board at its original x/y.
- `Delete`/`Backspace` trashes the whole current selection, one item at a time.

---

## 8. Note thumbnails

Resolution order per note (`bdThumbOf`):

1. explicit override for this note (`"off"` = user removed it → show text only)
2. `thumb` in the note's frontmatter
3. the note's **first image block**
4. none → text-only card

Backend shape — frontmatter, so it travels with the file and stays Obsidian-readable:

```yaml
---
thumb: attachments/veynn-skyline.png     # explicit
thumb: false                             # explicitly none
---
```

The cover also renders in the Notes editor beside the title (badge reads `Thumbnail` when
explicit, `Auto` when derived from the first image), with an × that writes `thumb: false`.

---

## 9. Icons (Obsidian Iconize parity)

Per-item icon + colour, applied to the vault tree, the board tree and board tiles.

```jsonc
// .mythos/icons.json  (or Iconize's own data.json if you want drop-in compatibility)
{
  "Worldbuilding":                       { "icon": "map",    "color": "#2fe6c8" },
  "Characters/Mira Veynn.md":            { "icon": "star",   "color": "#ffd319" }
}
```

24 glyphs ship in the picker (`book scroll feather crown sword shield map compass castle
mountain wave flame moon star eye key mask potion tree ship skull gem bell hourglass`) with 8
colours. Keys are vault paths; renames must rewrite them. Unknown icon name → fall back to the
default folder/file glyph rather than rendering nothing.

**Recommended: give every note/folder a stable id** (`id:` in frontmatter for notes, a
`.mythos-board.json` `id` for folders) and key metadata by id, with path as a lookup index.
That makes renames and moves free, at the cost of one write when a file is first seen.

---

## 10. Search, wikilink overlay, minimap

- **Search across boards** walks the whole vault (folders + notes), matches on name, and each
  hit navigates to the containing board and selects the item. Server-side: a name index is
  enough; content search is a separate feature.
- **Wiki-link overlay** (toggle) draws a dashed connector between two note cards on the same
  board when one links to the other. It reads the same link graph the Vault Graph uses —
  `[[wikilinks]]` resolved by note name, plus recorded backlinks. Purely derived; never stored.
- **Minimap** is derived from item boxes; nothing to persist.

---

## 11. Brainstorm integration

The Brainstorm tab's **Board** page renders the same Boards canvas from the same state — not a
copy. Consequences for the backend: there is exactly one board API, and the Brainstorm view is
just another client of it. Additionally:

- Agent Chat has an inline board strip under the transcript (resizable) showing the same canvas.
- **Idea Collections** `+` files an agent-suggested idea as a real note in a mapped folder
  (`beats/theme/trope/loose → Plot & Story`, `rel → Characters`, `world → Worldbuilding`) and
  navigates to that board. Checkmarks are computed by matching idea text against existing note
  names, so the same idea can't be filed twice.

---

## 12. Suggested API surface

```
GET    /vault/boards/:path                 → { children[], layout, colors, furniture }
PATCH  /vault/boards/:path/layout          → { "n:Foo.md": {x,y,w,h}, … }   (partial merge)
PATCH  /vault/boards/:path/colors
POST   /vault/boards/:path/furniture       → item (server assigns id)
PATCH  /vault/boards/:path/furniture/:id
DELETE /vault/boards/:path/furniture/:id   (cascades connector lines)
POST   /vault/notes                        → { parent, name }        (Note tool)
POST   /vault/folders                      → { parent, name }        (Board tool)
PATCH  /vault/items/:path                  → { name }               (rename)
DELETE /vault/items/:path                  → moves to trash
GET    /vault/trash            POST /vault/trash/:id/restore
PUT    /vault/notes/:path/thumb            → { src | false | null }
PUT    /vault/icons/:path                  → { icon, color } | null
```

Write behaviour that matters for feel:

- **Drags must not round-trip per frame.** Coalesce and flush layout on mouse-up (or debounce
  ~250 ms). The prototype updates local state on every move; the network layer should batch.
- **Layout writes are last-write-wins per key**, not per file — two people moving different
  cards on one board must not clobber each other. Merge at the key level.
- Structural ops (create/rename/trash) are the only ones that need to be strictly ordered.

---

## 13. What is still mock in the prototype

Be explicit with the team so nobody reverse-engineers a placeholder:

- Image cards are drop placeholders; sketch cards render a canned SVG. No real attachment
  pipeline, no drawing tool.
- Note previews come from the first paragraph of the mocked note objects; real previews should
  come from the file body.
- Board-tile counts use mocked `count` fields where present.
- `view` (zoom/pan) is in-memory only.
- No multi-user presence, no undo stack for board metadata (undo is per-action toasts today).

---

## 14. Acceptance tests worth writing

1. Create a note with the Note tool → it appears in the Notes tree in the same folder, and on
   the board at the click point.
2. Drag a card, quit, reopen → same position. Delete the metadata file → card reappears in an
   auto-layout slot, note intact.
3. Rename a folder from the Notes tree → its board tile, board-tree row, icon and all layout
   entries follow.
4. Trash a board containing cards → cards go with it; restoring the board restores them.
5. Trash a card that is a connector endpoint → the connector disappears; restoring the card
   does **not** resurrect the connector (documented behaviour).
6. Two clients move different cards on one board → both moves survive.
7. A note whose frontmatter has `thumb: false` shows a text-only card even though it contains
   an image.
