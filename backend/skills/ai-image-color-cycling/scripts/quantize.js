#!/usr/bin/env node
/**
 * quantize.js — fetch an AGNT-generated image, downscale, median-cut quantize
 * to 256 colors, sort palette by hue/luminance, auto-detect cycling ranges,
 * deflate-compress the indexed buffer, and emit JSON.
 *
 * Usage:
 *   node quantize.js --image-id <ID> --width 200 --height 150 --out /tmp/data.json
 *
 * Requires: sharp (already available in the AGNT runtime).
 */

const sharp = require('sharp');
const zlib = require('zlib');
const fs = require('fs');

// ---- arg parsing -----------------------------------------------------------
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const IMAGE_ID = args['image-id'];
const W = parseInt(args.width || '200', 10);
const H = parseInt(args.height || '150', 10);
const OUT = args.out || '/tmp/cycle-data.json';
const TOKEN = process.env.AGNT_AUTH_TOKEN;
const API = process.env.AGNT_API || 'http://localhost:3333/api';

if (!IMAGE_ID) {
  console.error('Missing --image-id');
  process.exit(1);
}
if (!TOKEN) {
  console.error('Missing AGNT_AUTH_TOKEN env var');
  process.exit(1);
}

(async () => {
  // ---- 1. fetch the image bytes -------------------------------------------
  const r = await fetch(`${API}/images/${IMAGE_ID}`, {
    headers: { Authorization: 'Bearer ' + TOKEN },
  });
  if (!r.ok) {
    console.error('Image fetch failed:', r.status);
    process.exit(1);
  }
  const imgBuf = Buffer.from(await r.arrayBuffer());
  console.log(`✓ Fetched image: ${imgBuf.length} bytes`);

  // ---- 2. sharp downscale to raw RGBA -------------------------------------
  const { data: rgba } = await sharp(imgBuf)
    .resize(W, H, { kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log(`✓ Downscaled to ${W}×${H}`);

  // ---- 3. median-cut quantize to 256 colors -------------------------------
  const N = W * H;
  const pixels = new Array(N);
  for (let i = 0; i < N; i++) pixels[i] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];

  function medianCut(buckets, depth, max) {
    if (depth === max) return buckets;
    const out = [];
    for (const b of buckets) {
      if (b.length < 2) { out.push(b); continue; }
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (const p of b) {
        if (p[0] < rMin) rMin = p[0]; if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1]; if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2]; if (p[2] > bMax) bMax = p[2];
      }
      const dR = rMax - rMin, dG = gMax - gMin, dB = bMax - bMin;
      let axis = 0;
      if (dG >= dR && dG >= dB) axis = 1;
      else if (dB >= dR && dB >= dG) axis = 2;
      b.sort((a, c) => a[axis] - c[axis]);
      const mid = b.length >> 1;
      out.push(b.slice(0, mid));
      out.push(b.slice(mid));
    }
    return medianCut(out, depth + 1, max);
  }

  const t0 = Date.now();
  const buckets = medianCut([pixels.slice()], 0, 8); // 2^8 = 256
  let palette = buckets.map((b) => {
    let r = 0, g = 0, bb = 0;
    for (const p of b) { r += p[0]; g += p[1]; bb += p[2]; }
    const n = b.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(bb / n)];
  });
  // pad to exactly 256 if median-cut produced fewer (rare)
  while (palette.length < 256) palette.push([0, 0, 0]);
  console.log(`✓ Quantized to ${palette.length} colors in ${Date.now() - t0} ms`);

  // ---- 4. map each pixel to nearest palette entry -------------------------
  const cache = new Map();
  function nearest(r, g, b) {
    const k = (r << 16) | (g << 8) | b;
    if (cache.has(k)) return cache.get(k);
    let best = 0, bd = Infinity;
    for (let i = 0; i < 256; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    cache.set(k, best);
    return best;
  }
  const indexed = new Uint8Array(N);
  for (let i = 0; i < N; i++) indexed[i] = nearest(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);

  // ---- 5. sort palette by hue/luminance & re-map indexed buffer -----------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h, s;
    if (max === min) { h = 0; s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h, s, l];
  }

  const meta = palette.map((c, i) => {
    const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
    return { c, i, h, s, l };
  });

  // Sort: dark/desaturated first (in luminance order), then chromatic by hue+luminance
  meta.sort((a, b) => {
    const aLow = a.s < 0.15 || a.l < 0.08;
    const bLow = b.s < 0.15 || b.l < 0.08;
    if (aLow !== bLow) return aLow ? -1 : 1;
    if (aLow && bLow) return a.l - b.l;
    if (Math.abs(a.h - b.h) > 0.02) return a.h - b.h;
    return a.l - b.l;
  });

  const remap = new Uint8Array(256);
  const newPal = new Array(256);
  for (let i = 0; i < 256; i++) {
    remap[meta[i].i] = i;
    newPal[i] = meta[i].c;
  }
  const newIdx = new Uint8Array(N);
  for (let i = 0; i < N; i++) newIdx[i] = remap[indexed[i]];

  // ---- 6. auto-detect cycling ranges --------------------------------------
  function findRange(predicate) {
    let lo = -1, hi = -1;
    for (let i = 0; i < 256; i++) {
      const [h, s, l] = rgbToHsl(...newPal[i]);
      if (predicate(h, s, l)) {
        if (lo === -1) lo = i;
        hi = i;
      }
    }
    return lo === -1 ? null : { lo, hi };
  }

  const ranges = {
    cyan:    findRange((h, s, l) => h > 0.42 && h < 0.58 && s > 0.3 && l > 0.2 && l < 0.85),
    teal:    findRange((h, s, l) => h > 0.42 && h < 0.6  && s > 0.3 && l > 0.1 && l < 0.5),
    blue:    findRange((h, s, l) => h > 0.58 && h < 0.78 && s > 0.25 && l > 0.1 && l < 0.7),
    magenta: findRange((h, s, l) => (h > 0.83 || h < 0.05) && s > 0.3 && l > 0.2 && l < 0.8),
    orange:  findRange((h, s, l) => h > 0.02 && h < 0.13 && s > 0.4 && l > 0.25),
    yellow:  findRange((h, s, l) => h > 0.13 && h < 0.20 && s > 0.4),
    green:   findRange((h, s, l) => h > 0.22 && h < 0.42 && s > 0.3 && l > 0.15),
    light:   findRange((h, s, l) => l > 0.6),
  };

  console.log('✓ Auto-detected ranges:');
  for (const [name, r] of Object.entries(ranges)) {
    if (r) console.log(`    ${name.padEnd(8)} ${r.lo}..${r.hi}  (${r.hi - r.lo + 1} entries)`);
  }

  // ---- 7. compress + base64 ----------------------------------------------
  const compressed = zlib.deflateRawSync(Buffer.from(newIdx), { level: 9 });
  const indexedB64 = compressed.toString('base64');

  const palBuf = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    palBuf[i * 3] = newPal[i][0];
    palBuf[i * 3 + 1] = newPal[i][1];
    palBuf[i * 3 + 2] = newPal[i][2];
  }
  const palB64 = palBuf.toString('base64');

  console.log(`✓ Indexed: ${newIdx.length} → ${compressed.length} compressed (${(compressed.length / newIdx.length * 100).toFixed(1)}%) → ${indexedB64.length} b64`);
  console.log(`✓ Palette: ${palB64.length} b64`);

  // ---- 8. write output ----------------------------------------------------
  // Histogram for picking ranges manually if auto-detect fails
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) hist[newIdx[i]]++;
  const top10 = Array.from(hist)
    .map((v, i) => ({ i, v, rgb: newPal[i] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);

  fs.writeFileSync(OUT, JSON.stringify({
    width: W,
    height: H,
    indexedB64,
    paletteB64: palB64,
    ranges,
    topUsedIndices: top10,
  }, null, 2));
  console.log(`✓ Wrote ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
