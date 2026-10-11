import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SKILL_DIR = process.env.PRESENTATIONS_SKILL_DIR;
if (!SKILL_DIR || !process.env.RUNTIME_PYTHON) throw new Error('Set PRESENTATIONS_SKILL_DIR and RUNTIME_PYTHON using the Codex workspace dependency paths.');
const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidatePath = path.join(workspaceDir, '.codex/presentation-build/animated-draft.pptx');
const finalPath = path.resolve(workspaceDir, process.argv[2] ?? 'output/pptx/FWD_BMW_Pitch_G60_Animated_v1.pptx');
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);
const stagingDir = path.join(workspaceDir, '.codex/presentation-build/finalizer');
await fs.mkdir(stagingDir, { recursive: true });
await fs.mkdir(path.dirname(finalPath), { recursive: true });
const result = await finalizePresentation({
  explicitTotalSlideCount: 11,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: process.env.RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-bullet-geometry', '--validate-heading-fit'],
  fontPolicy: {
    basis: 'reference',
    families: ['Calibri'],
    referencePath: path.join(workspaceDir, 'doc/pitch/FWD_BMW_Pitch_Clean.pdf'),
    referenceSha256: '2aebeafd2e9432dd6fd65a68d0111c08e6c5facac4a844f81f554e2501581e9f',
  },
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, `${path.basename(finalPath)}.validation.json`),
});
console.log(JSON.stringify(result));
