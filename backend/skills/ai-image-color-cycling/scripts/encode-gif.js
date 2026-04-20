#!/usr/bin/env node
/**
 * encode-gif.js — render the cycling animation as a seamlessly-looping GIF.
 *
 * Reads a quantize.js JSON bundle (palette + indexed buffer + source dims),
 * renders N frames stepping through the palette rotation, upscales with
 * nearest-neighbor, and encodes to a GIF via ffmpeg 2-pass for best quality.
 *
 * The cycle rates are AUTO-ADJUSTED so each cycle's period equals the loop
 * duration — guaranteeing a mathematically perfect seamless loop. The skill's
 * suggested HTML rates (5.5, 1.8, etc.) are tuned for vibey ambient motion;
 * for a GIF they would produce a 6-hour LCM. We pick rates that complete
 * exactly one rotation per loop so frame N == frame 0 perfectly.
 *
 * Usage:
 *   node encode-gif.js \
 *     --data /tmp/cycle-data.json \
 *     --cycles '[{"lo":137,"hi":210,"dir":1},{"lo":116,"hi":145,"dir":-1}]' \
 *     --duration 4 --fps 20 --scale 4 \
 *     --out /path/to/output.gif
 *
 * Note: --cycles entries don't need a `rate` — it's computed from duration.
 *       If you do supply one it's ignored. Just specify lo/hi/dir.
 *
 * Requires: sharp (for PNG render+upscale) and ffmpeg on PATH (for encode).
 */

const sharp = require('sharp');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const DATA = args.data;
const CYCLES_JSON = args.cycles;
const DURATION = parseFloat(args.duration || '4');     // seconds
const FPS = parseInt(args.fps || '20', 10);
const SCALE = parseInt(args.scale || '4', 10);
const OUT = args.out;

if (!DATA || !CYCLES_JSON || !OUT) {
  console.error('Usage: --data <path> --cycles <json> [--duration 4] [--fps 20] [--scale 4] --out <gif>');
  process.exit(1);
}

(async () => {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const W = data.width, H = data.height, N = W * H;
  const cyclesIn = JSON.parse(CYCLES_JSON);

  // Auto-set rate so each cycle's period == loop duration → seamless
  const cycles = cyclesIn.map(c => ({
    lo: c.lo, hi: c.hi, dir: c.dir || 1,
    rate: (c.hi - c.lo + 1) / DURATION
  }));

  console.log(`Source: ${W}×${H} indexed (ratio ${(W/H).toFixed(4)})`);
  console.log(`Loop: ${DURATION}s @ ${FPS}fps = ${DURATION*FPS} frames`);
  console.log(`Output: ${W*SCALE}×${H*SCALE} (${SCALE}× nearest upscale)`);
  for (const c of cycles) {
    console.log(`  Cycle ${c.lo}..${c.hi} (${c.hi-c.lo+1} entries) rate=${c.rate.toFixed(2)} dir=${c.dir} period=${((c.hi-c.lo+1)/c.rate).toFixed(2)}s`);
  }

  const indexed = new Uint8Array(zlib.inflateRawSync(Buffer.from(data.indexedB64, 'base64')));
  const palBuf = Buffer.from(data.paletteB64, 'base64');
  const basePalR = new Uint8Array(256), basePalG = new Uint8Array(256), basePalB = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    basePalR[i] = palBuf[i*3]; basePalG[i] = palBuf[i*3+1]; basePalB[i] = palBuf[i*3+2];
  }
  const palR = new Uint8Array(256), palG = new Uint8Array(256), palB = new Uint8Array(256);
  const positions = cycles.map(() => 0);

  function cyclePalette(dt) {
    palR.set(basePalR); palG.set(basePalG); palB.set(basePalB);
    for (let c = 0; c < cycles.length; c++) {
      const { lo, hi, rate, dir } = cycles[c];
      const n = hi - lo + 1;
      positions[c] = ((positions[c] + rate * dir * dt) % n + n) % n;
      const pos = positions[c];
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const tR = new Uint8Array(n), tG = new Uint8Array(n), tB = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const aIdx = (k + i0) % n;
        const bIdx = (k + i0 + 1) % n;
        tR[k] = Math.round(basePalR[lo+aIdx] + (basePalR[lo+bIdx] - basePalR[lo+aIdx]) * frac);
        tG[k] = Math.round(basePalG[lo+aIdx] + (basePalG[lo+bIdx] - basePalG[lo+aIdx]) * frac);
        tB[k] = Math.round(basePalB[lo+aIdx] + (basePalB[lo+bIdx] - basePalB[lo+aIdx]) * frac);
      }
      for (let k = 0; k < n; k++) {
        palR[lo+k] = tR[k]; palG[lo+k] = tG[k]; palB[lo+k] = tB[k];
      }
    }
  }

  const numFrames = DURATION * FPS;
  const OUT_W = W * SCALE, OUT_H = H * SCALE;
  const dt = 1 / FPS;

  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyc-frames-'));
  const t0 = Date.now();

  for (let f = 0; f < numFrames; f++) {
    cyclePalette(dt);
    const rgb = Buffer.alloc(W * H * 3);
    for (let i = 0; i < N; i++) {
      const idx = indexed[i];
      rgb[i*3] = palR[idx]; rgb[i*3+1] = palG[idx]; rgb[i*3+2] = palB[idx];
    }
    await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
      .resize(OUT_W, OUT_H, { kernel: 'nearest' })
      .png({ compressionLevel: 1 })
      .toFile(path.join(framesDir, `f${String(f).padStart(4, '0')}.png`));
  }
  console.log(`✓ Rendered ${numFrames} frames in ${((Date.now()-t0)/1000).toFixed(1)}s`);

  // ffmpeg 2-pass: palettegen + paletteuse with Bayer dither for clean gradients
  const palPath = path.join(framesDir, 'palette.png');
  console.log('--- ffmpeg pass 1: palette ---');
  execSync(`ffmpeg -y -framerate ${FPS} -i "${path.join(framesDir, 'f%04d.png')}" -vf "palettegen=max_colors=256:stats_mode=full" "${palPath}"`, { stdio: 'pipe' });
  console.log('--- ffmpeg pass 2: encode GIF ---');
  execSync(`ffmpeg -y -framerate ${FPS} -i "${path.join(framesDir, 'f%04d.png')}" -i "${palPath}" -lavfi "paletteuse=dither=bayer:bayer_scale=4" -loop 0 "${OUT}"`, { stdio: 'pipe' });

  const stat = fs.statSync(OUT);
  console.log(`\n✓ GIF saved: ${OUT}`);
  console.log(`  Size: ${(stat.size/1024).toFixed(1)} KB`);
  console.log(`  Dimensions: ${OUT_W}×${OUT_H}`);
  console.log(`  Frames: ${numFrames} (seamless ${DURATION}s loop)`);

  // Cleanup
  try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
})().catch(e => { console.error(e); process.exit(1); });
