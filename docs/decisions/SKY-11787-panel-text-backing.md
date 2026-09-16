# SKY-11787 — per-panel text-backing over bright wallpapers

Status: implemented, **pending UXDesigner sign-off on the visual cost** (the
issue requires that loop before merge).
Supersedes the cancelled SKY-11488. Decision routed on SKY-11782.

## What shipped

`--ln-text-backing` — one adaptive contrast floor, solved per wallpaper, painted
inside each base panel's **padding box** (its interior, inside the border).

- Solver: `frontend/src/theme/textBacking.ts`. Given the wallpaper's brightest
  cell and the live `scrim` / `glassA`, it returns the smallest
  `rgba(13,16,28,α)` that brings `#c8d3e7` body text to 4.5:1 — and `0` when
  the stack already clears it.
- Measurement: the renderer decodes the active wallpaper once per URL
  (canvas, cached) and takes the brightest of 64x36 cells. One cell is about
  one word of 16px/1.6 body copy at the shipped `cover` fit.
- Emission: `applyLiquidNeonV2Tokens` writes `--ln-text-backing` next to the
  existing `--glass-fill` bridge. `--glass-fill`, `--blur-panel`, `glassA` and
  `scrim` are **unchanged** — no global default moved.
- Consumption: `--glass-panel-bg` in `tokens.css` is the whole recipe —
  `linear-gradient(backing, backing) padding-box, var(--glass-fill) border-box`.
  Padding box, not content box: the content box is where the glyphs are, but
  its square corners inside a 20px-radius panel rendered as a visible seam
  (`docs/screenshots/sky11787/`). The padding box is the panel's own frame, so
  the backing has no edge of its own.
  17 top-level base panels read it instead of `var(--glass-fill)`.

Nested `--bg-panel` cards are untouched: they sit on top of an already-floored
panel, so giving them a backing too would only double-darken.

## Why not the other two options (SKY-11782)

1. **Raise `glassA` / `scrim` globally** — an owner-level aesthetic change to
   every user and every wallpaper, to fix a highlight-only case. Median
   contrast across the pack is already 7.66:1–12.98:1.
2. **Accept and document** — the worst in-scope case is 1.52:1 (`aurora-4`).
   Not an edge case, and accessibility is structural per COMPANY-STANDARDS.

Option 2 (this) follows the SKY-11491/11492 precedent: when the slider-driven
glass aesthetic fights legibility, the affected tier gets its own higher-
contrast treatment rather than a global default bump.

## Measured result

`node scripts/wallpapers/measure-pack.mjs`, section 3, at shipped defaults
(`glassA: 20`, `scrim: 10`, body `#c8d3e7`, brightest cell of the 12x8
panel-sized grid at 1920x1080):

| | before | after |
| --- | --- | --- |
| Images clearing 4.5:1 body text | 8 / 42 | **42 / 42** |
| Worst image | 1.19:1 (`winter-2`) | 4.92:1 (`ice-2`) |
| Worst headings | 1.62:1 | 6.25:1 |

The **default** wallpaper is not in the pack manifest, so the script never sees
it; measured separately with the same math: `cosmic-bg.webp` (Neon Nebula's
built-in, and what a fresh install shows) has a peak cell of 0.188, solving to
alpha **0.242** — 3.74:1 → 4.50:1. Out of the box the change is small.

## What it looks like

`docs/screenshots/sky11787/` — a panel of body copy over the two ends of the
range, before and after, at the shipped defaults:

- `aurora-4-before-after.png` — the worst in-scope wallpaper (alpha 0.827).
  Before: the aurora runs straight through the paragraph. After: the panel is a
  denser pane of the same glass, the aurora still reads through it, the neon rim
  and the wallpaper outside the panel are untouched.
- `noir-1-before-after.png` — a wallpaper that already passes (alpha 0). The two
  frames are identical, which is the point.

## Verified against real pixels, not just the model

