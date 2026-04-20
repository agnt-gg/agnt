#!/usr/bin/env node
/**
 * mask-and-remap.js — apply a binary mask to freeze pixels inside a color-
 * cycling scene.
 *
 * THE TRICK: where the mask is white, find every pixel whose palette index
 * is inside a cycling range, and reassign it to the nearest palette entry
 * OUTSIDE all cycling ranges. The palette itself never changes — only
 * specific pixel→palette pointers move. The visual color stays virtually
 * identical (we pick the closest RGB match), but those pixels no longer
 * rotate with the cycling ranges, so they appear frozen while the rest of
 * the image animates around them.
 *
 * The mask is a grayscale PNG (white = freeze, black = cycle). You build
 * it with `build-mask.js` directly from the indexed image — it is derived
 * from the exact same pixels as the scene, so alignment is guaranteed
 * pixel-perfect. DO NOT try to generate a mask image with a second call to
 * generate_image; AI models do not produce pixel-aligned silhouettes.
 *
 * Usage (recommended, local mask):
 *   node mask-and-remap.js \
 *     --data /tmp/cycle-data.json \
 *     --mask-png /tmp/subject-mask.png \
 *     --cycles '[{"lo":71,"hi":98},{"lo":99,"hi":200}]'
 *
 * Usage (legacy, fetch mask from images API):
 *   node mask-and-remap.js \
 *     --data /tmp/cycle-data.json \
 *     --mask-image-id <MASK_IMG_ID> \
 *     --cycles '[{"lo":71,"hi":98}]'
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
const DATA        = args.data;
const MASK_PNG    = args['mask-png'];
const MASK_ID     = args['mask-image-id'];
const CYCLES_JSON = args.cycles;
const THRESHOLD   = parseInt(args.threshold || '128', 10);
const TOKEN       = process.env.AGNT_AUTH_TOKEN;
const API         = process.env.AGNT_API || 'http://localhost:3333/api';

if (!DATA || (!MASK_PNG && !MASK_ID) || !CYCLES_JSON) {
  console.error('Usage: --data <path> (--mask-png <path> | --mask-image-id <id>) --cycles <json>');
  process.exit(1);
}

(async () => {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const W = data.width, H = data.height, N = W * H;
  const cycles = JSON.parse(CYCLES_JSON);

  // Decode current indexed buffer + palette
  const indexed = Buffer.from(zlib.inflateRawSync(Buffer.from(data.indexedB64, 'base64')));
  const palBuf = Buffer.from(data.paletteB64, 'base64');
  const palette = [];
  for (let i = 0; i < 256; i++) palette.push([palBuf[i * 3], palBuf[i * 3 + 1], palBuf[i * 3 + 2]]);

  // Load mask — either from local PNG path or from /api/images/:id
  let maskSource;
  if (MASK_PNG) {
    if (!fs.existsSync(MASK_PNG)) { console.error('Mask PNG not found:', MASK_PNG); process.exit(1); }
    maskSource = sharp(MASK_PNG);
  } else {
    const r = await fetch(`${API}/images/${MASK_ID}`, { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (!r.ok) { console.error('Mask fetch failed:', r.status); process.exit(1); }
    maskSource = sharp(Buffer.from(await r.arrayBuffer()));
  }

  const { data: rgba } = await maskSource
    .resize(W, H, { kernel: 'nearest' })  // nearest preserves hard edges
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const mask = new Uint8Array(N);
  let whiteCount = 0;
  for (let i = 0; i < N; i++) {
    const lum = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    mask[i] = lum > THRESHOLD ? 1 : 0;
    if (mask[i]) whiteCount++;
  }
  console.log(`✓ Mask: ${whiteCount} frozen px / ${N - whiteCount} free px (threshold=${THRESHOLD})`);

  // Mark which palette indices are in cycling ranges
  const isCycling = new Uint8Array(256);
  for (const c of cycles) for (let i = c.lo; i <= c.hi; i++) isCycling[i] = 1;
  const cyclingCount = isCycling.reduce((a, b) => a + b, 0);
  console.log(`✓ Cycling palette entries: ${cyclingCount}/256`);

  // Remap: for each masked pixel using a cycling color, find nearest non-cycling palette entry
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
  const compressed = zlib.deflateRawSync(indexed, { level: 9 });
  data.indexedB64 = compressed.toString('base64');
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
  console.log(`✓ Updated ${DATA}  (new indexedB64: ${data.indexedB64.length} chars)`);
})().catch((e) => { console.error(e); process.exit(1); });
