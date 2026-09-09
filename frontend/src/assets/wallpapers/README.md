# Bundled theme-match wallpapers (SKY-11589)

One WebP per entry, named `<presetKey>-<n>.webp`, listed in `manifest.json`.
The app (`frontend/src/theme/wallpapers.ts`) reads the manifest at build time;
Vite bundles only the files the manifest names.

Each preset's cycle in Settings → Appearance → Background starts with the
preset's built-in wallpaper (Neon Nebula: `../cosmic-bg.webp`; other presets:
the generated starfield), followed by these files in manifest order.

## Replacing the pack — no code change

1. Put the new originals in a folder with one sub-folder per theme
   (`Neon Nebula`, `Aurora`, `cyberpunk`, `Sunset coast`, `Ice mono`, `Emberfall`,
   `Verdant reach`, `Royal Arcana`, `Noir Rose`, `Winterlight`).
2. Run `python3 scripts/wallpapers/build-pack.py --src "<that folder>"`.
   It re-encodes to WebP (q78, native resolution, no crop) and rewrites
   `manifest.json`, keeping any hand-edited per-entry `position`.
3. Commit the `.webp` files and `manifest.json`. Originals stay out of the repo.

To change a crop anchor, set `"position": "<css background-position>"` on the
entry in `manifest.json` (default `center`).