The solve is arithmetic in luminance space, so it was also checked against what
Chromium actually composites: the full stack (wallpaper image at `cover` + the
drift zoom, `#04050b` scrim at 10%, the vignette, then a panel painted through
`--glass-panel-bg`) rendered at 1920x1080, screenshotted, and re-decoded to
find the brightest word-sized cell of the panel.

| wallpaper | alpha | before | after |
| --- | --- | --- | --- |
| `aurora-4` | 0.827 | 1.81:1 | 9.73:1 |
| `winter-4` | 0.828 | 2.50:1 | 10.28:1 |
| `ice-2` | 0.706 | 2.79:1 | 8.82:1 |
| `noir-1` | 0 | 7.53:1 | 7.53:1 (unchanged, as intended) |

Note the "after" column lands near 9:1, not 4.5:1 — the solver is roughly 2x
conservative at this viewport, for two deliberate reasons: it measures the
whole image (the `cover` crop moves with the window aspect and the drift zoom,
so any part of the image can end up behind text) and it ignores the vignette
(which is transparent across the middle of the frame, where panels sit). If
UXDesigner wants the glass back, that headroom is where it is — but spending it
means assuming a viewport aspect ratio.

## The cost, stated plainly — this is the UXDesigner call

The backing alpha is **uniform per wallpaper**, because it has to fix the
*brightest* cell. Most of these wallpapers are dark with one blown-out
feature — a moon, a neon sign, an aurora curtain — so one small bright blob
sets the alpha for the whole UI.

Across the 41 in-scope images (excluding `winter-2`, SKY-11756):

| solved alpha | images |
| --- | --- |
| 0 (renders pixel-identical to today) | 2 |
| 0 – 0.35 | 4 |
| 0.35 – 0.65 | 10 |
| 0.65 – 0.83 | 25 |

Median solved alpha is **0.718**. Combined with the 20% glass that is an
effective **77% opacity behind body text** (median; 86% worst case, 20%
best case).

So: on most wallpapers, panel *interiors* read as near-opaque. What is
preserved is the border, the rim, the padding ring, the gaps between panels,
and every surface outside a base panel — the wallpaper is still fully there,
and still reads through the panel, just denser behind paragraphs.

That is a real change to the Liquid Neon read, and it is the design owner's
call, not an engineering one. Two knobs exist if it is judged too heavy:

- solve for a lower ratio (3:1 large-text AA) — cuts the median alpha roughly
  in half but leaves body copy below AA,
- keep the cap (`MAX_BACKING_ALPHA`) and accept AA failure on the worst
  handful of images.

## Design sign-off — SKY-11817, approve as-is

UXDesigner reviewed the composited before/after renders and ruled on all four
open questions. Recorded here so the trade is not re-litigated:

- **Density: accepted.** Both alternative knobs above resolve to leaving body
  text below AA on real wallpapers, and accessibility is structural per
  COMPANY-STANDARDS — correctness outranks aesthetic consistency in our own
  priority order. Weighed as landing right because the border, rim and glow are
  untouched (the panel still reads as glass, just denser) and the fresh-install
  default wallpaper only solves to alpha 0.242.
- **Padding box over content box: confirmed.** Content-box's square corners
  inside a 20px-radius panel break Prägnanz — the panel stops reading as one
  shape.
- **The ~2x measurement headroom stays unspent.** Claiming it means baking in a
  viewport aspect ratio for a glass gain on wallpapers that already clear AA at
  ~9:1. Noted at `peakCellLuminance` in `theme/textBacking.ts` as the knob a
  future ticket would turn.
- **The spatially varying scrim below is an owner-level call**, filed
  separately as non-blocking; it does not gate this change.

## The alternative worth considering (out of scope here)

A **spatially varying scrim** would cost far less glass: generate a darkening
mask from the wallpaper (one canvas pass, same machinery as
`theme/preBlurWallpaper.ts`), add it to `.ln-bg-stack` as a sibling layer
carrying the same `lnDrift` animation so it stays in register, and it would dim
only the blown-out cells. Panels would keep their full translucency everywhere
else.

