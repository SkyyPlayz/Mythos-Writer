# SKY-1990 Advanced Tables visual QA

Viewport: 1440x900
Fixture: Advanced Tables DOM classes used by the Obsidian plugin (`.table-editor-table`, `.table-editor-cell-input`, `.tablecontrols`, `.table-editor-btn`, `.table-editor-resizer`, `.menu`).

Evidence:
- `advanced-tables-before-1440x900.png`
- `advanced-tables-after-1440x900.png`
- `advanced-tables-before-fixture.html`
- `advanced-tables-after-fixture.html`

Verification result:
- Table chrome: PASS — glass table container, cyan-tinted header, subtle alternate row tint, and glass-rim borders visible in the after screenshot.
- Cell edit input: PASS — focused edit input renders a 2px neon-cyan ring plus glow.
- Toolbar controls: PASS — active center-align button has neon-cyan active state; controls are on a glass bar.
- Resize handle: PASS — hovered row resize handle shows a bright neon-cyan column glow.
- Context menu: PASS — menu has glass background, neon glow, and cyan selected/hover item.
- Contrast: PASS — sampled text/background contrast ratios are all >= 4.5:1.

Contrast samples from the rendered after fixture:

| Surface | Contrast |
|---|---:|
| Header text | 14.64:1 |
| Body cell text | 12.74:1 |
| Alternate row text | 11.63:1 |
| Focused input text | 14.43:1 |
| Active toolbar text | 9.24:1 |
| Menu title | 7.31:1 |
| Selected menu item | 10.30:1 |
| Normal menu item | 12.41:1 |

QA fix made during verification:
- Added `.theme-dark .menu` to the Advanced Tables token scope so Obsidian's global context menu inherits the Liquid Neon token variables when appended outside the table DOM.
- Changed focused cell edit ring to a literal `0 0 0 2px var(--ln-at-neon)` ring.
- Changed selected/hover menu item text to `var(--ln-at-neon)` for an explicit neon state.
