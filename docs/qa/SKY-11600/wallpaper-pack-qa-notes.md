# SKY-11600 — QA pass on the bundled wallpaper pack

Two questions were handed over: which wallpapers read soft above 1080p, and
whether the one bright image stays legible. Both are answered per file below.

Measured from the assets that actually ship (`frontend/src/assets/wallpapers/pack/`,
42 images) and the token math that actually renders them. Re-run with
`node scripts/wallpapers/measure-pack.mjs`; raw output is in `measurements.txt`.

---

## Read this first — the ticket describes a pack we do not ship

The ticket was written against SKY-11590 (PR #1501), which was **cancelled**.
Three of its premises no longer hold:

| Ticket says | What ships |
| --- | --- |
| 38 images, `bg-*.webp` | 42 images, `pack/*.webp` (SKY-11589) |
| `bg-winter-4.webp` is the bright one | **`winter-2.webp`** is the bright one; `winter-4.webp` is a dark aurora night |
| Size buckets 1672x940 and ~1440x810 | Four buckets; there is no ~1440x810 image at all |
| See `docs/design/wallpaper-pipeline.md` | That file does not exist; the inventory is `frontend/src/assets/wallpapers/README.md` |

The two *questions* survive the correction intact, so both are answered. Only
the file names and the numbers moved.

## One thing neither question accounted for: the drift zoom

`.ln-bg-wallpaper` runs `lnDrift` permanently: `scale(1.04)` to `scale(1.1)`.
The wallpaper is therefore **never shown at its cover size** — it is always
between 4% and 10% larger. Every scale figure below is `cover x drift`, which
is the real number. The ticket's 1.33x is really 1.39x-1.47x.

---

## 1. Softness — which images, not which themes

Upscale alone does not make an image look soft. An image needs fine detail
*and* an upscale for the loss to be visible. A smooth painterly gradient at
1.95x is indistinguishable from native, and `ember-1-softness-control-no-visible-loss.png`
shows exactly that — three panels, no discernible difference.

So the two inputs are reported separately:

- **scale** = `max(1920/w, 1080/h) x drift` — source pixels per screen pixel.
- **edge %** = share of native pixels carrying real structure (4-neighbour
  Laplacian above 8 levels). This is the "is there anything to lose" term.

### The pack splits by HEIGHT, not width

Every image is ultrawide, so a 16:9 window is always height-bound. Two groups:

| Native height | Count | 1440x900 | 1920x1080 | 2560x1440 |
| --- | --- | --- | --- | --- |
| 809-821px | 26 | **1.14-1.22x** | 1.37-1.47x | 1.82-1.96x |
| 941px | 16 | 0.99-1.05x (1:1) | 1.19-1.26x | 1.59-1.68x |

The 941px group is effectively native at 1440x900. The 809-821px group is
already upscaled there, which is earlier than the ticket assumed.

**The number to regenerate against is a height, not a width.** To never
upscale, source height must clear 1.10x the window height:

| Window | Minimum source height |
| --- | --- |
| 1440x900 | 990px |
| 1920x1080 | **1188px** |
| 2560x1440 | 1584px |

Nothing in the pack clears 1080p. Width is already generous everywhere and is
not the constraint.

### Regenerate these — soft at 1440x900, clearly soft at 1080p and above

Named individually, highest edge density first.

| File | Theme | Native | Edge % | Why it shows |
| --- | --- | --- | --- | --- |
| `winter-2` | Winterlight | 1938x811 | 13.0 | frosted branches, treeline, ridge detail |
| `sunset-1` | Sunset Coast | 1916x821 | 10.5 | surf foam and wave edges |
| `sunset-3` | Sunset Coast | 1916x821 | 8.9 | rippled water |
| `cyber-2` | Cyberpunk | 1916x821 | 8.7 | 1-2px neon beams, city skyline |
| `sunset-4` | Sunset Coast | 1916x821 | 8.4 | fine shoreline texture |
| `cyber-3` | Cyberpunk | 1916x821 | 7.9 | grid lines |
| `cyber-1` | Cyberpunk | 1916x821 | 7.8 | grid lines |
| `sunset-2` | Sunset Coast | 1916x821 | 7.8 | foliage silhouette |
| `verdant-1` | Verdant Reach | 1942x809 | 6.3 | dense foliage |
| `classic-1` | Neon Classic | 1942x809 | 6.3 | dense starfield |

Evidence: `winter-2-softness-native-vs-1920-vs-2560.png`,
`sunset-1-softness-native-vs-1920-vs-2560.png`,
`cyber-2-softness-native-vs-1920-vs-2560.png`.

Thin bright lines are the worst case. `cyber-1/2/3` carry beams 1-2px wide at
native; there is no width left to lose, so they go from a line to a glow.

**Whole themes in that list: Sunset Coast (4 of 4) and Cyberpunk (3 of 3).**
Regenerating those two themes' sources fixes 7 of the 10.

### Leave these alone — in the upscaled group, but nothing to lose

| Theme | Files | Edge % | Verdict |
| --- | --- | --- | --- |
| Emberfall | `ember-1/2/3` | 1.0-2.4 | painterly bokeh; 1.95x is invisible |
| Ice Mono | `ice-1/2/3/4` | 2.2-3.9 | smooth gradient ice |
| Neon Classic | `classic-2/3/4` | 2.1-3.4 | sparse starfield |
| Verdant Reach | `verdant-2/3/4` | 0.8-4.4 | `verdant-3` is the smoothest image in the pack |
| Aurora (ultrawide) | `aurora-1/2/3` | 1.7-5.7 | `aurora-1` marginal, 2 and 3 smooth |

This directly answers the ticket's worry about Ice Mono and Emberfall: they are
in the 1.33x bucket, and they still do not read soft, because the content has no
fine detail to blur. Regenerating them would cost the owner time for no visible
gain.

### Revisit only if we support above 1080p

The 941px group (`noir-1..5`, `royal-1..5`, `aurora-4/5/6`, `winter-1/3/4`) is
native at 1440x900 and mild at 1080p. Four of them do carry heavy detail
(`royal-3` 13.6%, `winter-1` 11.2%, `aurora-4` 10.7%, `royal-1` 8.8%) and would
be the next to look at if 1440p becomes a target.

---

## 2. Brightness — `winter-2` fails, and it is the only one that fails this way

`winter-2.webp` is the daylight sunrise over snow. It is the brightness outlier
the ticket asked about; the file is just named differently now.

**It is not close.** 40.2% of its pixels sit above 160/255 luma. The next
brightest image in the pack is at 4.9%.

### What the composite actually is

At shipped defaults the stack over a wallpaper is, from `liquidNeonEngine.ts`
and `liquidNeon.css`:

- scrim `#04050b` at **10%** (`scrim: 10`)
- vignette, edges only, transparent for the middle 40%
- panel fill `rgba(13,16,28, 0.20)` (`glassA: 20`, reaching `--bg-panel` through
  `--glass-fill`)

So **72% of the wallpaper's luminance survives to sit behind body text.** Body
text is `#c8d3e7`, headings `#f0f3fc`.

### Result, at 1920x1080, 12x8 grid of panel-sized cells

| | `winter-2` | Next worst | Best |
| --- | --- | --- | --- |
| Brightest cell, body text | **1.19:1** | 1.52:1 (`aurora-4`) | 8.37:1 (`noir-1`) |
| **Median cell, body text** | **2.51:1** | 7.66:1 (`sunset-3`) | 12.98:1 (`noir-3`) |
| Headings, brightest cell | 1.62:1 | 2.06:1 | 11.38:1 |

AA needs 4.5:1 for body and 3:1 for large headings.

The median cell is the column that matters. Every other image in the pack has a
median of **7.66:1 or better** and fails only where a panel happens to land on a
moon, a neon sign or an aurora curtain. `winter-2` fails at the *median* — the
whole frame is too bright, not one highlight. At 1.19:1, light-on-dark body text
over it is not "hard to read", it is invisible.

### The call

**Drop `winter-2` from Winterlight's default set.** A stronger scrim is the
wrong fix for this one image:

- Getting `winter-2` to 4.5:1 at the median needs the scrim at **59%**, against
  a default of 10% (solved in `measurements.txt`; the slider maxes at 70, so it
  is reachable but only just). The scrim is a global setting, so it would
  flatten the other 41 images to mud to rescue one.
- Winterlight keeps `winter-1`, `winter-3` and `winter-4`, all dark-key, so the
  theme still has a full set. Nothing needs regenerating to make this safe.
- If the owner wants a daylight option, it should be re-shot dark-key or paired
  with a per-image scrim override, which does not exist today.

### Do not read the other 34 as wallpaper defects

34 of 42 images fail 4.5:1 in their single brightest cell. That is not 34 bad
images — it is the 20% glass floor, already filed as **SKY-11488**. Median-cell
contrast of 8-13:1 says the panels are fine almost everywhere and thin out only
over a highlight. Fixing the glass floor fixes all 33; only `winter-2` is a
genuine per-image problem.

---

## 3. Extra defect found — `winter-2` has a caption baked into the pixels

Not in scope, worth more than the rest of this report.

`winter-2.webp` carries generator text in the bottom-left corner, roughly
`Winter Lightscape`, partly garbled. It is baked into the image, so `cover`
crops it only by luck and at 1920x1080 it lands inside the visible area.

Evidence: `winter-2-baked-in-caption-3x.png` (3x, bottom-left corner).

Checked the bottom-left corner of all 42 images. **`winter-2` is the only one.**

This is independent of the brightness call and survives it: even if the
brightness verdict were reversed, the file cannot ship with text in it. Filed
separately so it is not lost if the brightness question goes to the owner.

---

## Method and limits

Reproduced in `scripts/wallpapers/measure-pack.mjs`:

- Chromium decodes the WebP. It is the only decoder on the CI/dev box and it is
  the decoder that ships in the app. Images go in as data URLs so `getImageData`
  is not tainted by a `file://` opaque origin.
- Scrim, vignette, glass alpha, drift zoom, `cover` fit and the manifest's
  per-entry `position` are all reproduced from the shipping source. If those
  defaults change, the script's constants have to change with them — they are
  listed in one block at the top with the file each came from.
- Contrast is WCAG 2.x on sRGB-linearised luminance.

**Not verified here:** none of this was observed in a running app. It is
computed from the shipped assets and the shipped token math, which is why the
constants are pinned to their source files. A legibility check in the real
window would be a useful confirmation, and would need the picker reachable in a
build. The softness findings do not need it: the comparison images are the
actual decoder doing the actual resample.

Ordering of images within a theme is UXDesigner's, on SKY-11599, and is
untouched here.
