import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
import { addCover } from './cover_scene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = path.join(ROOT, '.codex/presentation-build');
const OUT = path.join(BUILD, 'draft-v2.pptx');
const W = 1280, H = 720;
const C = {
  navy: '#111927', ink: '#172131', blue: '#2D5FF4', pale: '#EAF0FF',
  paper: '#F7F8FA', white: '#FFFFFF', muted: '#5B6B82', line: '#D6DFEC',
  soft: '#EEF2F7', green: '#146C54', greenPale: '#E5F4EF', amber: '#96620B', amberPale: '#FFF4D6',
};
const FONT = 'Calibri';
const p = Presentation.create({ slideSize: { width: W, height: H } });

function rect(slide, x, y, w, h, fill, line = 'none', width = 0, name) {
  return slide.shapes.add({
    geometry: 'rect', name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: 'solid', fill: line, width },
  });
}
function text(slide, value, x, y, w, h, opt = {}) {
  const sh = slide.shapes.add({
    geometry: 'textbox', name: opt.name,
    position: { left: x, top: y, width: w, height: h },
    fill: 'none', line: { style: 'solid', fill: 'none', width: 0 },
  });
  sh.text = value;
  sh.text.style = {
    typeface: FONT,
    fontSize: opt.size ?? 22,
    bold: opt.bold ?? false,
    color: opt.color ?? C.ink,
    alignment: opt.align ?? 'left',
    verticalAlignment: opt.valign ?? 'top',
    wrap: 'square',
    autoFit: opt.autoFit ?? 'shrinkText',
    insets: 0,
    ...(opt.italic ? { italic: true } : {}),
  };
  return sh;
}
function image(slide, src, alt, x, y, w, h, fit = 'contain') {
  const source = uiImage;
  return slide.images.add({ ...source, alt, fit, position: { left: x, top: y, width: w, height: h } });
}
function notes(slide, value) { slide.speakerNotes.text = value; }
function header(slide, section, title, page) {
  slide.background.fill = C.paper;
  text(slide, 'FWD', 54, 24, 48, 28, { size: 20, bold: true });
  text(slide, '//', 112, 22, 38, 28, { size: 22, bold: true, color: C.blue });
  text(slide, 'VEHICLE REQUIREMENTS', 163, 28, 260, 18, { size: 12, color: C.muted });
  text(slide, section.toUpperCase(), 56, 78, 420, 20, { size: 13, bold: true, color: C.blue });
  text(slide, title, 56, 111, 1160, 72, { size: 39, bold: true, color: C.ink });
  text(slide, `${String(page).padStart(2, '0')} / 11`, 1110, 683, 110, 18, { size: 12, color: C.muted, align: 'right' });
}
function darkHeader(slide, page, brand = 'VEHICLE REQUIREMENTS') {
  slide.background.fill = C.navy;
  text(slide, 'FWD', 54, 25, 48, 26, { size: 20, bold: true, color: C.white });
  text(slide, '//', 112, 22, 38, 28, { size: 22, bold: true, color: C.blue });
  text(slide, brand, 163, 29, 330, 18, { size: 12, color: '#AEBBD0' });
  text(slide, `${String(page).padStart(2, '0')} / 11`, 1110, 683, 110, 18, { size: 12, color: '#AEBBD0', align: 'right' });
}
function sectionLabel(slide, s, x, y, w = 300) { text(slide, s.toUpperCase(), x, y, w, 18, { size: 12, bold: true, color: C.blue }); }
function badge(slide, s, x, y, w, fill = C.pale, color = C.blue) {
  rect(slide, x, y, w, 30, fill, 'none', 0);
  text(slide, s, x + 12, y + 7, w - 24, 18, { size: 13, bold: true, color, align: 'center' });
}
function line(slide, x, y, w, color = C.line, height = 1) { rect(slide, x, y, w, height, color); }
function arrow(slide, x, y, w = 72) {
  slide.shapes.add({ geometry: 'rightArrow', position: { left: x, top: y, width: w, height: 28 }, fill: C.blue, line: { style: 'solid', fill: 'none', width: 0 } });
}
function addTextAndNotes(slide, noteText) { notes(slide, noteText); }

const ui = path.join(ROOT, 'doc/pitch/assets/workshop-ui-viewer.jpg');
const coverCar = path.join(BUILD, 'motion/assets/background-04.png');
const uiBytes = new Uint8Array(await fs.readFile(ui));
const coverCarBytes = new Uint8Array(await fs.readFile(coverCar));
const coverForegroundBytes = new Uint8Array(await fs.readFile(path.join(BUILD, 'motion/assets/foreground-04.png')));
const uiImage = { blob: uiBytes, contentType: 'image/jpeg' };

