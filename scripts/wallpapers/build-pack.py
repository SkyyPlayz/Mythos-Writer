#!/usr/bin/env python3
"""
Build the bundled Liquid Neon wallpaper pack (SKY-11589).

Converts the owner's PNG originals (NOT committed — they live outside the repo)
into WebP files under frontend/src/assets/wallpapers/ and rewrites the
manifest.json that the app reads at build time (frontend/src/theme/wallpapers.ts).

Replacing the pack later is a file drop + manifest edit, never a code change:
  1. Point --src at a folder with one sub-folder per theme (folder names below).
  2. Run:  python3 scripts/wallpapers/build-pack.py --src "<folder>"
  3. Commit the regenerated .webp files + manifest.json.

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
OUT_DIR = os.path.join(REPO, 'frontend', 'src', 'assets', 'wallpapers')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')

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
    prev: dict = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            prev = json.load(f)
    prev_entries = {
        (k, e['file']): e for k, lst in (prev.get('themes') or {}).items() for e in lst
    }

    themes: dict[str, list[dict]] = {}
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
            size_in, size_out = os.path.getsize(src), os.path.getsize(os.path.join(OUT_DIR, out_name))
            total_in += size_in
            total_out += size_out
            entry = {'file': out_name, 'width': w, 'height': h}
            kept = prev_entries.get((key, out_name))
            if kept and kept.get('position'):
                entry['position'] = kept['position']
            entries.append(entry)
            print(f'{key}-{i}: {w}x{h} {size_in/1e6:.2f} MB -> {size_out/1024:.0f} KB  ({name})')
        themes[key] = entries

    manifest = {
        '$comment': (
            'Bundled theme-match wallpapers (SKY-11589). Regenerate with '
            'scripts/wallpapers/build-pack.py. Keys are Liquid Neon preset keys '
            '(frontend/src/theme/presets.ts). Index 0 of each theme in the app is the '
            'built-in wallpaper (Neon Nebula: cosmic-bg.webp; others: the starfield '
            'gradient); these files follow it in order. Optional per-entry "position" '
            'is a CSS background-position (default "center").'
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
