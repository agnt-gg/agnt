/**
 * Minimal QR Code encoder — byte mode, error-correction level M, versions 1-6.
 *
 * WHY HAND-ROLLED: the only thing AGNT needs to encode is a pairing URL of
 * ~45-60 characters. Pulling a dependency into the renderer bundle for that,
 * in a codebase where every dependency is a supply-chain liability and the
 * app ships to desktops, is the wrong trade. This is ~300 lines of a fully
 * specified algorithm (ISO/IEC 18004) with a machine-verifiable output: the
 * accompanying test scans the rendered matrix back with a real barcode
 * decoder, so "it looks like a QR code" is never the standard of proof.
 *
 * SCOPE: versions 1-6 deliberately. Version 7+ requires an 18-bit version
 * information block in two extra corners and multi-alignment-pattern layout —
 * more surface for a subtle bug than the use case justifies. Version 6-M holds
 * 108 bytes; the longest realistic pairing URL
 * (`http://255.255.255.255:65535/pair?c=<32 hex>` = 44 chars) uses 41% of that.
 * encode() throws above capacity so a caller can fall back to plain text
 * rather than render a corrupt code.
 */

// --- capacity: data codewords available at ECC level M, by version ---------
const DATA_CODEWORDS_M = { 1: 16, 2: 28, 3: 44, 4: 64, 5: 86, 6: 108 };
// --- EC codewords per block, and block structure, at level M ---------------
// [ecCodewordsPerBlock, [ [numBlocks, dataCodewordsPerBlock], ... ] ]
const EC_BLOCKS_M = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
};
// Alignment pattern centre (versions 2-6 have exactly one, at [6, N]).
const ALIGN_CENTER = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 };

// --- GF(256) arithmetic, primitive polynomial 0x11D ------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Reed-Solomon generator polynomial of the given degree. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Remainder of data / generator in GF(256) — the EC codewords. */
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

// --- bit buffer ------------------------------------------------------------
class BitBuffer {
  constructor() {
    this.bits = [];
  }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

// --- format information (level M = 0b00), 15 bits with BCH(15,5) ----------
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // ECC level M is 0b00
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem <<= 1;
    if (rem & 0x400) rem ^= 0x537;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * Encode text into a QR matrix.
 * @param {string} text
 * @returns {{ size: number, modules: boolean[][], version: number }}
 */
export function encode(text) {
  const bytes = new TextEncoder().encode(text);

  let version = 0;
  for (let v = 1; v <= 6; v++) {
    // 4 bits mode + 8 bits length + payload must fit the data capacity.
    if (bytes.length + 2 <= DATA_CODEWORDS_M[v]) {
      version = v;
      break;
    }
  }
  if (!version) {
    throw new Error(`QR payload too long for version 6-M: ${bytes.length} bytes (max ${DATA_CODEWORDS_M[6] - 2})`);
  }

  const size = version * 4 + 17;
  const totalData = DATA_CODEWORDS_M[version];

  // ---- build the data bit stream ----
  const bb = new BitBuffer();
  bb.put(0b0100, 4); // byte mode
  bb.put(bytes.length, 8); // versions 1-9 use an 8-bit character count
  for (const b of bytes) bb.put(b, 8);

  const capacityBits = totalData * 8;
  const terminator = Math.min(4, capacityBits - bb.length);
  bb.put(0, terminator);
  while (bb.length % 8 !== 0) bb.put(0, 1);

  const dataCodewords = [];
  for (let i = 0; i < bb.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j];
    dataCodewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; dataCodewords.length < totalData; i++) dataCodewords.push(PAD[i % 2]);

