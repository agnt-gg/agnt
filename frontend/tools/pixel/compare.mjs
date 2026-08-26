// Pixel + semantic differ for two harness runs.
//
//   node compare.mjs before after
//
// Emits a per-route report and writes a red-highlight diff PNG for anything
// that moved. Exit code is 0 always — this is an instrument, not a gate; the
// caller decides what an acceptable delta is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');

const [aLabel, bLabel] = process.argv.slice(2);
if (!aLabel || !bLabel) {
  console.error('usage: node compare.mjs <labelA> <labelB>');
  process.exit(1);
}
const aDir = path.join(SHOTS, aLabel);
const bDir = path.join(SHOTS, bLabel);
const outDir = path.join(SHOTS, `diff-${aLabel}-${bLabel}`);
fs.mkdirSync(outDir, { recursive: true });

const raw = async (file) => {
  const img = sharp(file).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};

const names = fs
  .readdirSync(aDir)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .filter((n) => fs.existsSync(path.join(bDir, `${n}.png`)));

const THRESH = 12; // per-channel tolerance; kills antialiasing noise
const rows = [];

for (const name of names) {
  const A = await raw(path.join(aDir, `${name}.png`));
  const B = await raw(path.join(bDir, `${name}.png`));

  if (A.w !== B.w || A.h !== B.h) {
    rows.push({ name, pct: 100, note: `size ${A.w}x${A.h} -> ${B.w}x${B.h}` });
    continue;
  }

  const total = A.w * A.h;
  const overlay = Buffer.alloc(total * 4);
  let changed = 0;
  // Bounding box of the change, so the report can say WHERE it moved.
  let minX = A.w, minY = A.h, maxX = -1, maxY = -1;

  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const dr = Math.abs(A.data[p] - B.data[p]);
    const dg = Math.abs(A.data[p + 1] - B.data[p + 1]);
    const db = Math.abs(A.data[p + 2] - B.data[p + 2]);
    const diff = dr > THRESH || dg > THRESH || db > THRESH;
    if (diff) {
      changed++;
      const x = i % A.w;
      const y = (i / A.w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      overlay[p] = 255; overlay[p + 1] = 0; overlay[p + 2] = 0; overlay[p + 3] = 235;
    } else {
      // dim the unchanged background so the red reads clearly
      const g = (A.data[p] * 0.3 + A.data[p + 1] * 0.59 + A.data[p + 2] * 0.11) * 0.55;
      overlay[p] = overlay[p + 1] = overlay[p + 2] = g;
      overlay[p + 3] = 255;
    }
  }

  const pct = (changed / total) * 100;
  const note = maxX >= 0 ? `box ${minX},${minY} ${maxX - minX + 1}x${maxY - minY + 1}` : 'identical';
  rows.push({ name, pct, note });

  if (changed > 0) {
    await sharp(overlay, { raw: { width: A.w, height: A.h, channels: 4 } })
      .png()
      .toFile(path.join(outDir, `${name}.diff.png`));
  }
}

// Semantic channel: what CONTENT changed, independent of pixels.
const readText = (dir, name) => {
  const f = path.join(dir, `${name}.txt`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n') : null;
};

console.log(`=== PIXEL DIFF  ${aLabel} -> ${bLabel} ===`);
console.log('route            changed%   where');
for (const r of rows.sort((x, y) => y.pct - x.pct)) {
  const flag = r.pct === 0 ? '  ' : r.pct < 0.5 ? ' ~' : ' *';
  console.log(`${flag}${r.name.padEnd(16)} ${r.pct.toFixed(3).padStart(8)}   ${r.note}`);
}

console.log(`\n=== SEMANTIC DIFF (content lines) ===`);
let semanticClean = true;
for (const name of names) {
  const a = readText(aDir, name);
  const b = readText(bDir, name);
  if (!a || !b) continue;
  const [ca, cb] = [a[0], b[0]];
  const sa = new Set(a.slice(1));
  const sb = new Set(b.slice(1));
  const gone = [...sa].filter((l) => !sb.has(l));
  const added = [...sb].filter((l) => !sa.has(l));
  if (ca !== cb || gone.length || added.length) {
    semanticClean = false;
    console.log(`\n  ${name}`);
    if (ca !== cb) console.log(`    structure: ${ca}\n            -> ${cb}`);
    if (gone.length) console.log(`    -removed: ${gone.slice(0, 8).join(' | ').slice(0, 150)}`);
    if (added.length) console.log(`    +added:   ${added.slice(0, 8).join(' | ').slice(0, 150)}`);
  }
}
if (semanticClean) console.log('  (no content changed on any route)');

const moved = rows.filter((r) => r.pct > 0);
console.log(`\n${moved.length}/${rows.length} routes changed pixels. diffs -> ${outDir}`);
