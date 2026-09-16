#!/usr/bin/env python3
"""
Build the bundled Liquid Neon wallpaper pack (SKY-11589).

Converts the owner's PNG originals (NOT committed — they live outside the repo)
into WebP files under frontend/src/assets/wallpapers/pack/ and rewrites the
manifest.json that the app reads at build time (frontend/src/theme/wallpapers.ts).

Replacing the pack later is a file drop + manifest edit, never a code change:
  1. Point --src at a folder with one sub-folder per theme (folder names below).
  2. Run:  python3 scripts/wallpapers/build-pack.py --src "<folder>"
  3. Commit the regenerated pack/*.webp files + manifest.json.

The run is a full replacement: generated files from a previous pack that are
not produced again are deleted (only `<key>-<n>.webp` for known keys — nothing
else in the folder is touched), so a smaller pack leaves no orphans behind for
the manifest guard test to trip on.

Hand-edited manifest metadata (per-entry "position") is carried over by the
entry's `source` (the original's file name), so re-ordering, adding or removing
originals never moves a crop anchor onto a different image. Entries written by
an older manifest without `source` fall back to matching by output name.

Encoding: WebP, quality 78, method 6, native resolution (no upscaling, no crop).
Crop/anchor is applied at render time (background-size: cover, position from
the manifest, default "center"), so ultrawide windows see the full 2.4:1
sources and 16:9 windows get a centred crop.

Requires Pillow with WebP support (python3 -c "from PIL import features;
print(features.check('webp'))").
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
ASSET_DIR = os.path.join(REPO, 'frontend', 'src', 'assets', 'wallpapers')
OUT_DIR = os.path.join(ASSET_DIR, 'pack')
MANIFEST = os.path.join(ASSET_DIR, 'manifest.json')

# Source folder name (case-insensitive) -> Liquid Neon preset key
# (frontend/src/theme/presets.ts). The preset key is the stored setKey; the
# display name lives in presets.ts (classic = "Neon Nebula").
FOLDER_TO_KEY = {
    'neon nebula': 'classic',
    'aurora': 'aurora',
    'cyberpunk': 'cyber',
    'sunset coast': 'sunset',
    'ice mono': 'ice',
    'emberfall': 'ember',
    'verdant reach': 'verdant',
    'royal arcana': 'royal',
    'noir rose': 'noir',
    'winterlight': 'winter',
}

QUALITY = 78

# What this script generates and is therefore allowed to delete on a re-run.
GENERATED_RE = re.compile(r'^(' + '|'.join(sorted(set(FOLDER_TO_KEY.values()))) + r')-\d+\.webp$')


def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', required=True, help='Folder containing one sub-folder per theme of PNG originals')
    ap.add_argument('--quality', type=int, default=QUALITY)
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        print(f'source folder not found: {args.src}', file=sys.stderr)
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)

    # Keep manifest metadata the owner may have hand-edited (per-entry position).
    # Matched by the original's file name first (stable across re-ordering),
    # by output name only for entries an older manifest wrote without `source`.
    prev: dict = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            prev = json.load(f)
    prev_by_source: dict[tuple[str, str], dict] = {}
    prev_by_file: dict[tuple[str, str], dict] = {}
    for k, lst in (prev.get('themes') or {}).items():
        for e in lst:
            if e.get('source'):
                prev_by_source[(k, e['source'])] = e
            else:
                prev_by_file[(k, e['file'])] = e

    themes: dict[str, list[dict]] = {}
    written: set[str] = set()
    total_in = total_out = 0
    for folder in sorted(os.listdir(args.src), key=natural_key):
        src_dir = os.path.join(args.src, folder)
        if not os.path.isdir(src_dir):
            continue
        key = FOLDER_TO_KEY.get(folder.strip().lower())
        if not key:
            print(f'skip unknown theme folder: {folder}', file=sys.stderr)
            continue
        files = sorted((f for f in os.listdir(src_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))), key=natural_key)
        entries = []
        for i, name in enumerate(files, start=1):
            src = os.path.join(src_dir, name)
            out_name = f'{key}-{i}.webp'
            im = Image.open(src).convert('RGB')
            w, h = im.size
            im.save(os.path.join(OUT_DIR, out_name), 'WEBP', quality=args.quality, method=6)
            written.add(out_name)
            size_in, size_out = os.path.getsize(src), os.path.getsize(os.path.join(OUT_DIR, out_name))
            total_in += size_in
            total_out += size_out
            entry = {'file': out_name, 'source': name, 'width': w, 'height': h}
            kept = prev_by_source.get((key, name)) or prev_by_file.get((key, out_name))
            if kept and kept.get('position'):
                entry['position'] = kept['position']
            entries.append(entry)
            print(f'{key}-{i}: {w}x{h} {size_in/1e6:.2f} MB -> {size_out/1024:.0f} KB  ({name})')
        themes[key] = entries

    # Full replacement: drop generated files the new pack no longer produces.
    # Runs only after every conversion succeeded, and only touches our own
    # `<key>-<n>.webp` names, so a failed run never leaves a half-deleted pack.
    stale = sorted(f for f in os.listdir(OUT_DIR) if GENERATED_RE.match(f) and f not in written)
    for f in stale:
        os.remove(os.path.join(OUT_DIR, f))
        print(f'removed stale {f}')

    manifest = {
        '$comment': (
            'Bundled theme-match wallpapers (SKY-11589), files under pack/. Regenerate '
            'with scripts/wallpapers/build-pack.py. Keys are Liquid Neon preset keys '
            '(frontend/src/theme/presets.ts). Index 0 of each theme in the app is the '
            'built-in wallpaper (Neon Nebula: cosmic-bg.webp; others: the starfield '
            'gradient); these files follow it in order. Optional per-entry "position" '
            'is a CSS background-position (default "center"); "source" is the '
            'original file name the entry was encoded from and keeps "position" '
            'attached to the right image across regenerations.'
        ),
        'position': 'center',
        'themes': themes,
    }
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    n = sum(len(v) for v in themes.values())
    print(f'\n{n} wallpapers: {total_in/1e6:.1f} MB PNG -> {total_out/1e6:.2f} MB WebP (q{args.quality})')
    print(f'manifest: {os.path.relpath(MANIFEST, REPO)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
