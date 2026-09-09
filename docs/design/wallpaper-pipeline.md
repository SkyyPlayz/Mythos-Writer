# Liquid Neon wallpaper pipeline

SKY-11591, child of SKY-11378. How the 38 shipped per-theme wallpapers are made
from the owner's 42 PNG originals, and every judgement call baked into them.

## Layout

| Path | What it is |
| --- | --- |
| `design-assets/wallpapers/originals/<setKey>/<setKey>-src-NN.png` | The owner's PNGs, byte-identical. Never packaged. |
| `design-assets/wallpapers/originals/PROVENANCE.json` | Per file: the owner's original folder, filename and SHA-256. |
| `design-assets/wallpapers/LICENSE` | Ownership and licence record. |
| `scripts/wallpapers/wallpapers.manifest.json` | Curation, order, crop anchors, encode budget. The input you edit. |
| `scripts/wallpapers/build_wallpapers.py` | The build. Offline design tool, not part of `npm run build`. |
| `scripts/wallpapers/build-report.json` | Per image: crop box, quality, byte size. Written by the build. |
| `frontend/src/assets/wallpapers/bg-<setKey>-<n>.webp` | The shipped output. Generated — do not hand-edit. |

Rebuild after editing the manifest:

```bash
pip install Pillow                                   # not a repo dependency
python3 scripts/wallpapers/build_wallpapers.py       # write the WebPs
python3 scripts/wallpapers/build_wallpapers.py --check   # verify, no writes
```

`frontend/src/theme/wallpaperAssets.test.ts` enforces in CI that the committed
files match the manifest's names, count and byte budget, and that
`build-report.json` still describes the bytes on disk. It needs no Python, so the
check runs on every PR whether or not anyone has Pillow.

## Naming

`bg-<setKey>-<n>.webp`, `n` starting at 1. `setKey` is the
`LiquidNeonPresetKey` from `frontend/src/theme/presets.ts` — `classic`, `aurora`,
`cyber`, `sunset`, `ice`, `ember`, `verdant`, `royal`, `noir`, `winter`. The
owner's folder names do not match those keys (`Neon Nebula` is `classic`,
`cyberpunk` is `cyber`), so the mapping is recorded per set in the manifest's
`sourceFolder` and must not be re-derived from folder names.

`n` is a curation rank, strongest thematic fit first, so a picker showing fewer
than four options can take the first `n` and still show the best of the set.

## Decisions

### 16:9, and no upscaling

The sources arrive in four buckets: 1672x941 (x16), 1916x821 (x14), 1942x809
(x11) and 1938x811 (x1). 16:9 is the target because it is closest to the app's
real window shapes and already matches the largest bucket almost exactly.

Nothing is upscaled. Each image is cropped to the largest 16:9 window that fits
inside its source and encoded at that native size, so outputs range from
1438x809 to 1672x940. `background-size: cover` does the rest. That is a
deliberate trade: sharpness on large displays is given up rather than faking
resolution the source never had.

### Crop anchors are hand-picked, not centred

AI-composed ultrawide art routinely puts its focal glow off-centre, so a blind
centre crop slices the subject. Every one of the 26 ultrawide sources was looked
at individually against a centre-crop guide and a luminance-centroid marker, and
given an anchor in the manifest with a note saying why.

`anchor` is the normalized position in the SOURCE that lands at the CENTRE of the
crop. `0.5` is centred; lower pulls the window left, higher pulls it right. It is
clamped to the range where the window still lies wholly inside the source, so
`0.61` on a 1916-wide source is already as far right as 16:9 can go. An anchor
the source cannot honour degrades to the nearest legal offset and warns, rather
than producing a short frame.

Anchors that carry real weight:

