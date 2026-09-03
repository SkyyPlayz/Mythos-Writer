# Entity `reveal_point` / position-format contract

**Status:** active · **Owner:** FoundingEngineer · **Tickets:** SKY-11318 (origin),
SKY-11344 (CTO audit), SKY-11349 (this contract), SKY-10741 (first UI consumer)

Entity alias frontmatter may carry a `reveal_point` — the manuscript position at
which a character/place/thing first becomes known to the reader. The
reader-perspective filter (`aliasesVisibleBefore`, SKY-10741) shows an entity
only once the current reading position has reached its `reveal_point`.

Both `reveal_point` and the "current position" are free-text strings authored by
the writer. This document defines the **canonical format** they are parsed and
compared against so mixed conventions can never silently miscompare.

## Canonical position format

A position is an ordered tuple `[stage, part, chapter, scene]`, mirroring the
manuscript hierarchy in [`MANUSCRIPT-STRUCTURE-VIEW-DESIGN.md`](./MANUSCRIPT-STRUCTURE-VIEW-DESIGN.md)
(Part → Chapter → Scene, with Prologue/Epilogue as book-level sentinels).

Write positions with explicit, case-insensitive labels:

| Form                          | Parses to                          |
| ----------------------------- | ---------------------------------- |
| `Prologue`                    | stage −1 (before the body)         |
| `Epilogue`                    | stage +1 (after the body)          |
| `Part 2`                      | part 2                             |
| `Chapter 3` / `Act 3`         | chapter 3 (Act ≡ Chapter, same level) |
| `Scene 12`                    | scene 12                           |
| `Act 1 Scene 4`               | chapter 1, scene 4                 |
| `Part 2 Chapter 3 Scene 5`    | part 2, chapter 3, scene 5         |

Rules:

- **Each number binds to the axis named by the label in front of it.** Order in
  the string does not matter (`Scene 4 Chapter 1` == `Chapter 1 Scene 4`).
- **`Act` and `Chapter` are the same structural level** and share the `chapter`
  axis — the design doc treats chapters/acts as the single primary
  organizational unit, so `Act 2` and `Chapter 2` are equal.
- **`0` on any axis means "unspecified"** and sorts before any explicit value at
  that level (`Chapter 0` < `Chapter 1`).
- **A reveal is "reached"** when `compareScenePositions(reveal, current) <= 0`.

## Why this replaced the old parser

The original `parseScenePosition` (SKY-11318, PR #1423) scraped the **first two
integers** from the string regardless of label. `Scene 12` became `major=12` and
`Chapter 3` became `major=3`, so a scene index and a chapter index were compared
on one flat numeric axis. `reveal_point="Act 2"` vs `current="Chapter 3"`
likewise compared `2 < 3` with no notion of which axis each number lived on.

Because `aliasesVisibleBefore` had no production caller yet, this was latent, not
live. SKY-10741 will make it live by wiring the filter into the
reader-perspective UI, so the contract is fixed here first.

## Author guidance

- Use the **same qualification** for `reveal_point` and the current position
  within a manuscript. Mixing an unqualified `Scene 12` with a `Chapter 3` is
  under-specified: the unqualified axes default to `0` and sort earliest.
- Prefer the fullest form the manuscript uses (`Chapter 3 Scene 2`) over a bare
  number. Bare numbers still parse (legacy fallback: first int = chapter, second
  = scene) but carry no axis information.

## Implementation

`electron-main/src/vault/entityIndex.ts`:

- `parseScenePosition(pos): ScenePosition` — label-aware parse to the canonical tuple.
- `compareScenePositions(a, b): number` — total order over positions.
- `aliasesVisibleBefore(entries, currentPosition)` — the reader-perspective filter.

Tests: `electron-main/src/vault/entityIndex.test.ts`.
