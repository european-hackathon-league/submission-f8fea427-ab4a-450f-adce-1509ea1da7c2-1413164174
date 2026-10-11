"""Extract current video beats and assemble a contact sheet for visual review."""
from pathlib import Path
import json
import subprocess
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / '.codex/presentation-build/motion'
sys.path.insert(0, str(BUILD / 'deps'))
import imageio_ffmpeg

output = BUILD / 'review'
output.mkdir(parents=True, exist_ok=True)
video = ROOT / 'output/video/FWD_BMW_1Series_Intro.mp4'
times = [0, .5, 1, 1.5, 2, 2.5, 3, 4.5]
sheet = Image.new('RGB', (1920, 588), '#f7f8fa')
draw = ImageDraw.Draw(sheet)
for index, time in enumerate(times):
    frame = output / f'beat-{index:02}.png'
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(time), '-i', str(video), '-frames:v', '1', str(frame)], check=True)
    image = Image.open(frame).convert('RGB').resize((480, 270), Image.Resampling.LANCZOS)
    left, top = (index % 4) * 480, (index // 4) * 294
    sheet.paste(image, (left, top))
    draw.text((left + 10, top + 274), f'{time:.1f}s', fill='#172131')
sheet.save(output / 'motion-contact-sheet.png')
print(json.dumps({'sheet': str(output / 'motion-contact-sheet.png'), 'beats': times}))
