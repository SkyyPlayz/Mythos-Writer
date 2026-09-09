#!/usr/bin/env python3
"""Build the shipped Liquid Neon wallpapers from the owner's PNG originals.

    python3 scripts/wallpapers/build_wallpapers.py            # write the WebPs
    python3 scripts/wallpapers/build_wallpapers.py --check    # verify committed output

Reads `wallpapers.manifest.json` (crop anchors + curation order, hand-picked per
image), crops each original to the target aspect ratio at its anchor, and encodes
a WebP into `frontend/src/assets/wallpapers/bg-<setKey>-<n>.webp`.

Design notes and the licence record live in docs/design/wallpaper-pipeline.md.
This is an offline design tool — it is not part of the app build, and Pillow is
not a repo dependency. Install it ad hoc: `pip install Pillow`.

SKY-11590.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - tooling guard
    sys.exit("Pillow is required: pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MANIFEST = os.path.join(HERE, "wallpapers.manifest.json")
ORIGINALS = os.path.join(ROOT, "design-assets", "wallpapers", "originals")
SHIPPED = os.path.join(ROOT, "frontend", "src", "assets", "wallpapers")
REPORT = os.path.join(HERE, "build-report.json")


def crop_box(width: int, height: int, aspect: float, anchor: float):
    """16:9 window of the largest size that fits, positioned at `anchor`.

    `anchor` is a 0..1 position along whichever axis has pixels to spare — the
    fraction of the source that sits at the centre of the crop. It is clamped to
    the range where the window still lies wholly inside the source, so an anchor
    the source cannot honour degrades to the nearest legal offset rather than
    producing a short frame.
    """
    if width / height > aspect:
        cw, ch = int(round(height * aspect)), height
    else:
        cw, ch = width, int(round(width / aspect))
    cw, ch = min(cw, width), min(ch, height)

    if width - cw >= height - ch:
        lo, hi = cw / 2 / width, 1 - cw / 2 / width
        cx = min(max(anchor, lo), hi) * width
        left = int(round(cx - cw / 2))
        top = (height - ch) // 2
    else:
        lo, hi = ch / 2 / height, 1 - ch / 2 / height
        cy = min(max(anchor, lo), hi) * height
        top = int(round(cy - ch / 2))
        left = (width - cw) // 2

    left = min(max(left, 0), width - cw)
    top = min(max(top, 0), height - ch)
    clamped = abs(min(max(anchor, lo), hi) - anchor) > 1e-6
    return (left, top, left + cw, top + ch), clamped


def encode(img: Image.Image, enc: dict) -> tuple[bytes, int, bool]:
    """Highest quality in range whose WebP lands under `targetBytes`.

    Fixed quality would let the busiest nebulae balloon past the size discipline
    while the calm gradients waste their budget, so search per image instead.

    Returns `(data, quality, at_floor)`. `at_floor` is True when even the floor
    quality overshoots `targetBytes` — the image ships anyway, but the caller
    surfaces it rather than letting the miss disappear into the average.
    """
    q_min, q_max = enc["qualityRange"]
    best: tuple[bytes, int] | None = None
    lo, hi = q_min, q_max
    while lo <= hi:
        mid = (lo + hi) // 2
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=mid, method=enc["method"])
        data = buf.getvalue()
        if len(data) <= enc["targetBytes"]:
            best = (data, mid)
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None:  # even the floor quality overshoots; ship the floor
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q_min, method=enc["method"])
        return buf.getvalue(), q_min, True
    return best[0], best[1], False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="rebuild in memory and fail if the committed WebPs differ")
    args = ap.parse_args()

    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    aw, ah = manifest["targetAspect"]
    aspect = aw / ah
    enc = manifest["encode"]
    os.makedirs(SHIPPED, exist_ok=True)

    rows, warnings, stale = [], [], []
    for set_key, spec in manifest["sets"].items():
        for n, item in enumerate(spec["images"], 1):
            src = os.path.join(ORIGINALS, set_key, item["src"])
            img = Image.open(src).convert("RGB")
            box, clamped = crop_box(img.width, img.height, aspect, item["anchor"])
            if clamped:
                warnings.append(
                    f"{set_key}-{n}: anchor {item['anchor']} is outside what "
                    f"{item['src']} ({img.width}x{img.height}) can honour; clamped")
            out = img.crop(box)
            data, quality, at_floor = encode(out, enc)
            if len(data) > enc["maxBytes"]:
                warnings.append(
                    f"{set_key}-{n}: {len(data)}B exceeds maxBytes at quality "
                    f"floor {quality} — recurate or raise the budget")
            elif at_floor:
                warnings.append(
                    f"{set_key}-{n}: {len(data)}B is over targetBytes at quality "
                    f"floor {quality} ({item['src']} is the densest art in its set)")

            name = f"bg-{set_key}-{n}.webp"
            path = os.path.join(SHIPPED, name)
            if args.check:
                if not os.path.exists(path) or open(path, "rb").read() != data:
                    stale.append(name)
            else:
                with open(path, "wb") as fh:
                    fh.write(data)

            rows.append({
                "file": name, "set": set_key, "order": n, "source": item["src"],
                "sourceSize": [img.width, img.height], "anchor": item["anchor"],
                "cropBox": list(box), "outputSize": list(out.size),
                "quality": quality, "atQualityFloor": at_floor,
                "bytes": len(data), "note": item["note"],
            })

    total = sum(r["bytes"] for r in rows)
    if not args.check:
        json.dump({"images": rows, "totalBytes": total}, open(REPORT, "w"), indent=2)

    for r in rows:
        print(f"  {r['file']:<20} {r['outputSize'][0]}x{r['outputSize'][1]}"
              f"  q{r['quality']:<3} {r['bytes'] / 1024:6.1f} KB")
    print(f"\n{len(rows)} images, {total / 1024 / 1024:.2f} MB total, "
          f"{total / len(rows) / 1024:.1f} KB average")
    for w in warnings:
        print(f"WARN {w}", file=sys.stderr)
    if stale:
        print(f"\nout of date with the manifest: {', '.join(stale)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
