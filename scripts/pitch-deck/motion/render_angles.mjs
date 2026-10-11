import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Presentation } from '@oai/artifact-tool';
import { addCover } from '../cover_scene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = path.join(ROOT, '.codex/presentation-build/motion');
await fs.mkdir(path.join(root, 'poses'), { recursive: true });
const p = Presentation.create({ slideSize: { width: 1280, height: 720 } });
for (let i = 0; i < 36; i++) {
  const id = String(i).padStart(2, '0');
  const slide = p.slides.add();
  addCover(slide, new Uint8Array(await fs.readFile(path.join(root, `assets/background-${id}.png`))), new Uint8Array(await fs.readFile(path.join(root, `assets/foreground-${id}.png`))));
  const png = await p.export({ slide, format: 'png', scale: 1.5 });
  await fs.writeFile(path.join(root, `poses/pose-${id}.png`), new Uint8Array(await png.arrayBuffer()));
  if ((i + 1) % 6 === 0) console.log(JSON.stringify({ rendered: i + 1, total: 36 }));
}