  // ---- split into blocks, compute EC, interleave ----
  const [ecLen, blockSpec] = EC_BLOCKS_M[version];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, dataLen] of blockSpec) {
    for (let i = 0; i < count; i++) {
      const block = dataCodewords.slice(offset, offset + dataLen);
      offset += dataLen;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecLen));
    }
  }
  const finalCodewords = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) finalCodewords.push(block[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const block of ecBlocks) finalCodewords.push(block[i]);
  }

  // ---- lay out the matrix ----
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (r, c, v) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = v;
    reserved[r][c] = true;
  };

  // finder patterns + separators
  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on =
          r >= 0 && r <= 6 && (c === 0 || c === 6) ||
          c >= 0 && c <= 6 && (r === 0 || r === 6) ||
          r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFn(rr, cc, on);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // alignment pattern (versions 2-6: exactly one at [center, center])
  if (version >= 2) {
    const c = ALIGN_CENTER[version];
    for (let r = -2; r <= 2; r++) {
      for (let cc = -2; cc <= 2; cc++) {
        setFn(c + r, c + cc, Math.max(Math.abs(r), Math.abs(cc)) !== 1);
      }
    }
  }

  // dark module + reserved format areas
  setFn(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === null) { modules[8][i] = false; reserved[8][i] = true; }
    if (modules[i][8] === null) { modules[i][8] = false; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    if (modules[8][size - 1 - i] === null) { modules[8][size - 1 - i] = false; reserved[8][size - 1 - i] = true; }
    if (modules[size - 1 - i][8] === null) { modules[size - 1 - i][8] = false; reserved[size - 1 - i][8] = true; }
  }

  // ---- place data in the zigzag pattern ----
  const bitsStream = [];
  for (const cw of finalCodewords) for (let i = 7; i >= 0; i--) bitsStream.push((cw >>> i) & 1);

  let bitIndex = 0;
  let upward = true;
  for (let colPair = size - 1; colPair > 0; colPair -= 2) {
    if (colPair === 6) colPair = 5; // skip the vertical timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const col = colPair - c;
        if (reserved[row][col]) continue;
        modules[row][col] = bitIndex < bitsStream.length ? bitsStream[bitIndex] === 1 : false;
        bitIndex++;
      }
    }
    upward = !upward;
  }

  // ---- masking: apply each of the 8 patterns, keep the lowest penalty ----
  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  let best = null;
  for (let m = 0; m < 8; m++) {
    const grid = modules.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && MASKS[m](r, c)) grid[r][c] = !grid[r][c];
      }
    }
    // Write the format information, twice.
    //
    // Two details here are easy to get wrong and were both verified
    // cell-by-cell against a known-good reference matrix (see the test):
    //
    //  1. Modules are written MSB-FIRST. Walk position i carries bit 14 - i,
    //     not bit i. Getting this backwards produces a matrix that looks
    //     perfectly QR-shaped and decodes in exactly zero readers.
    //  2. The second copy is 7 modules up the left column and 8 across row 8
    //     (NOT 8 and 7). The 8/7 split writes a format bit into (size-8, 8),
    //     which is the always-dark module, so the bit is silently destroyed.
    const fmt = formatBits(m);
    for (let i = 0; i < 15; i++) {
      const bit = ((fmt >> (14 - i)) & 1) === 1;

      // Copy 1: along row 8 (skipping the timing column), then up column 8.
      if (i < 6) grid[8][i] = bit;
      else if (i < 8) grid[8][i + 1] = bit;
      else if (i === 8) grid[7][8] = bit;
      else grid[14 - i][8] = bit;

      // Copy 2: up column 8 from the bottom edge, then along row 8 from the right.
      if (i < 7) grid[size - 1 - i][8] = bit;
      else grid[8][size - 15 + i] = bit;
    }
    grid[size - 8][8] = true; // always-dark module

    const p = penalty(grid, size);
    if (best === null || p < best.penalty) best = { penalty: p, grid };
  }

  return { size, modules: best.grid.map((row) => row.map(Boolean)), version };
}

/** ISO/IEC 18004 §8.8.2 penalty scoring. */
function penalty(grid, size) {
  let score = 0;

  // Rule 1: runs of 5+ same-colour modules in a row/column.
  for (let i = 0; i < size; i++) {
    for (const line of [grid[i], grid.map((r) => r[i])]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (line[j] === line[j - 1]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: 2x2 blocks of the same colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules on one side.
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line, start, pat) => pat.every((v, k) => line[start + k] === v);
  for (let i = 0; i < size; i++) {
    const row = grid[i];
    const col = grid.map((r) => r[i]);
    for (const line of [row, col]) {
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(line, j, P1) || matches(line, j, P2)) score += 40;
      }
    }
  }

  // Rule 4: deviation from a 50% dark ratio.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Render an encoded matrix to a standalone SVG string.
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.moduleSize=6] - Pixels per module.
 * @param {number} [opts.quietZone=4]  - Quiet-zone width in modules (spec minimum is 4).
 * @param {string} [opts.dark='#000000']
 * @param {string} [opts.light='#ffffff']
 * @returns {string}
 */
export function toSvg(text, { moduleSize = 6, quietZone = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const { size, modules } = encode(text);
  const total = (size + quietZone * 2) * moduleSize;

  // One path for every dark module beats one <rect> each: ~8x fewer bytes and
  // one draw call, which matters when this re-renders on a 120s countdown.
  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r][c]) continue;
      const x = (c + quietZone) * moduleSize;
      const y = (r + quietZone) * moduleSize;
      d += `M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path d="${d}" fill="${dark}"/>` +
    `</svg>`
  );
}

export default { encode, toSvg };