| Image | Anchor | Why |
| --- | --- | --- |
| `bg-cyber-1` | 0.61 | Neon skyline sits at ~0.73 across. A centre crop cuts the towers in half. |
| `bg-winter-4` | 0.375 | Sunrise sits at ~0.20. Anchored as far left as 16:9 allows to keep the sun and the foreground pines. |
| `bg-classic-2` | 0.62 | Pink nebula mass sits right of centre and would land on the frame edge. |
| `bg-ice-4` | 0.44 | Bright plume in the upper left (luminance centroid 0.34). |
| `bg-ember-2` | 0.42 | Fire band runs out of the lower-left corner. |

The 16 sources already at 1.777 need no horizontal decision — the crop only
drops a single pixel row.

### Curation

Four per set where four strong candidates exist. `cyber` and `ember` ship three
because the owner supplied three. Four sources were rejected outright, each with
a reason recorded in the manifest under `rejected`:

- `aurora-src-03` — near-duplicate of `src-01` with a busier foreground.
- `aurora-src-05` — warm sunrise dominates; reads as Sunset Coast, not Aurora.
- `royal-src-01` — busiest ring-and-constellation detail of the five; too much competing structure behind panel glass.
- `noir-src-03` — muddiest frame of the five; the right two thirds are near-black with no readable subject.

Ordering within a set is a UX call, not an engineering one. The current order is
strongest thematic read first, breaking ties toward the calmer frame, on the
grounds that these sit behind a writing surface. **UXDesigner owns the final
order.** Reordering is a manifest edit plus a rebuild — no code changes — because
nothing depends on which source backs which `n`.

### Encoding

WebP, `method=6`. Fixed quality would let the busiest nebulae balloon while calm
gradients wasted their budget, so the build binary-searches per image for the
highest quality landing under `targetBytes` (52 KB), with a hard `maxBytes`
(62 KB) that fails loudly.

AVIF was not adopted. WebP already lands the whole pack at 1.76 MB against the
~44 KB per-image discipline set by the existing `cosmic-bg.webp`, and Chromium's
WebP decode path is the one the app already exercises.

| | |
| --- | --- |
| Images | 38 |
| Total | 1.76 MB |
| Average | 47.4 KB |
| Largest | `bg-royal-4.webp`, 59.4 KB |

`bg-royal-4` is the one image that cannot reach 52 KB — `royal-src-03` is an
unusually dense nebula-and-starfield frame. It sits at the quality floor (40) and
the build prints a warning saying so. A q40-vs-q70 comparison at 100% showed no
visible difference in the gold rings, star points or the smooth violet field, so
the floor is a real floor for this content and not a corner cut.

## For QA

**Softness.** No source cleared 1080p vertically, so every wallpaper is upscaled
by `cover` above a ~1460-wide window. Check these thresholds:

| Output | Sets | 1440 wide | 1920 wide | 2560 wide |
| --- | --- | --- | --- | --- |
| 1672x940 (13) | `royal`, `noir`, `winter` 1-3, `aurora` 1-2 | 0.86x | 1.15x | 1.53x |
| 1460x821 (13) | `cyber`, `sunset`, `ice`, `aurora` 3-4 | 0.99x | 1.32x | 1.75x |
| 1442x811 (1) | `winter` 4 | 1.00x | 1.33x | 1.78x |
| 1438x809 (11) | `classic`, `ember`, `verdant` | 1.00x | 1.34x | 1.78x |

The bottom three rows are the ones to watch: at 1920 wide they are already
upscaling ~1.33x, and `classic`, `ember`, `verdant`, `cyber`, `sunset` and `ice`
have no headroom at all. If any of those read soft on the owner's display, the
fix is for the owner to regenerate those specific sources at a higher resolution
— not to upscale what we have.

**Contrast.** `bg-winter-4` is the only light-key image in the pack: a pale
sunrise over snow. Everything else is dark-key. Check foreground text and glass
panel legibility against it specifically; it is the most likely wallpaper to need
a stronger scrim.

## Licence

Owner-authored, AI-generated, fully owned, confirmed by Skyy on 2026-09-09. No
stock licence, no attribution requirement, no indemnification gap. Recorded in
`design-assets/wallpapers/LICENSE`, alongside the Kokoro bundle record in
`electron-main/resources/kokoro/LICENSE`.
