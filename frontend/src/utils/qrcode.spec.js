/**
 * QR encoder tests.
 *
 * A snapshot of the matrix would prove only that the output did not change —
 * and the first version of this encoder produced a perfectly stable, perfectly
 * QR-shaped matrix that NO reader in the world could decode (format information
 * was written LSB-first instead of MSB-first, and the second copy used an 8/7
 * module split that overwrote the always-dark module).
 *
 * So these tests DECODE. The reader below independently re-derives the function
 * -module map, reads the format information back, un-masks with the mask the
 * matrix claims to use, walks the zigzag and reassembles the codewords. If any
 * link in the encode chain is wrong, the payload does not come back.
 *
 * The encoder was additionally validated out-of-band against two independent
 * decoders (jsQR and OpenCV's QRCodeDetector): 7/7 exact round-trips on
 * payloads from 1 to 106 bytes. See projects/agnt-remote/verify-qr.mjs.
 */

import { describe, it, expect } from 'vitest';
import { encode, toSvg } from './qrcode.js';

const ALIGN_CENTER = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 };

// [ecCodewordsPerBlock, numBlocks, dataCodewordsPerBlock] at ECC level M.
// Needed by the reader: from version 4 up the payload is split across several
// Reed-Solomon blocks and written round-robin, so a linear read of the bit
// stream returns interleaved garbage.
const BLOCKS_M = {
  1: [10, 1, 16], 2: [16, 1, 28], 3: [26, 1, 44],
  4: [18, 2, 32], 5: [24, 2, 43], 6: [16, 4, 27],
};

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

/** Independently rebuild the function-module map from version + size alone. */
function functionMap(size, version) {
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => {
    if (r >= 0 && c >= 0 && r < size && c < size) fn[r][c] = true;
  };
  for (const [row, col] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(row + r, col + c);
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  const a = ALIGN_CENTER[version];
  if (a) for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) mark(a + r, a + c);
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  return fn;
}

/** Read the 15-bit format value back out of copy 1, MSB-first. */
function readFormat(modules, size) {
  let v = 0;
  for (let i = 0; i < 15; i++) {
    let bit;
    if (i < 6) bit = modules[8][i];
    else if (i < 8) bit = modules[8][i + 1];
    else if (i === 8) bit = modules[7][8];
    else bit = modules[14 - i][8];
    v = (v << 1) | (bit ? 1 : 0);
  }
  return v ^ 0x5412; // remove the spec's fixed XOR mask
}

/** Full read-back: returns the decoded byte-mode payload string. */
function decode(text) {
  const { size, modules, version } = encode(text);
  const fn = functionMap(size, version);

  const unmasked = readFormat(modules, size);
  const eccBits = (unmasked >> 13) & 0b11;
  const mask = (unmasked >> 10) & 0b111;

  const grid = modules.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!fn[r][c] && MASKS[mask](r, c)) grid[r][c] = !grid[r][c];
    }
  }

  const bits = [];
  let upward = true;
  for (let colPair = size - 1; colPair > 0; colPair -= 2) {
    if (colPair === 6) colPair = 5;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let k = 0; k < 2; k++) {
        const col = colPair - k;
        if (!fn[row][col]) bits.push(grid[row][col] ? 1 : 0);
      }
    }
    upward = !upward;
  }

  // bits -> codewords
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }

  // De-interleave the data codewords back into block order. Every version we
  // support has equal-length blocks, so this is a plain round-robin unwind.
  const [, numBlocks, dataPerBlock] = BLOCKS_M[version];
  const data = [];
  for (let b = 0; b < numBlocks; b++) {
    for (let j = 0; j < dataPerBlock; j++) data.push(codewords[j * numBlocks + b]);
  }

  // codewords -> bit accessor over the de-interleaved data
  const dataBits = [];
  for (const cw of data) for (let i = 7; i >= 0; i--) dataBits.push((cw >>> i) & 1);
  const read = (offset, len) => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | dataBits[offset + i];
    return v;
  };
  const mode = read(0, 4);
  const length = read(4, 8);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(read(12 + i * 8, 8));

  return {
    payload: new TextDecoder().decode(new Uint8Array(bytes)),
    mode,
    eccBits,
    mask,
    version,
    size,
  };
}

