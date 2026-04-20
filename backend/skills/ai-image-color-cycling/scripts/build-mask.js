#!/usr/bin/env node
/**
 * build-mask.js — construct a binary mask DIRECTLY FROM the indexed image,
 * with zero need for a separately-generated mask image. The mask is derived
 * from the exact same pixels as the scene, so alignment is guaranteed.
 *
 * Two modes:
 *
 *   --mode subject   Detect a subject (character/object) by palette-color
 *                    classification + connected components + morphology.
 *                    You describe the subject's colors (e.g. "yellow,red").
 *
 *   --mode boxes     Stamp explicit rectangular bounding boxes as mask.
 *                    Useful for UI elements (text boxes, menus, HUD) whose
 *                    bboxes you obtained by vision analysis or row-density
 *                    scanning. Pass --boxes '[{"left":5,"top":3,"right":255,"bottom":29}]'.
 *
 *   --mode ui-auto   Auto-detect rectangular UI regions: find rows with a
 *                    high density of "UI-colored" pixels (near-black +
 *                    near-white), cluster the rows into bands, and stamp
 *                    their x-extent as bboxes. Needs --exclude <mask.png>
 *                    so Pikachu's black outline doesn't count as UI.
 *
 * You can run this script multiple times with --merge <existing.png> to UNION
 * new mask pixels into an existing mask file. This is how you build up a
 * compound mask (subject + UI).
 *
 * Outputs: a single-channel PNG (white = masked / frozen, black = free).
 *
 * Usage:
 *   # Subject mask from palette colors
 *   node build-mask.js --data cycle-data.json --mode subject \
 *        --colors '{"yellow":{"h":[35,75],"s":[0.55,1],"l":[0.45,0.85]},
 *                   "red":{"h":[340,20],"s":[0.55,1],"l":[0.25,0.65]}}' \
 *        --center-y '[0.40,1.0]' --min-blob-frac 0.05 \
 *        --close 3 --dilate 2 \
 *        --out pikachu-mask.png
 *
 *   # Explicit UI boxes (from vision)
 *   node build-mask.js --data cycle-data.json --mode boxes \
 *        --boxes '[{"left":5,"top":3,"right":255,"bottom":29},
 *                  {"left":144,"top":104,"right":255,"bottom":143}]' \
 *        --merge pikachu-mask.png \
 *        --out combined-mask.png
 *
 *   # Auto-detect UI bands
 *   node build-mask.js --data cycle-data.json --mode ui-auto \
 *        --exclude pikachu-mask.png --dense-row-thresh 35 \
 *        --merge pikachu-mask.png \
 *        --out combined-mask.png
 *
 * Requires: sharp, zlib, fs.
 */

const sharp = require('sharp');
const zlib = require('zlib');
const fs = require('fs');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const DATA    = args.data;
const MODE    = args.mode || 'subject';
const OUT     = args.out;
const MERGE   = args.merge || null;
if (!DATA || !OUT) { console.error('Required: --data <path> --out <path>'); process.exit(1); }

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h, s, l = (mx + mn) / 2;
  if (mx === mn) { h = s = 0; }
  else {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}
