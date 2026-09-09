# Liquid Neon wallpaper asset pipeline

SKY-11590, child of SKY-11378.

Turns the owner's PNG originals into the WebP wallpapers the app ships, one set
per Liquid Neon colour preset. Reproducible from the manifest, so a crop can be
redone later without going back to anyone's Desktop.

## Layout

| Path | What it is |
| --- | --- |
| `design-assets/wallpapers/originals/<setKey>/` | The 42 PNG originals, renamed `<setKey>-src-NN.png`. Source of truth. Never bundled. |
| `design-assets/wallpapers/originals/PROVENANCE.json` | Original ChatGPT filename, source folder and SHA-256 for each staged PNG. |
| `scripts/wallpapers/wallpapers.manifest.json` | Curation record: which originals ship, in what order, at what crop anchor, and why. |
| `scripts/wallpapers/build_wallpapers.py` | The build. Crops and encodes. |
| `scripts/wallpapers/build-report.json` | Last build's output: crop box, quality and byte size per image. |
| `frontend/src/assets/wallpapers/bg-<setKey>-<n>.webp` | The 37 shipped images. |
| `frontend/src/assets/wallpapers/LICENSE` | Ownership record. |

## Rebuilding

Pillow is not a repo dependency — this is an offline design tool, not part of
`npm run build`.

```bash
pip install Pillow
python3 scripts/wallpapers/build_wallpapers.py            # rewrite the WebPs
python3 scripts/wallpapers/build_wallpapers.py --check    # verify, byte-exact, no writes
```

To change a crop, edit `anchor` in the manifest and rebuild. To recurate, move
entries between `images` and `rejected` and rebuild — the `n` in each filename
is the position in `images`, so reordering renames files.

`frontend/src/theme/wallpaperAssets.test.ts` is the CI-side half of that
contract. It checks the shipped file set matches the manifest and the byte
budget holds, without needing Pillow.

## Decisions

**Aspect ratio: 16:9.** The sources arrived in four buckets — 1.78 (x16), 2.33
(x14), 2.40 (x11), 2.39 (x1). 16:9 matches the largest bucket natively, matches
real desktop and laptop window shapes, and matches the existing `cosmic-bg.webp`
(1920x1080) exactly. Art direction is the owner's call; this is the engineering
recommendation carried into the build, and re-cropping to another ratio is a
one-line manifest change plus a rebuild.

**Crop anchors are hand-picked, per image.** AI-composed ultrawide art puts its
focal glow off-centre often enough that a blind centre crop slices subjects — in
this pack it would have cut the Cyberpunk skyline in half, pushed the Emberfall
nebula band out of frame, and lost the Winterlight sunrise entirely. Every image
was reviewed with its candidate 16:9 window drawn on it, alongside a
luminance-weighted centroid as a cross-check. 14 of the 37 needed an offset; the
rest are genuinely symmetric and sit at 0.5. Each anchor carries a one-line
reason in the manifest.

`anchor` is the fraction of the source that lands at the centre of the crop,
along whichever axis has pixels to spare. It is clamped to what the source can
honour, so an impossible anchor degrades to the nearest legal offset instead of
producing a short frame.

**WebP, not AVIF.** Measured on the worst case in the pack
(`royal-src-03.png`, a dense starfield): WebP q58 is 79 KB, AVIF q45 is 71 KB.
AVIF is not enough smaller to be worth the slower decode on an image that gets
swapped live behind the whole app, and WebP is already the established format
here.

**Quality floors at 70.** The build searches for the highest quality whose
output lands under 52 KB. Fixed quality would let the busy nebulae balloon while
the calm gradients wasted their budget. The floor exists because below ~q70 the
detail-dense frames start dropping their faintest stars. Five images sit above
the soft target because they hit the floor: `bg-royal-4` (93 KB), `bg-aurora-1`
(72 KB), `bg-aurora-2` (61 KB), `bg-winter-3` (60 KB), `bg-royal-3` (52 KB).

**Nothing is upscaled.** No source clears 1080p vertically. Each image ships at
its native cropped resolution and `background-size: cover` handles the rest.

## Shipped set

37 images, 1.79 MB total, 49.4 KB average. `cosmic-bg.webp` is 44.8 KB.

| Preset | Key | Shipped | Source folder |
| --- | --- | --- | --- |
| Neon Classic | `classic` | 4 | Neon Nebula |
| Aurora | `aurora` | 4 of 6 | Aurora |
| Cyberpunk | `cyber` | 3 | cyberpunk |
| Sunset Coast | `sunset` | 4 | Sunset coast |
| Ice Mono | `ice` | 4 | Ice mono |
| Emberfall | `ember` | 3 | Emberfall |
| Verdant Reach | `verdant` | 4 | Verdant reach |
| Royal Arcana | `royal` | 4 of 5 | Royal Arcana |
| Noir Rose | `noir` | 4 of 5 | Noir Rose |
| Winterlight | `winter` | 3 of 4 | Winterlight |

Cyberpunk, Emberfall and Winterlight ship three: the first two because only
three originals exist for each, Winterlight because UXDesigner dropped its
fourth (see below). Aurora, Royal Arcana and Noir Rose drop their weakest
frames; the manifest's `rejected` block records which and why.

## UX disposition (SKY-11599)

**Ordering confirmed as-is for nine of the ten sets.** The engineer's read —
strongest thematic fit first, ties broken toward the calmer frame — holds up.
Liquid Neon wallpapers sit behind a frosted-glass editor panel (`liquidNeon.css`
`.ln-bg-wallpaper` + the pre-blur pass in `preBlurWallpaper.ts`): the sharp image
is mostly seen at the margins the glass doesn't cover, and text itself renders on
the blurred glass fill, not directly on the source pixels. That removes the
"busy centre competes with reading" risk a straight text-on-image read would
raise, so no set needed reordering for reading comfort.

**Winterlight drops `winter-src-02` (the sunrise) to `rejected`, shipping 3.**
It broke the set's mood — the other three (`winter-src-04`, `-03`, `-01`) are
consistently moonlit/aurora-lit night scenes; the sunrise is warm daylight and
reads as a Sunset Coast frame wearing a Winterlight badge. That is the exact
failure the manifest already excluded `aurora-src-05` for ("warm sunrise
dominates; reads as Sunset Coast rather than Aurora") — same call, same
reasoning, applied consistently. It also removes the brightness/contrast risk
QA had flagged on that frame rather than shipping it as the set's most jarring
default option. No replacement original exists (4 sourced, 4 staged), so
Winterlight joins Cyberpunk/Emberfall as a 3-image set; that is within the
tested 3–4 range (`wallpaperAssets.test.ts`).

**Softness above 1080p.** (QA: SKY-11600) Because no source cleared 1080p, every wallpaper
upscales on a large window. Two buckets:

| Output size | Count | Scale at 1440x900 | Scale at 1920x1080 |
| --- | --- | --- | --- |
| 1672x940 | 13 | 0.96 (downscale) | 1.15 |
| 1460x821 / 1442x811 / 1438x809 | 24 | 1.10 | 1.33 |

The 1.33x bucket is the one to look at first: Neon Classic, Cyberpunk, Sunset
Coast, Ice Mono, Emberfall, Verdant Reach, and Aurora's two ultrawide frames.
If any read soft on a 1080p display the fix is regenerating those specific
originals at a higher source resolution, which is the owner's call.

**Brightness outlier resolved.** `bg-winter-4.webp` (the daylight sunrise QA's
contrast check on SKY-11600 named) is dropped per the UX disposition above —
it no longer ships, so that specific check is moot. The rest of SKY-11600
(the above-1080p softness sweep) still stands.
