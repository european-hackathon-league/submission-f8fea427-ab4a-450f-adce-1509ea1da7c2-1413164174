from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.codex/presentation-build/motion/assets'
OUT.mkdir(parents=True, exist_ok=True)

for index in range(36):
    source = ROOT / f'frontend/public/images/bmw/exterior/31GE/{index:02}.webp'
    image = Image.open(source).convert('RGB')
    width, height = image.size
    pixels = np.asarray(image, dtype=np.float32)
    luminance = pixels @ np.array([.2126, .7152, .0722])
    foreground = luminance < 178
    # The studio background is light; retain the connected car silhouette,
    # including bright reflections enclosed by its outline and its ground shadow.
    foreground[:int(height * .29)] = False
    foreground[int(height * .88):] = False
    foreground[:, :int(width * .10)] = False
    foreground[:, int(width * .91):] = False
    mask = Image.fromarray((foreground * 255).astype('uint8')).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    exterior = mask.copy()
    ImageDraw.floodfill(exterior, (0, 0), 128, thresh=0)
    silhouette = np.asarray(exterior) != 128
    mask = Image.fromarray((silhouette * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(.6))
    cutout = image.convert('RGBA')
    cutout.putalpha(mask)
    image.save(OUT / f'background-{index:02}.png')
    cutout.save(OUT / f'foreground-{index:02}.png')

(ROOT / '.codex/presentation-build/motion/timeline.json').write_bytes(Path(__file__).with_name('timeline.json').read_bytes())
print(json.dumps({'assetPairs': 36, 'resolution': [width, height], 'directory': str(OUT)}))
