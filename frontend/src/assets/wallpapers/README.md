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
