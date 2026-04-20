#!/usr/bin/env node
/**
 * mask-and-remap.js — apply a binary silhouette mask to freeze a subject
 * inside a color-cycling scene.
 *
 * The trick: where the mask is white (subject), find every pixel whose palette
 * index falls inside a cycling range, and reassign it to the nearest palette
 * entry OUTSIDE all cycling ranges. The palette doesn't change — only specific
 * pixel→palette pointers move. The visual color is virtually identical (we
 * pick the closest non-cycling RGB match), but those pixels no longer rotate
 * with the cycling palette range, so the subject appears frozen while the
 * background animates around it.
 *
 * Usage:
 *   node mask-and-remap.js \
 *     --data /tmp/cycle-data.json \
 *     --mask-image-id <MASK_IMG_ID> \
 *     --cycles '[{"lo":135,"hi":205},{"lo":115,"hi":145}]'
 *
 * The data file is updated in place (data.indexedB64 is replaced).
 *
 * Requires: sharp.
 */

const sharp = require('sharp');
const zlib = require('zlib');
const fs = require('fs');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const DATA = args.data;
const MASK_ID = args['mask-image-id'];
const CYCLES_JSON = args.cycles;
const THRESHOLD = parseInt(args.threshold || '128', 10);
const TOKEN = process.env.AGNT_AUTH_TOKEN;
const API = process.env.AGNT_API || 'http://localhost:3333/api';

if (!DATA || !MASK_ID || !CYCLES_JSON) {
  console.error('Usage: --data <path> --mask-image-id <id> --cycles <json>');
  process.exit(1);
}

(async () => {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const W = data.width, H = data.height, N = W * H;
  const cycles = JSON.parse(CYCLES_JSON);

  // Decode current indexed buffer + palette
  const indexed = zlib.inflateRawSync(Buffer.from(data.indexedB64, 'base64'));
  const palBuf = Buffer.from(data.paletteB64, 'base64');
  const palette = [];
  for (let i = 0; i < 256; i++) palette.push([palBuf[i * 3], palBuf[i * 3 + 1], palBuf[i * 3 + 2]]);

  // Fetch + binarize the mask
  const r = await fetch(`${API}/images/${MASK_ID}`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) { console.error('Mask fetch failed:', r.status); process.exit(1); }
  const maskRaw = Buffer.from(await r.arrayBuffer());
  const { data: rgba } = await sharp(maskRaw)
    .resize(W, H, { kernel: 'nearest' })  // nearest preserves hard edges
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const mask = new Uint8Array(N);
  let whiteCount = 0;
  for (let i = 0; i < N; i++) {
    const lum = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    mask[i] = lum > THRESHOLD ? 1 : 0;
    if (mask[i]) whiteCount++;
  }
  console.log(`✓ Mask: ${whiteCount} subject px / ${N - whiteCount} background px (threshold=${THRESHOLD})`);

  // Mark which palette indices are in cycling ranges
  const isCycling = new Uint8Array(256);
  for (const c of cycles) for (let i = c.lo; i <= c.hi; i++) isCycling[i] = 1;
  const cyclingCount = isCycling.reduce((a, b) => a + b, 0);
  console.log(`✓ Cycling palette entries: ${cyclingCount}/256`);

  // Remap: for each subject pixel using a cycling color, find nearest non-cycling palette entry
  const remapCache = new Map();
  let remapped = 0;
  let totalShift = 0;

  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const oldIdx = indexed[i];
    if (!isCycling[oldIdx]) continue;

    let newIdx = remapCache.get(oldIdx);
    if (newIdx === undefined) {
      const [or, og, ob] = palette[oldIdx];
      let best = -1, bd = Infinity;
      for (let p = 0; p < 256; p++) {
        if (isCycling[p]) continue;
        const [pr, pg, pb] = palette[p];
        const dr = or - pr, dg = og - pg, db = ob - pb;
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = p; }
      }
      newIdx = best;
      remapCache.set(oldIdx, newIdx);
    }
    const [or, og, ob] = palette[oldIdx];
    const [nr, ng, nb] = palette[newIdx];
    totalShift += Math.sqrt((or - nr) ** 2 + (og - ng) ** 2 + (ob - nb) ** 2);
    indexed[i] = newIdx;
    remapped++;
  }

  console.log(`✓ Remapped ${remapped} pixels  avg color shift = ${(totalShift / Math.max(1, remapped)).toFixed(2)} RGB`);

  // Re-compress and write back
  const compressed = zlib.deflateRawSync(Buffer.from(indexed), { level: 9 });
  data.indexedB64 = compressed.toString('base64');
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
  console.log(`✓ Updated ${DATA}  (new indexedB64: ${data.indexedB64.length} chars)`);
})().catch((e) => { console.error(e); process.exit(1); });
