import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pptxPath = path.resolve(ROOT, process.argv[2] ?? 'output/pptx/FWD_BMW_Pitch_G60_Animated_v1.pptx');
const outDir = path.join(ROOT, '.codex/presentation-build/animated-review');
await fs.mkdir(outDir, { recursive: true });
const deck = await PresentationFile.importPptx(await FileBlob.load(pptxPath));
for (const [i, slide] of deck.slides.items.entries()) {
  const blob = await deck.export({ slide, format: 'png', scale: 1 });
  await fs.writeFile(path.join(outDir, `final-${String(i+1).padStart(2,'0')}.png`), new Uint8Array(await blob.arrayBuffer()));
}
const inspection = await deck.inspect({ kind: 'slide,notes', maxChars: 30000 });
await fs.writeFile(path.join(outDir, 'inspection.ndjson'), inspection.ndjson);
console.log(JSON.stringify({ slides: deck.slides.items.length, renderDir: outDir, notes: (inspection.ndjson.match(/"kind":"notes"/g) || []).length }));
