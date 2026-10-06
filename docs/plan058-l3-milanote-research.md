# PLAN-058 L3 — Milanote research note (78:29)

**Status:** Research only — **no Milanote-specific behavior was invented or shipped** in this tip (per PLAN-058 Soft-FAIL).

## What the beta video called out (78:29)

Skyy compared Boards to Milanote-style workflows (freeform canvas, linked cards, columns, to-do stacks). The actionable ship-set for L3 is the Liquid Neon v2.6 Boards prototype (`bdToolDefs`, `bdApplyColor`, vault-backed cards) — not a feature-parity clone of Milanote.com.

## Prototype vs Milanote (observed)

| Milanote-like expectation | Mythos v2.6 prototype source | L3 handling |
|---|---|---|
| Hand/pan + pointer/select tools | `bdToolDefs` hand + pointer entries | Shipped icon rail tools `pan` + `select` |
| Drag empty space to pan | `bdCanvasDown` when `bdTool==='hand'` or Alt | Shipped pan tool + Alt-drag |
| Connectors between cards | `bdTool==='line'` between item keys | Shipped line tool (`n:`/`v:`/`x:` endpoints) |
| Colour swatch applies to selection | `bdApplyColor` → `bdColors` map | Shipped Store B `colors` + swatch→selection |
| Linked note in column | column item `nid` + thumb/preview | Shipped `ref` resolution + excerpt on column |
| To-do stack | `check` furniture with add/toggle | Shipped blank seed + context **Add task** |

## Explicitly not claimed this tip

- Milanote account sync, sharing permissions, or web import
- Milanote-specific gestures not present in the Liquid Neon prototype
- Template removals (Q2 HOLD — Progress/Plotlines/board templates untouched)

## Owner follow-up

If Skyy wants Milanote parity beyond the prototype, capture a short OWNER ASK list (import, comments, version history, etc.) before a future lane invents semantics.
