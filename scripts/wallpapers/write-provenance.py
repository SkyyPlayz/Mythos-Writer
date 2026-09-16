#!/usr/bin/env python3
"""Rewrite frontend/src/assets/wallpapers/PROVENANCE.json from a source folder.

SKY-11591. `build-pack.py` re-encodes the owner's originals into `pack/` and
records each entry's `source` filename in `manifest.json`. This walks that
manifest, finds each source in the folder it was encoded from, and writes the
SHA-256 of its bytes — so every shipped wallpaper stays traceable to the exact
file the owner handed over, without the 68 MB of originals living in the repo.

Hand-written `cropNote` text is carried over by matching `source`, the same way
`build-pack.py` carries `position`. A source that gains no note comes back as
`null`, which is the marker for "nobody has looked at this image's framing".

    python3 scripts/wallpapers/write-provenance.py --src "<originals folder>"

Run it after `build-pack.py`. `frontend/src/theme/wallpapers.test.ts` fails if
the record and the manifest disagree, so a forgotten run turns CI red rather
than shipping a stale audit trail.
"""

import argparse
import hashlib
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(REPO, "frontend", "src", "assets", "wallpapers")
MANIFEST = os.path.join(ASSETS, "manifest.json")
PROVENANCE = os.path.join(ASSETS, "PROVENANCE.json")

# The owner's folder names, which do not match the preset keys.
FOLDER_TO_KEY = {
    "neon nebula": "classic",
    "aurora": "aurora",
    "cyberpunk": "cyber",
    "sunset coast": "sunset",
    "ice mono": "ice",
    "emberfall": "ember",
    "verdant reach": "verdant",
    "royal arcana": "royal",
    "noir rose": "noir",
    "winterlight": "winter",
}

COMMENT = (
    "SKY-11591 - provenance for every file in pack/. The PNG originals are "
    "owner-authored and held off-repo (see LICENSE); sha256 is of the original "
    "the entry was encoded from, so a restaged copy can be proven identical. "
    "cropNote records why the manifest entry carries the position it does; "
    "null means no human reviewed this image's framing and it renders centred."
)


def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="folder of originals, one sub-folder per theme")
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        print(f"source folder not found: {args.src}", file=sys.stderr)
        return 2

    with open(MANIFEST, encoding="utf-8") as f:
        themes = json.load(f)["themes"]

    # Where each theme's originals live, keyed the way the manifest is.
    dir_for_key = {}
    for folder in sorted(os.listdir(args.src), key=natural_key):
        key = FOLDER_TO_KEY.get(folder.strip().lower())
        if key:
            dir_for_key[key] = os.path.join(args.src, folder)

    # Keep hand-written notes, matched by the source filename so they survive a
    # re-ordering or a re-encode of the pack.
    prev_note = {}
    if os.path.exists(PROVENANCE):
        with open(PROVENANCE, encoding="utf-8") as f:
            for key, rows in json.load(f).get("themes", {}).items():
                for row in rows:
                    if row.get("cropNote"):
                        prev_note[(key, row["sourceFile"])] = row["cropNote"]

    out, missing = {}, []
    for key, entries in themes.items():
        rows = []
        for entry in entries:
            source = entry.get("source")
            if not source:
                print(f"{key}: {entry['file']} has no `source` in manifest.json — "
                      "regenerate the pack with build-pack.py first", file=sys.stderr)
                return 2
            folder = dir_for_key.get(key)
            path = os.path.join(folder, source) if folder else None
            if not path or not os.path.exists(path):
                missing.append(f"{key}/{source}")
                continue
            with open(path, "rb") as f:
                digest = hashlib.sha256(f.read()).hexdigest()
            rows.append({
                "file": entry["file"],
                "sourceFolder": os.path.basename(folder),
                "sourceFile": source,
                "sha256": digest,
                "cropNote": prev_note.get((key, source)),
            })
        out[key] = rows

    if missing:
        print("originals not found in --src:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 2

    body = json.dumps({"$comment": COMMENT, "themes": out}, indent=2) + "\n"
    if args.check:
        with open(PROVENANCE, encoding="utf-8") as f:
            same = f.read() == body
        print("PROVENANCE.json is up to date" if same else "PROVENANCE.json is STALE")
        return 0 if same else 1

    with open(PROVENANCE, "w", encoding="utf-8") as f:
        f.write(body)
    n = sum(len(v) for v in out.values())
    unreviewed = sum(1 for v in out.values() for r in v if r["cropNote"] is None)
    print(f"{n} originals hashed, {unreviewed} with no crop note")
    print(f"provenance: {os.path.relpath(PROVENANCE, REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
