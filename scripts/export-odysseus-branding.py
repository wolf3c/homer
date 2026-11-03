#!/usr/bin/env python3
"""Export the approved Odysseus image without retouching or cropping."""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from PIL import Image, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / 'assets/branding/odysseus-20261030'
SOURCE = BRAND / 'source/odysseus-fusion-original.png'
EXPECTED = '59ad7741733e2cfefa11641af558db2857a6bcf449d89d113c7fa7234c632675'

def main():
    if sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED:
        raise SystemExit('Approved Odysseus source hash mismatch')
    source = Image.open(SOURCE)
    source.load()
    if source.mode != 'RGBA' or source.size != (1254, 1254):
        raise SystemExit('Expected approved 1254 x 1254 RGBA image')
    manifest_path = BRAND / 'manifest.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    files = []
    for size in (16, 32, 48, 64, 128, 256, 512, 1024):
        image = source.convert('RGBa').resize((size, size), Image.Resampling.LANCZOS).convert('RGBA')
        out = BytesIO()
        image.save(out, format='PNG', optimize=False, compress_level=9)
        data = out.getvalue()
        name = f'homer-odysseus-{size}.png'
        (BRAND / name).write_bytes(data)
        files.append({'file': name, 'dimensions': [size, size], 'mode': 'RGBA',
                      'bytes': len(data), 'sha256': sha256(data).hexdigest(),
                      'alphaRange': list(image.getchannel('A').getextrema())})
    manifest = {'schemaVersion': 1, 'date': '2026-10-30',
                'selection': 'Odysseus: A palette + D character',
                'source': 'source/odysseus-fusion-original.png', 'sourceSha256': EXPECTED,
                'sourceDimensions': list(source.size), 'sourceMode': source.mode,
                'export': {'pillow': pillow_version, 'resampling': 'premultiplied alpha LANCZOS',
                           'canvas': 'full original square; no crop, recolor or alpha threshold',
                           'visualRetouch': False}, 'files': files}
    # Retain ICNS validation only while both its source PNG and bytes are unchanged.
    icon = BRAND / 'homer-odysseus.icns'
    icns = previous.get('icns', {})
    old_png = next((f for f in previous.get('files', [])
                    if f.get('file') == 'homer-odysseus-1024.png'), {})
    if (previous.get('sourceSha256') == EXPECTED
            and old_png.get('sha256') == files[-1]['sha256']
            and icns.get('file') == icon.name and icon.is_file()
            and icns.get('bytes') == icon.stat().st_size
            and icns.get('sha256') == sha256(icon.read_bytes()).hexdigest()):
        manifest['icns'] = icns
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'exports': len(files), 'sourceSha256': EXPECTED}))

if __name__ == '__main__':
    main()
