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
3. Commit `pack/*.webp` and `manifest.json`. Originals stay out of the repo.

To change a crop anchor, set `"position": "<css background-position>"` on the
entry in `manifest.json` (default `center`).