// 1. Cover
{
  const s = p.slides.add();
  addCover(s, coverCarBytes, coverForegroundBytes);
}
// 2. Challenge context
{
  const s = p.slides.add(); header(s, 'The challenge', 'One G60 complaint. Three possible needs.', 2);
  text(s, 'Check feedback against study, equipment and market evidence.', 58, 196, 1100, 38, { size: 24, color: C.muted });
  text(s, 'What needs to change?', 60, 350, 650, 44, { size: 32, bold: true });
  line(s, 60, 414, 1124, C.line, 2);
  const needs = [
    ['01', 'Capability', 'Add a missing function'],
    ['02', 'Availability', 'Offer it in the right variant'],
    ['03', 'Usability', 'Make it easier to use'],
  ];
  needs.forEach((n, i) => {
    const x = 60 + i * 386;
    text(s, n[0], x, 454, 44, 26, { size: 17, bold: true, color: C.blue });
    text(s, n[1], x, 496, 340, 38, { size: 27, bold: true });
    text(s, n[2], x, 545, 350, 34, { size: 19, color: C.muted });
  });
  text(s, 'The cited record points to usability; US equipment fit is still unverified.', 60, 626, 1100, 24, { size: 16, color: C.muted });
  addTextAndNotes(s, 'BMW source package includes G60 feedback, a US_2025 customer study, and a G60 option list. The supplied option list is not a validated US equipment baseline. The three categories are distinct interpretation paths, not four evidence boxes or conclusions already proven by the cited record. See doc/frontend/MODEL-COVERAGE.md and doc/googledrive/F70_G60_G68_G70_customer_studies.xlsx.');
}
// 3. Solution and real product UI
{
  const s = p.slides.add(); header(s, 'The solution', 'One application. A traceable decision path.', 3);
  text(s, 'The frontend and backend now work as one product.', 58, 190, 980, 34, { size: 22, color: C.muted });
  image(s, ui, 'FWD product interface with the vehicle viewer; recommendation sidebar cropped out', 58, 248, 410, 410, 'contain');
  const x = 540;
  sectionLabel(s, 'Core pipeline', x, 252, 300);
  const items = [
    ['01', 'Scope + upload', 'Vehicle context and source files'],
    ['02', 'Analyze evidence', 'Normalize records; link findings to sources'],
    ['03', 'Build proposals', 'Check baseline; derive and prioritize changes'],
    ['04', 'PM decision', 'Edit, decide, preserve versions and export'],
  ];
  items.forEach((it, i) => {
    const y = 294 + i * 79;
    text(s, it[0], x, y, 38, 25, { size: 17, bold: true, color: C.blue });
    text(s, it[1], x + 48, y - 2, 420, 28, { size: 21, bold: true });
    text(s, it[2], x + 48, y + 31, 500, 26, { size: 16, color: C.muted });
    if (i < items.length - 1) line(s, x + 48, y + 62, 500);
  });
  text(s, 'Deep Dive and Reimagine are optional steps.', x + 48, 625, 480, 22, { size: 15, color: C.muted });
  addTextAndNotes(s, 'Pipeline verified against plan.md, backend_plan.md and the implemented API/workflow. The actual product interface screenshot is from doc/frontend/evidence/workshop-desktop.png; this visual crop removes the synthetic suggestion sidebar requested in review. Remaining visible vehicle/viewer context is fixture-based, so the screenshot is not evidence of a live BMW analysis. Core path: upload and freeze run/source scope; parse and normalize; extract source-linked findings; check baseline and optionally run Deep Dive; create versioned proposals; PM edits/decides; optional Reimagine uses a bound proposal version; export preserves selected versions and audit data.');
}
// 4. Workflow
{
  const s = p.slides.add(); header(s, 'How FWD works', 'Evidence-to-decision workflow', 4);
  text(s, 'Analysis runs autonomously; the PM owns changes and decisions.', 58, 190, 1100, 34, { size: 22, color: C.muted });
  const steps = [
    ['01', 'Scope + ingest', 'Vehicle, market\nand source files'],
    ['02', 'Normalize', 'Deduplicate; keep\nsource locations'],
    ['03', 'Analyze', 'Group findings; check\nbaseline; research if selected'],
    ['04', 'Propose', 'Alternatives, requirements\nand explained priority'],
    ['05', 'PM review', 'Edit, decide, version\nand export'],
  ];
  const xs = [44, 288, 532, 776, 1020];
  steps.forEach((st, i) => {
    const x = xs[i];
    text(s, st[0], x, 278, 210, 45, { size: 34, bold: true, color: C.blue });
    text(s, st[1], x, 344, 210, 40, { size: 21, bold: true });
    text(s, st[2], x, 400, 210, 82, { size: 17, color: C.muted });
    if (i < 4) line(s, x, 328, 210, C.line, 2);
  });
  line(s, 44, 532, 1178, C.line, 1);
  text(s, 'Optional: Deep Dive research during analysis; Reimagine after proposals. PM edits create a new version; prior versions stay inspectable.', 44, 562, 1170, 54, { size: 17, color: C.muted });
  addTextAndNotes(s, 'Cross-checked against the supplied BMW challenge in doc/more.md, plan.md, backend_plan.md, backend/TESTING_HANDOFF.md and backend/app/workflows.py. The core pipeline covers heterogeneous upload and source snapshot; parsing, normalization and deduplication; source-linked findings and baseline checks; optional Deep Dive; versioned requirements/proposals with explainable scoring; PM edits/decisions; optional exact-version Reimagine; and exact-version export with audit. Research failures yield explicit gaps, and renderer failure does not block proposals. AI does not approve requirements.');
}
// 5. Traceable evidence
{
  const s = p.slides.add(); header(s, 'BMW feedback', 'G60 feedback on screen access', 5);
  rect(s, 60, 270, 5, 228, C.blue);
  text(s, '“The screen layout is not very intuitive for accessing some functions.”', 96, 278, 1060, 142, { size: 40, bold: true, color: C.ink });
  text(s, 'US · G60-0248 · Feedback_Explorer, row 313', 98, 476, 1000, 30, { size: 17, color: C.muted });
  addTextAndNotes(s, 'Source: doc/googledrive/G60_feedback_hackathon.xlsx, worksheet Feedback_Explorer, row 313. ID G60-0248, country US, derivative code G60, engine type ICE, category Operating concept, operating system. The former visible label “Difficult to Use” has been removed. This single source row does not establish prevalence, trim applicability, or exact feature availability.');
}
// 6. Alternatives
{
  const s = p.slides.add(); header(s, 'Alternatives', 'One task. More than one plausible design.', 6);
  rect(s, 58, 272, 300, 176, C.pale);
  sectionLabel(s, 'Customer task', 82, 296, 220);
  text(s, 'Reach frequent\nvehicle functions\nwith fewer steps', 82, 332, 248, 96, { size: 25, bold: true });
  // connective branches
  rect(s, 358, 354, 58, 6, C.blue);
  rect(s, 410, 280, 6, 150, C.blue);
  arrow(s, 410, 272, 58);
  arrow(s, 410, 418, 58);
  rect(s, 476, 230, 710, 156, C.white, C.line, 1);
  rect(s, 476, 420, 710, 156, C.white, C.line, 1);
  text(s, 'A', 504, 265, 58, 52, { size: 34, bold: true, color: C.blue, align: 'center' });
  text(s, 'Shorter digital path', 580, 262, 500, 38, { size: 24, bold: true });
  text(s, 'Favorites or shortcuts for frequent tasks.', 580, 312, 540, 32, { size: 18, color: C.muted });
  text(s, 'B', 504, 455, 58, 52, { size: 34, bold: true, color: C.blue, align: 'center' });
  text(s, 'Tactile access for selected tasks', 580, 451, 540, 38, { size: 24, bold: true });
  text(s, 'Test whether some controls need a more direct interaction.', 580, 501, 560, 42, { size: 18, color: C.muted });
  addTextAndNotes(s, 'Evidence anchor: G60-0248, row 313, requests simpler or click-type access. Counterpoint: G60-0105, row 129, says the customer is enjoying the screen interface. These are distinct records; they do not prove directly comparable customer groups or validate either proposed design.');
}
// 7. Priority policy
{
  const s = p.slides.add(); header(s, 'Setting priorities', 'Priority waits for matched evidence.', 7);
  badge(s, 'REAL G60 CASE · NOT SCORED', 58, 206, 250, C.amberPale, C.amber);
  const fields = [
    ['CUSTOMER IMPACT', 'Not rated'],
    ['TARGET-GROUP REACH', 'Not established'],
    ['CURRENT OFFERING GAP', 'Unknown'],
    ['FUTURE RELEVANCE', 'Assumption'],
  ];
  fields.forEach((f, i) => {
    const x = 60 + i * 294;
    rect(s, x, 275, 270, 126, C.white, C.line, 1);
    text(s, f[0], x + 18, 297, 236, 20, { size: 13, bold: true, color: C.muted });
    text(s, f[1], x + 18, 338, 236, 42, { size: 22, bold: true, color: C.ink });
  });
  rect(s, 60, 448, 1124, 142, C.navy);
  text(s, 'PRIORITY', 88, 480, 200, 20, { size: 14, bold: true, color: '#AEBBD0' });
  text(s, 'Not scored', 88, 514, 430, 52, { size: 38, bold: true, color: C.white });
  text(s, 'A few source records and an unmatched vehicle baseline cannot support a defensible case score.', 540, 493, 580, 62, { size: 20, color: '#D4DCEA' });
  text(s, 'Scoring workflow exists. Weights remain a project policy, not BMW guidance.', 60, 612, 1080, 26, { size: 17, color: C.muted });
  addTextAndNotes(s, 'The previous 75-to-67 example and its factor ratings were synthetic. This slide deliberately withholds a score because the cited feedback records do not establish customer impact, target-group reach, matched feature availability, or successor relevance. Weights are project policy, not BMW-prescribed.');
}
// 8. Candidate requirement
{
  const s = p.slides.add(); header(s, 'The output', 'A candidate requirement, pending review.', 8);
  badge(s, 'SOURCE-BASED DRAFT · NOT APPROVED', 58, 202, 318);
  rect(s, 58, 256, 1164, 332, C.white, C.line, 1);
  rect(s, 58, 256, 188, 332, C.soft);
  text(s, 'FWD', 82, 282, 90, 32, { size: 24, bold: true });
  text(s, 'Review\nworkspace', 82, 356, 130, 62, { size: 20, bold: true });
  text(s, 'Evidence\nRequirements\nVersions', 82, 449, 130, 76, { size: 16, color: C.muted });
  sectionLabel(s, 'REQ-DRAFT-01', 276, 286, 190);
  text(s, 'Drivers can reach frequently used functions through clear, consistent paths with fewer steps.', 276, 326, 570, 110, { size: 27, bold: true });
  text(s, 'Evidence', 276, 458, 140, 22, { size: 14, bold: true, color: C.blue });
  text(s, 'G60-0248 · row 313\nG60-0635 · row 797', 276, 488, 320, 54, { size: 16, color: C.muted });
  line(s, 860, 286, 1, C.line, 260);
  sectionLabel(s, 'SCOPE', 900, 294, 220);
  text(s, 'BMW 5 Series G60\nUS feedback records', 900, 330, 270, 60, { size: 21, bold: true });
  sectionLabel(s, 'OPEN CHECKS', 900, 417, 220);
  text(s, 'Exact trim, current feature baseline, reach and successor relevance.', 900, 451, 270, 78, { size: 17, color: C.muted });
  badge(s, 'PROPOSED WORDING · NEEDS PM REVIEW', 900, 536, 286, C.pale, C.blue);
  text(s, 'Two source examples. Not a prevalence estimate.', 276, 554, 500, 22, { size: 14, color: C.muted });
  addTextAndNotes(s, 'Draft language based on BMW G60 feedback workbook, Feedback_Explorer rows 313 (G60-0248) and 797 (G60-0635). This is a manually prepared candidate for the pitch deck, not a stored backend proposal or PM-approved requirement. It does not claim population prevalence.');
}
// 9. Reimagine boundary and design hypothesis
{
  const s = p.slides.add(); header(s, 'Reimagine', 'A design hypothesis for faster access.', 9);
  sectionLabel(s, 'TODAY · REPORTED FRICTION', 60, 232, 430);
  sectionLabel(s, 'CONCEPT · FEWER STEPS', 664, 232, 420);
  rect(s, 60, 274, 520, 260, C.white, C.line, 1);
  rect(s, 60, 274, 520, 48, C.soft);
  text(s, 'Vehicle settings', 84, 288, 300, 24, { size: 19, bold: true });
  text(s, 'Home  /  Vehicle  /  Function', 86, 350, 430, 28, { size: 18, color: C.muted });
  rect(s, 86, 405, 464, 74, '#F2F5FA', C.line, 1);
  text(s, 'Find function through several screens', 108, 428, 420, 32, { size: 20, bold: true });
  rect(s, 664, 274, 556, 260, C.white, C.line, 1);
  rect(s, 664, 274, 556, 48, C.soft);
  text(s, 'Vehicle home', 688, 288, 300, 24, { size: 19, bold: true });
  text(s, 'Frequent functions', 688, 350, 440, 32, { size: 24, bold: true });
  rect(s, 688, 405, 236, 76, C.pale, 'none', 0);
  text(s, 'Saved action A', 706, 429, 196, 28, { size: 18, bold: true, color: C.blue });
  rect(s, 944, 405, 244, 76, C.pale, 'none', 0);
  text(s, 'Saved action B', 962, 429, 204, 28, { size: 18, bold: true, color: C.blue });
  text(s, 'UI concept only. Current Reimagine proof supports a bounded front-seat resize, not dashboard redesign.', 60, 584, 1120, 48, { size: 17, color: C.muted });
  addTextAndNotes(s, 'The before/after is an editable UI concept based on G60 feedback, not an app-generated artifact. Repo documentation states current downloaded BMW geometry supports a bounded resize of one independently separated front seat. It does not establish touchscreen redesign or engineering validation. See README.md and doc/reimagine-assets.md.');
}
// 10. Status and next proof
{
  const s = p.slides.add(); header(s, 'Status and next step', 'Integrated prototype. Scoped proof still needed.', 10);
  rect(s, 58, 220, 532, 376, C.white, C.line, 1);
  sectionLabel(s, 'TODAY', 86, 250, 130);
  text(s, 'Connected application', 86, 296, 430, 38, { size: 28, bold: true });
  const today = [
    'Frontend and backend are combined.',
    'Real-source runs exercised on bounded samples.',
    'Current UI screenshots use fixture content.',
    'Vehicle and part catalog still synthetic for G60 run.',
  ];
  today.forEach((t, i) => {
    text(s, `0${i+1}`, 86, 360 + i * 48, 40, 22, { size: 15, bold: true, color: C.blue });
    text(s, t, 132, 357 + i * 48, 410, 35, { size: 17, color: C.muted });
  });
  rect(s, 690, 220, 532, 376, C.pale);
  sectionLabel(s, 'NEXT', 720, 250, 130);
  text(s, 'One coherent BMW case', 720, 296, 460, 38, { size: 28, bold: true });
  const next = [
    'Match US feedback to the relevant baseline.',
    'Show exact source and a reviewed requirement.',
    'Record PM decision on the exact version.',
    'Export the decision trace.',
  ];
  next.forEach((t, i) => {
    text(s, `0${i+1}`, 720, 360 + i * 48, 40, 22, { size: 15, bold: true, color: C.blue });
    text(s, t, 766, 357 + i * 48, 410, 35, { size: 17, color: C.ink });
  });
  addTextAndNotes(s, 'Repo evidence: frontend and backend are connected. Backend handoff records a real three-record G60 run with three findings and three changes; the vehicle/part catalog was synthetic, so exact derivative and equipment applicability remain unverified. Combined frontend verification used synthetic UI harness content; no live service was running during this deck update. References: README.md, backend/TESTING_HANDOFF.md, doc/frontend/COMBINED-VERIFICATION.md.');
}
// 11. Close
{
  const s = p.slides.add(); darkHeader(s, 11, 'AI VEHICLE REQUIREMENTS LAB');
  text(s, 'Next proof: one scoped\nG60 case.', 58, 110, 610, 126, { size: 48, bold: true, color: C.white });
  const rows = [
    ['Scope', 'US G60 family; exact trim open'],
    ['Trace', 'A finding to its source row'],
    ['Review', 'A candidate requirement'],
    ['Decide', 'A PM-owned version and export'],
  ];
  rows.forEach((r, i) => {
    const y = 310 + i * 64;
    text(s, r[0], 64, y, 130, 28, { size: 20, bold: true, color: C.white });
    text(s, r[1], 228, y, 420, 34, { size: 18, color: '#C8D2E1' });
  });
  rect(s, 64, 590, 130, 5, C.blue);
  addTextAndNotes(s, 'Close with the bounded next proof. Do not claim one-record feedback validates broad market need, exact derivative fit, a BMW-approved score, or generated dashboard geometry.');
}

for (const [i, slide] of p.slides.items.entries()) {
  const stem = `slide-v2-${String(i+1).padStart(2,'0')}`;
  const png = await p.export({ slide, format: 'png', scale: 1 });
  await fs.writeFile(path.join(BUILD, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
}
const pptx = await PresentationFile.exportPptx(p);
await pptx.save(OUT);
console.log(JSON.stringify({ slides: p.slides.items.length, draft: OUT }));
