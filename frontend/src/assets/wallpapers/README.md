# Bundled theme-match wallpapers (SKY-11589)

One WebP per entry in `pack/`, named `<presetKey>-<n>.webp`, listed in
`manifest.json`. The app (`frontend/src/theme/wallpapers.ts`) reads the manifest
at build time and globs only `pack/`, so nothing else placed in this folder is
bundled or treated as a pack orphan by the guard test.

Each preset's cycle in Settings → Appearance → Background starts with the
preset's built-in wallpaper (Neon Nebula: `../cosmic-bg.webp`; other presets:
the generated starfield), followed by these files in manifest order.

## Replacing the pack — no code change

1. Put the new originals in a folder with one sub-folder per theme
   (`Neon Nebula`, `Aurora`, `cyberpunk`, `Sunset coast`, `Ice mono`, `Emberfall`,
   `Verdant reach`, `Royal Arcana`, `Noir Rose`, `Winterlight`).
2. Run `python3 scripts/wallpapers/build-pack.py --src "<that folder>"`.
   It re-encodes to WebP (q78, native resolution, no crop), deletes generated
   files the new pack no longer produces, and rewrites `manifest.json`, keeping
   any hand-edited per-entry `position` matched by the entry's `source` name.
3. Run `python3 scripts/wallpapers/write-provenance.py --src "<that folder>"`.
   It re-hashes the new originals into `PROVENANCE.json`, keeping the
   hand-written `cropNote` on any source that survived. `--check` verifies
   without writing.
4. Commit `pack/*.webp`, `manifest.json` and `PROVENANCE.json`. The originals
   stay out of the repo — `LICENSE` says why.

To change a crop anchor, set `"position": "<css background-position>"` on the
entry in `manifest.json` (default `center`).

## Framing (SKY-11591)

`pack/` ships at native resolution and is cropped at render time by
`background-size: cover`, so the only thing standing between an image and a
blind centre crop is its `position`. That matters most for the 26 ultrawide
sources (2.33:1 and 2.40:1): AI-composed art of that shape routinely puts its
focal glow well off centre, and a ~16:9 window discards roughly 460–500px of
width. 15 entries carry an off-centre `position` as a result.

Each one was chosen by looking at the image, not computed. The reason is
recorded per file as `cropNote` in `PROVENANCE.json`; `cropNote: null` marks the
four images nobody has reviewed, which render centred by default.

The percentages read against the overflow, not the image: `96% center` means the
visible window sits at the far right of what `cover` crops away. Sources already
near 16:9 (1672x941) have ~1px to spare, so a position on them would be noise —
they are left at the default.

## Resolution and legibility floors (SKY-11600)

Measured findings and the reasoning are in
[`docs/qa/SKY-11600/wallpaper-pack-qa-notes.md`](../../../../docs/qa/SKY-11600/wallpaper-pack-qa-notes.md).
Re-measure a replacement pack with `node scripts/wallpapers/measure-pack.mjs`
before committing it. Two things that pack are easy to get wrong:

**Height is what binds, and the wallpaper is never shown at 1:1.** Every source
is ultrawide, so a 16:9 window scales to fit the *height*. On top of that
`.ln-bg-wallpaper` runs `lnDrift` forever (`scale(1.04)` to `scale(1.1)`), so
the real factor is `max(vw/w, vh/h) x 1.04-1.10`. To never upscale, source
height must clear **1.10 x the window height**: 990px for 1440x900, **1188px
for 1920x1080**, 1584px for 2560x1440. The current pack tops out at 941. Width
is not the constraint and never was.

**Upscaling only shows on detailed images.** Fine detail plus upscale reads
soft; a smooth painterly gradient at 1.95x is indistinguishable from native.
The script reports an edge-density figure per image for exactly this call, so a
regeneration pass can be spent on the images that need it.

**Keep the set dark-key.** Panel fill is `rgba(13,16,28,0.20)` at the shipped
`glassA: 20` and the scrim is 10%, so **72% of the wallpaper's luminance reaches
the back of body text**. A daylight image cannot carry light-on-dark text: it
needs a ~59% global scrim to reach WCAG AA, which ruins every other image in the
pack. `winter-2` is the one that got through and is the worked example in the
notes.

**Check the corners for generator text.** `winter-2` ships a partly garbled
`Winter Lightscape` caption baked into its pixels. `cover` does not reliably
crop a bottom-left corner away. Build a contact sheet with
`node scripts/wallpapers/contact-sheet.mjs corners` and look before committing.