const CASES = [
  ['single character', 'A'],
  ['short text', 'hello world'],
  ['typical pairing URL', 'http://192.168.40.208:3333/pair?c=0123456789abcdef0123456789abcdef'],
  ['worst-case IPv4 pairing URL', 'http://255.255.255.255:65535/pair?c=' + 'f'.repeat(32)],
  ['hostname pairing URL', 'http://nathans-desktop.local:3333/pair?c=' + '9'.repeat(32)],
  ['capacity edge (106 bytes)', 'x'.repeat(106)],
];

describe('qrcode — round trip', () => {
  it.each(CASES)('%s decodes back to the exact input', (_label, text) => {
    const out = decode(text);
    expect(out.payload).toBe(text);
  });

  it.each(CASES)('%s declares byte mode and ECC level M', (_label, text) => {
    const out = decode(text);
    expect(out.mode).toBe(0b0100); // byte mode
    expect(out.eccBits).toBe(0b00); // level M
    expect(out.mask).toBeGreaterThanOrEqual(0);
    expect(out.mask).toBeLessThanOrEqual(7);
  });
});

describe('qrcode — structure', () => {
  it('selects the smallest version that fits', () => {
    // v1-M byte capacity is 16 data codewords minus 2 of overhead = 14 bytes.
    expect(encode('x'.repeat(14)).version).toBe(1);
    expect(encode('x'.repeat(15)).version).toBe(2);
  });

  it('produces the right matrix size for its version', () => {
    for (const text of ['A', 'x'.repeat(20), 'x'.repeat(50), 'x'.repeat(100)]) {
      const { size, version } = encode(text);
      expect(size).toBe(version * 4 + 17);
    }
  });

  it('places all three finder patterns', () => {
    const { size, modules } = encode('hello');
    for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(modules[r0][c0]).toBe(true);
      expect(modules[r0 + 1][c0 + 1]).toBe(false); // inner light ring
      expect(modules[r0 + 3][c0 + 3]).toBe(true); // 3x3 dark core
    }
  });

  it('places the alternating timing patterns', () => {
    const { size, modules } = encode('hello world 12345678');
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
  });

  it('sets the always-dark module (a format bit must never land here)', () => {
    for (const text of ['A', 'x'.repeat(50)]) {
      const { size, modules } = encode(text);
      expect(modules[size - 8][8]).toBe(true);
    }
  });

  it('writes both format copies identically', () => {
    const { size, modules } = encode('hello world');
    const copy1 = readFormat(modules, size);
    let copy2 = 0;
    for (let i = 0; i < 15; i++) {
      const bit = i < 7 ? modules[size - 1 - i][8] : modules[8][size - 15 + i];
      copy2 = (copy2 << 1) | (bit ? 1 : 0);
    }
    expect(copy2 ^ 0x5412).toBe(copy1);
  });

  it('leaves no unset module', () => {
    const { modules } = encode('x'.repeat(60));
    for (const row of modules) for (const cell of row) expect(typeof cell).toBe('boolean');
  });
});

describe('qrcode — limits', () => {
  it('throws rather than silently truncating an over-capacity payload', () => {
    expect(() => encode('y'.repeat(107))).toThrow(/too long/i);
  });

  it('handles multi-byte UTF-8 by byte length, not character count', () => {
    const text = 'café ☕';
    expect(decode(text).payload).toBe(text);
  });
});

describe('toSvg', () => {
  it('emits a well-formed standalone SVG', () => {
    const svg = toSvg('http://192.168.1.5:3333/pair?c=' + 'a'.repeat(32));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<path d="M');
  });

  it('includes the 4-module quiet zone the spec requires', () => {
    const { size } = encode('hello');
    const svg = toSvg('hello', { moduleSize: 1, quietZone: 4 });
    expect(svg).toContain(`width="${size + 8}"`);
  });

  it('scales with moduleSize', () => {
    const { size } = encode('hello');
    const svg = toSvg('hello', { moduleSize: 10, quietZone: 0 });
    expect(svg).toContain(`width="${size * 10}"`);
  });
});
