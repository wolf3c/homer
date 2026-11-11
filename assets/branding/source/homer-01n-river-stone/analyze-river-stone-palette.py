"""Read-only pixel analysis of the selected 01N PNG; requires Pillow.

Run from any cwd: python3 <this script> > <reviewed JSON destination>.
Does not write or edit images. Hex values are observed pixels nearest the
trimmed channel medians; UI candidates are separately identified below.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
from statistics import median

from PIL import Image

PNG_NAME = "homer-01n-river-stone-transparent-original.png"
EXPECTED_SHA256 = "96d5c2e4cb68bdf0ea0b3df3ae3b51ea5b2d1c7f41d7b437d5d289b56488f152"
ARCHIVE = Path(__file__).resolve().parent

# Half-open pixel boxes, origin at top-left, on the unscaled 1254px PNG.
# Interior areas avoid silhouette antialiasing, eyes/nose and obvious shading.
REGIONS = {
    "body": {"label": "灰褐主体", "boxes": [[520, 300, 730, 400]], "promptHex": "#85807A"},
    "muzzle": {"label": "暖灰鼻吻", "boxes": [[525, 650, 725, 950]], "promptHex": "#B4AAA3"},
    "innerEar": {"label": "局部灰粉内耳", "boxes": [[285, 215, 335, 265], [920, 215, 970, 265]], "promptHex": "#B8A29A"},
    "features": {"label": "深色眼鼻", "boxes": [[415, 430, 445, 460], [795, 690, 835, 730]], "promptHex": "#262B30"},
    "muzzleOutline": {"label": "吻部下缘主体灰，非独立深描边", "boxes": [[550, 1120, 700, 1128]], "promptHex": "#85807A"},
}


def hex_color(rgb):
    return "#" + "".join(f"{v:02X}" for v in rgb)


def rgb_color(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def relative_luminance(rgb):
    srgb = [v / 255 for v in rgb]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in srgb]
    return sum(a * b for a, b in zip(linear, [0.2126, 0.7152, 0.0722]))


def contrast(foreground, background):
    values = sorted([relative_luminance(rgb_color(foreground)), relative_luminance(rgb_color(background))])
    return (values[1] + 0.05) / (values[0] + 0.05)


def measure(image, spec):
    pixels = [image.getpixel((x, y)) for left, top, right, bottom in spec["boxes"]
              for y in range(top, bottom) for x in range(left, right)]
    eligible = [p[:3] for p in pixels if p[3] >= 253]
    if not eligible:
        raise ValueError("No near-opaque pixels in sampling region")
    lightness = sorted(relative_luminance(p) for p in eligible)
    low = lightness[int((len(lightness) - 1) * 0.1)]
    high = lightness[int((len(lightness) - 1) * 0.9)]
    trimmed = [p for p in eligible if low <= relative_luminance(p) <= high]
    medians = tuple(round(median(p[i] for p in trimmed)) for i in range(3))
    frequencies = Counter(trimmed)
    representative = min(frequencies, key=lambda p: (sum((p[i] - medians[i]) ** 2 for i in range(3)), -frequencies[p], p))
    return {**spec, "roiPixels": len(pixels), "nearOpaquePixels": len(eligible), "retainedPixels": len(trimmed),
            "roiAlphaCounts": dict(sorted(Counter(p[3] for p in pixels).items())),
            "trimLuminanceBounds": [low, high], "trimmedMedianRGB": list(medians),
            "rgb": list(representative), "hex": hex_color(representative),
            "retainedRGBMin": [min(p[i] for p in trimmed) for i in range(3)],
            "retainedRGBMax": [max(p[i] for p in trimmed) for i in range(3)],
            "representativeCoordinate": next([x, y] for left, top, right, bottom in spec["boxes"]
                for y in range(top, bottom) for x in range(left, right)
                if image.getpixel((x, y))[:3] == representative and image.getpixel((x, y))[3] >= 253)}


def main():
    raw = (ARCHIVE / PNG_NAME).read_bytes()
    actual_hash = hashlib.sha256(raw).hexdigest()
    if actual_hash != EXPECTED_SHA256:
        raise ValueError("Selected PNG SHA changed: review selection and ROIs before re-analysis")
    image = Image.open(ARCHIVE / PNG_NAME)
    if image.mode != "RGBA" or image.size != (1254, 1254):
        raise ValueError("Unexpected selected PNG format")
    samples = {name: measure(image, spec) for name, spec in REGIONS.items()}
    # Optional UI accent: deterministic 80% observed body RGB + 20% black,
    # mixed in encoded sRGB; candidate only, not a runtime token.
    brand_ink = hex_color(tuple(round(v * 0.8) for v in samples["body"]["rgb"]))
    ui = {
        "canvas": {"hex": "#F6F5F2", "origin": "existing --canvas"},
        "surface": {"hex": "#FFFFFF", "origin": "existing --surface"},
        "softSurface": {"hex": "#EEECE8", "origin": "existing --soft"},
        "text": {"hex": "#292825", "origin": "existing --ink"},
        "mutedText": {"hex": "#67645F", "origin": "existing --muted"},
        "decorativeLine": {"hex": "#DEDBD5", "origin": "existing --line; not a sole control boundary"},
        "brandInkCandidate": {"hex": brand_ink, "origin": "observed body * 0.8 in encoded sRGB; future limited accent"},
        "controlBoundaryCandidate": {"hex": samples["body"]["hex"], "origin": "observed body; future control edge candidate"},
    }
    pairs = []
    for name in ["text", "mutedText", "brandInkCandidate", "controlBoundaryCandidate", "decorativeLine"]:
        for background in ["surface", "canvas"]:
            value = contrast(ui[name]["hex"], ui[background]["hex"])
            pairs.append({"foregroundRole": name, "foreground": ui[name]["hex"], "backgroundRole": background,
                          "background": ui[background]["hex"], "ratio": round(value, 6),
                          "normalTextAA4_5": value >= 4.5, "largeTextAA3": value >= 3,
                          "nonTextContrast3": value >= 3})
    pairs.append({"foregroundRole": "whiteLabel", "foreground": "#FFFFFF", "backgroundRole": "brandInkCandidate",
                  "background": brand_ink, "ratio": round(contrast("#FFFFFF", brand_ink), 6),
                  "normalTextAA4_5": contrast("#FFFFFF", brand_ink) >= 4.5})
    generation = {"tool": "image_gen__imagegen", "output": "exec-4f405887-af9c-4358-b5ea-63412a61e7a6.png",
                  "transparentBackgroundRequested": True,
                  "reference": "Original 01 quiet-hello concept PNG; not an official hippo photo",
                  "promptIntent": {"body": "#85807A", "muzzle": "#B4AAA3", "innerEar": "#B8A29A", "features": "#262B30"}}
    result = {"schemaVersion": 1, "recordedDate": "2026-10-20", "selection": {"id": "01N", "name": "河石灰",
        "status": "user-selected direction; archive only; production resource not switched",
        "file": PNG_NAME, "sha256": actual_hash, "bytes": len(raw), "width": image.width, "height": image.height,
        "mode": image.mode, "alphaExtrema": list(image.getchannel("A").getextrema()),
        "colorSpaceAssumption": "PNG has no ICC/sRGB/gamma metadata; decoded 8-bit RGB treated as sRGB for analysis, no display calibration",
        "originalScratchPath": ".codex/scratch/hippo-logo-design-review/iteration-02-natural-tones/originals/" + PNG_NAME},
        "generation": generation,
        "samplingMethod": {"coordinateSystem": "original image pixels, top-left origin, half-open boxes",
            "alphaMinimum": 253, "reason": "solid interiors are natively mostly alpha 254; 255-only would discard them",
            "edges": "manually selected interior ROIs, away from silhouette antialiasing and region boundaries",
            "shading": "discard outside within-region luminance 10th/90th percentile bounds; inclusive at ties",
            "representative": "nearest actually observed retained RGB to rounded per-channel medians; frequency then RGB tiebreak",
            "limits": "not a unique flat fill; mild gradients/texture remain; encoded RGB is uncomposited; no claim of biological color standard"},
        "observedSamples": samples,
        "uiReference": {"status": "recommendations only; no CSS/token changes", "source": "ui/homer-styles.css :root in archive worktree; not live UI evidence",
                        "cssSha256AtArchive": "fa9dc54d108d594927d155d6191ee433c739d3357ba45a772dd2fd89c9e385fa",
                        "designGuidance": "maintenance ui/DESIGN.md read-only; warm-gray direction retained, no design-file edit",
                        "colors": ui, "brandInkMix": "round(observed body RGB channel * 0.8); 20% black in encoded sRGB"},
        "contrast": {"method": "sRGB to linear: c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4; L=0.2126R+0.7152G+0.0722B; (Lmax+0.05)/(Lmin+0.05)",
                     "assumptions": "opaque solid foreground/background, no opacity/blending/gradient; not actual UI validation or full WCAG conformance",
                     "pairs": pairs},
        "naturalReferences": ["https://denverzoo.org/animals/river-hippopotamus/", "https://www.pretoriazoo.org/animals/hippopotamus/"]}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