function hueInRange(h, lo, hi) {
  // hi can wrap around 0 (e.g. red: 340..20)
  if (lo <= hi) return h >= lo && h <= hi;
  return h >= lo || h <= hi;
}
function dilate(m, r, W, H, N) {
  const out = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let dy = -r; dy <= r && !v; dy++) for (let dx = -r; dx <= r && !v; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && m[ny * W + nx]) v = 1;
    }
    out[y * W + x] = v;
  }
  return out;
}
function erode(m, r, W, H, N) {
  const out = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1;
    for (let dy = -r; dy <= r && v; dy++) for (let dx = -r; dx <= r && v; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || !m[ny * W + nx]) v = 0;
    }
    out[y * W + x] = v;
  }
  return out;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const W = data.width, H = data.height, N = W * H;
  const indexed = zlib.inflateRawSync(Buffer.from(data.indexedB64, 'base64'));
  const palBuf = Buffer.from(data.paletteB64, 'base64');
  const palette = [];
  for (let i = 0; i < 256; i++) palette.push([palBuf[i * 3], palBuf[i * 3 + 1], palBuf[i * 3 + 2]]);

  let mask = new Uint8Array(N);

  if (MODE === 'subject') {
    if (!args.colors) { console.error('subject mode requires --colors JSON'); process.exit(1); }
    const colorSpec = JSON.parse(args.colors);
    const closeR   = parseInt(args.close   || '3',  10);
    const dilateR  = parseInt(args.dilate  || '2',  10);
    const minFrac  = parseFloat(args['min-blob-frac'] || '0.05');
    const centerY  = JSON.parse(args['center-y'] || '[0,1]');
    const centerX  = JSON.parse(args['center-x'] || '[0,1]');

    // classify palette entries
    const match = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = palette[i];
      const [h, s, l] = rgb2hsl(r, g, b);
      for (const key of Object.keys(colorSpec)) {
        const spec = colorSpec[key];
        if (hueInRange(h, spec.h[0], spec.h[1]) &&
            s >= spec.s[0] && s <= spec.s[1] &&
            l >= spec.l[0] && l <= spec.l[1]) {
          match[i] = 1; break;
        }
      }
    }
    const matchCount = match.reduce((a, b) => a + b, 0);
    console.log(`✓ ${matchCount} palette entries match subject colors`);
    if (matchCount === 0) { console.error('No palette entries matched — loosen --colors thresholds'); process.exit(1); }

    // seed
    const seed = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (match[indexed[i]]) seed[i] = 1;

    // connected components (4-connected)
    const label = new Int32Array(N);
    const sizes = [0];
    const stack = [];
    let nxt = 0;
    for (let i = 0; i < N; i++) {
      if (!seed[i] || label[i]) continue;
      nxt++; sizes.push(0); stack.push(i);
      while (stack.length) {
        const p = stack.pop();
        if (label[p] || !seed[p]) continue;
        label[p] = nxt; sizes[nxt]++;
        const x = p % W, y = (p - x) / W;
        if (x > 0) stack.push(p - 1);
        if (x < W - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - W);
        if (y < H - 1) stack.push(p + W);
      }
    }
    let biggest = 0, bsz = 0;
    for (let L = 1; L <= nxt; L++) if (sizes[L] > bsz) { bsz = sizes[L]; biggest = L; }
    console.log(`✓ ${nxt} blobs, largest=${bsz}px`);

    // keep blobs that meet size AND centroid constraints
    const keep = new Set();
    for (let L = 1; L <= nxt; L++) {
      if (sizes[L] < bsz * minFrac) continue;
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < N; i++) if (label[i] === L) { sx += i % W; sy += (i - i % W) / W; n++; }
      const cx = sx / n / W, cy = sy / n / H;
      const inBox = cx >= centerX[0] && cx <= centerX[1] && cy >= centerY[0] && cy <= centerY[1];
      console.log(`  blob L=${L} size=${n} centroid=(${(cx * W).toFixed(0)},${(cy * H).toFixed(0)}) ${inBox ? 'KEEP' : 'drop'}`);
      if (inBox) keep.add(L);
    }
    for (let i = 0; i < N; i++) if (keep.has(label[i])) mask[i] = 1;

    // morphology: close (dilate/erode) to fill interior gaps, then dilate to grab outline
    if (closeR > 0) { mask = dilate(mask, closeR, W, H, N); mask = erode(mask, closeR - 1 > 0 ? closeR - 1 : 1, W, H, N); }
    if (dilateR > 0) mask = dilate(mask, dilateR, W, H, N);
  }

  else if (MODE === 'boxes') {
    const boxes = JSON.parse(args.boxes || '[]');
    for (const b of boxes) {
      const x0 = Math.max(0, b.left), y0 = Math.max(0, b.top);
      const x1 = Math.min(W - 1, b.right), y1 = Math.min(H - 1, b.bottom);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * W + x] = 1;
      console.log(`✓ stamped box (${x0},${y0})-(${x1},${y1}) = ${(x1 - x0 + 1)}x${(y1 - y0 + 1)}`);
    }
  }

  else if (MODE === 'ui-auto') {
    const DENSE = parseInt(args['dense-row-thresh'] || '35', 10);

    // Classify UI colors: near-black (lum<35, sat<0.3) OR near-white (lum>225, sat<0.15)
    const isUI = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = palette[i];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
      const sat = maxc === 0 ? 0 : (maxc - minc) / maxc;
      if ((lum < 35 && sat < 0.3) || (lum > 225 && sat < 0.15)) isUI[i] = 1;
    }

    // Load exclusion mask (e.g. subject mask) so their dark outlines don't count as UI
    let excl = new Uint8Array(N);
    if (args.exclude) {
      const e = await sharp(args.exclude).resize(W, H, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < N; i++) {
        const lum = (e.data[i * 4] + e.data[i * 4 + 1] + e.data[i * 4 + 2]) / 3;
        if (lum > 128) excl[i] = 1;
      }
    }

    // UI pixels outside exclusion
    const uiX = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (isUI[indexed[i]] && !excl[i]) uiX[i] = 1;

    // Row density
    const rowUI = new Array(H).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (uiX[y * W + x]) rowUI[y]++;

    // Dense row ranges (allow 3-row gap merge)
    const ranges = [];
    let s = -1;
    for (let y = 0; y < H; y++) {
      if (rowUI[y] >= DENSE) { if (s === -1) s = y; }
      else if (s !== -1) { ranges.push({ y0: s, y1: y - 1 }); s = -1; }
    }
    if (s !== -1) ranges.push({ y0: s, y1: H - 1 });
    const merged = [];
    for (const r of ranges) {
      if (merged.length && r.y0 - merged[merged.length - 1].y1 <= 3) merged[merged.length - 1].y1 = r.y1;
      else merged.push({ ...r });
    }

    // For each band, find dense column runs
    const boxes = [];
    for (const r of merged) {
      const rh = r.y1 - r.y0 + 1;
      const colCnt = new Array(W).fill(0);
      for (let y = r.y0; y <= r.y1; y++) for (let x = 0; x < W; x++) if (uiX[y * W + x]) colCnt[x]++;
      const cT = Math.max(1, Math.floor(rh * 0.25));
      const runs = []; let cs = -1;
      for (let x = 0; x < W; x++) {
        if (colCnt[x] >= cT) { if (cs === -1) cs = x; }
        else if (cs !== -1) {
          if (runs.length && x - runs[runs.length - 1].x1 <= 4) runs[runs.length - 1].x1 = x - 1;
          else runs.push({ x0: cs, x1: x - 1 });
          cs = -1;
        }
      }
      if (cs !== -1) runs.push({ x0: cs, x1: W - 1 });
      for (const rr of runs) {
        const rw = rr.x1 - rr.x0 + 1;
        if (rw >= 30) {
          boxes.push({ x0: Math.max(0, rr.x0 - 1), y0: Math.max(0, r.y0 - 1), x1: Math.min(W - 1, rr.x1 + 1), y1: Math.min(H - 1, r.y1 + 1) });
        }
      }
    }
    console.log(`✓ detected ${boxes.length} UI box(es)`);
    for (const b of boxes) {
      console.log(`  (${b.x0},${b.y0})-(${b.x1},${b.y1}) = ${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}`);
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) mask[y * W + x] = 1;
    }
  }

  else { console.error('Unknown --mode:', MODE); process.exit(1); }

  // Merge with existing mask via union
  if (MERGE && fs.existsSync(MERGE)) {
    const e = await sharp(MERGE).resize(W, H, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < N; i++) {
      const lum = (e.data[i * 4] + e.data[i * 4 + 1] + e.data[i * 4 + 2]) / 3;
      if (lum > 128) mask[i] = 1;
    }
    console.log(`✓ unioned with ${MERGE}`);
  }

  // Report
  const maskCount = mask.reduce((a, b) => a + b, 0);
  console.log(`✓ final mask: ${maskCount} px (${(100 * maskCount / N).toFixed(1)}% of image)`);

  // Write grayscale PNG (white=subject, black=free)
  const rgba = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const v = mask[i] ? 255 : 0;
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toFile(OUT);
  console.log(`✓ wrote ${OUT}`);

  // Also write a preview if requested
  if (args['preview-out']) {
    const prg = Buffer.alloc(N * 4);
    for (let i = 0; i < N; i++) {
      const idx = indexed[i];
      let r = palBuf[idx * 3], g = palBuf[idx * 3 + 1], b = palBuf[idx * 3 + 2];
      if (!mask[i]) { r = (r * 0.3) | 0; g = (g * 0.3) | 0; b = (b * 0.3) | 0; }
      prg[i * 4] = r; prg[i * 4 + 1] = g; prg[i * 4 + 2] = b; prg[i * 4 + 3] = 255;
    }
    const scale = parseInt(args['preview-scale'] || '4', 10);
    await sharp(prg, { raw: { width: W, height: H, channels: 4 } })
      .resize(W * scale, H * scale, { kernel: 'nearest' }).png().toFile(args['preview-out']);
    console.log(`✓ wrote preview ${args['preview-out']}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
