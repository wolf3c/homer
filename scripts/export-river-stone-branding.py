#!/usr/bin/env python3
"""Deterministic PNG size exports; no retouching, recoloring or vectorization.

Requires Pillow 9.5.0 (the version used for the recorded exports).
Run from any directory: python3 scripts/export-river-stone-branding.py
"""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

from PIL import Image, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets/branding"
SOURCE = BRAND / "source/homer-01n-river-stone/homer-01n-river-stone-transparent-original.png"
EXPECTED = "96d5c2e4cb68bdf0ea0b3df3ae3b51ea5b2d1c7f41d7b437d5d289b56488f152"


def main():
    if pillow_version != "9.5.0":
        raise SystemExit("Use Pillow 9.5.0 to reproduce the recorded PNG bytes.")
    if sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED:
        raise SystemExit("Approved river-stone source hash mismatch.")
    source = Image.open(SOURCE)
    source.load()
    if source.mode != "RGBA" or source.size != (1254, 1254):
        raise SystemExit("Expected the approved 1254×1254 RGBA PNG.")
    files = []
    for size in (16, 32, 64, 256):
        # Filter premultiplied RGB and alpha together. Preserve the entire
        # canvas and native near-opaque interiors; no crop or alpha threshold.
        image = source.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
        output = BytesIO()
        image.save(output, format="PNG", optimize=False, compress_level=9)
        data = output.getvalue()
        digest = sha256(data).hexdigest()
        name = f"homer-river-stone-{size}.{digest[:12]}.png"
        (BRAND / name).write_bytes(data)
        files.append({"file": name, "width": size, "height": size,
                      "format": "PNG", "mode": "RGBA", "bytes": len(data), "sha256": digest,
                      "alphaRange": list(image.getchannel("A").getextrema()),
                      "cornerAlpha": [image.getpixel(p)[3] for p in
                                      ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1))]})
    manifest = {"schemaVersion": 1, "selection": "01N 河石灰", "recordedDate": "2026-10-21",
                "source": str(SOURCE.relative_to(BRAND)), "sourceSha256": EXPECTED,
                "sourceDimensions": [1254, 1254], "sourceMode": "RGBA",
                "export": {"pillow": pillow_version, "resampling": "premultiplied alpha LANCZOS",
                           "canvas": "full original square, no crop or optical redraw",
                           "png": "compress_level=9, optimize=False",
                           "visualRetouch": False}, "files": files}
    (BRAND / "homer-river-stone-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({str(f["width"]): f["file"] for f in files}, ensure_ascii=False))


if __name__ == "__main__":
    main()