Not done here because it is a different decision from the one SKY-11782 made
(it changes the *wallpaper's* appearance rather than the panel's, and so needs
the owner's aesthetic sign-off, not just UXDesigner's). Recorded so it is not
re-derived from scratch. It is *not* the rejected option 1 — it never touches a
global default and never flattens an image that already passes.

Note this also rules out the obvious "mask inside the panels" variant: the only
way to align a mask to the wallpaper from inside a panel is
`background-attachment: fixed`, which cannot follow the 70s `lnDrift` scale
animation and would desync from the pixels it is meant to be darkening.

## Guards

- `frontend/src/theme/textBacking.test.ts` — the solver: monotonic, never
  overshoots by more than 0.01, always clears 4.5:1 for any peak from black to
  white, returns 0 when the wallpaper already passes, shrinks when the user
  raises Glass opacity or the scrim, caps and tolerates junk input. Plus the
  cell-averaging behaviour (a one-pixel specular dot must not saturate a cell)
  and the engine wiring.
- `frontend/src/panel-text-backing.test.ts` — every base panel in the list
  still reads `--glass-panel-bg` and not `var(--glass-fill)`, the recipe still
  clips the backing to the padding box with the glass underneath, and the token
  still flattens under high contrast / reduced transparency /
  no-backdrop-filter.
- `scripts/wallpapers/measure-pack.mjs` section 3 — the acceptance numbers, on
  the real WebP decoder and the real pack. Its `solveBackingAlpha` mirrors the
  module's; keep the two in step.
- `e2e/tests/sky-11209-liquid-neon-views.spec.ts` — the floor, proven in real
  Electron pixels on `.msv`. See below.

## The SKY-11209 threshold this displaced

SKY-11209 pixel-proved that `.vgv-canvas` and `.msv` show the wallpaper instead
of a flat opaque `--bg-base` fill, by asserting each region's mean luminance
reads `> 50` over a deliberately blinding synthetic wallpaper (flat `#fff04d`
and friends — brighter than any image in the shipped pack).

`.msv` is a full-screen **base panel carrying body text**, so it takes the
backing. That makes the two assertions incompatible, and not marginally:

| `.msv` mean luma, blinding wallpaper | without backing | with backing |
| --- | --- | --- |
| mean | 86.0 | 33.8 |
| median | 84.9 | 28.8 |
| p90 | 123.6 | 41.0 |

This is not a threshold that could be nudged. A 4.5:1 floor behind `#c8d3e7`
caps the composited panel background near sRGB 89 *whatever* the wallpaper is,
so `> 50` became unreachable for every wallpaper, not just this one — the AA
floor is now the binding constraint, not the glass fill.

So the `.msv` assertions were re-expressed as the invariant SKY-11209 actually
protects — the view **tracks** the wallpaper rather than being a fixed fill —
plus a new guard that buys back more than it gave up:

- `brightLuma > deepLuma * 1.5` and `brightLuma - deepLuma > 10`. The original
  bug read bright ≈ deep (ratio 1.0); this build reads 33.8 vs 16.7 = 2.02x.
- `brightMedian < 45` — **new**. Over a blinding wallpaper the bulk of the
  panel must stay dark enough for body text. Median, not mean, so bright glyphs
  and neon accents can't mask a regression. 28.8 with the backing, 84.9
  without: removing the backing fails this by a factor of ~1.9.

`.vgv-canvas` keeps the original absolute `> 50` / `> 30` thresholds untouched
— it is a graph canvas, not a text-bearing panel, takes no backing, and still
guards SKY-11209 in its original form.

## Out of scope

- `winter-2` — fails at the *median* cell, not just the brightest, and carries
  a baked-in caption. SKY-11756.
- Source regeneration. SKY-11757.
- Overlay tier (dialogs, popovers, menus) — already fixed by
  SKY-11491/SKY-11492.
- Custom user wallpapers are measured by the same runtime path and get the same
  floor; there is nothing pack-specific in the solver.
