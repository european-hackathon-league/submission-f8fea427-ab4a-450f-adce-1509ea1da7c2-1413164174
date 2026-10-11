from pathlib import Path
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / '.codex/presentation-build/motion'
sys.path.insert(0, str(BUILD / 'deps'))
import imageio_ffmpeg

tl = json.loads((BUILD / 'timeline.json').read_text())
source_fps = 18
sequence = BUILD / 'sequence'
sequence.mkdir(exist_ok=True)
for frame in range(round(tl['duration'] * source_fps)):
    time = frame / source_fps
    progress = max(0, min(1, (time - tl['beats']['rotationStart']) / (tl['beats']['rotationEnd'] - tl['beats']['rotationStart'])))
    eased = progress * progress * (3 - 2 * progress)
    pose = (tl['startAngleIndex'] + round(36 * tl['turns'] * eased)) % 36
    target = sequence / f'frame-{frame:04}.png'
    if target.is_symlink() or target.exists():
        target.unlink()
    target.symlink_to(BUILD / f'poses/pose-{pose:02}.png')

output = ROOT / 'output/video/FWD_BMW_1Series_Intro.mp4'
output.parent.mkdir(parents=True, exist_ok=True)
cmd = [imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-y', '-framerate', str(source_fps), '-i', str(sequence / 'frame-%04d.png'), '-vf', 'fps=30,tpad=stop_mode=clone:stop_duration=1', '-t', str(tl['duration']), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(output)]
subprocess.run(cmd, check=True)
print(json.dumps({'video': str(output), 'resolution': [1920, 1080], 'duration': tl['duration'], 'fps': tl['fps']}))
