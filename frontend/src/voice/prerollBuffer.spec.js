/**
 * The ring records the past so the first word survives the handshake.
 *
 * Everything here drives the PURE ring (createPrerollRing) with synthetic
 * frames — the same way energyVad and realtimeBridge are tested — so the
 * interesting logic (trim, cap, speech detection, encoding) is verified
 * without an AudioContext, which jsdom does not have.
 */
import { describe, it, expect } from 'vitest';
import { createPrerollRing, framesToBase64 } from './prerollBuffer.js';

/** Small frames so tests stay readable: 240 samples @ 24kHz = 10ms/frame. */
const CFG = {
  sampleRate: 24000,
  frameSize: 240,
  maxMs: 2000,
  padFrames: 4,
  tailSilenceFrames: 8,
  warmupFrames: 3,
};

const silence = () => new Float32Array(CFG.frameSize);
const speech = (amp = 0.5) => {
  const f = new Float32Array(CFG.frameSize);
  for (let i = 0; i < f.length; i++) f[i] = amp * Math.sin((2 * Math.PI * i) / 24);
  return f;
};

function ringWith(frames) {
  const ring = createPrerollRing(CFG);
  for (const frame of frames) ring.push(frame);
  return ring;
}

const repeat = (n, make) => Array.from({ length: n }, make);

describe('prerollRing — harvest', () => {
  it('a silent handshake harvests nothing worth injecting', () => {
    const clip = ringWith(repeat(40, silence)).harvest();
    expect(clip.hadSpeech).toBe(false);
    expect(clip.base64).toBe('');
    expect(clip.ms).toBe(0);
    expect(clip.endedInSilence).toBe(true);
  });

  it('trims the leading room tone but keeps pad frames ahead of the speech', () => {
    const lead = 20;
    const talk = 12;
    const clip = ringWith([...repeat(lead, silence), ...repeat(talk, speech)]).harvest();

    expect(clip.hadSpeech).toBe(true);
    expect(clip.base64.length).toBeGreaterThan(0);
    // Trimmed: strictly less than everything, comfortably more than the talk.
    expect(clip.ms).toBeLessThan((lead + talk) * 10);
    expect(clip.ms).toBeGreaterThanOrEqual(talk * 10);
    // The encoded bytes agree with the reported duration: PCM16 mono @24kHz.
    const bytes = Buffer.from(clip.base64, 'base64').length;
    expect(bytes).toBe((clip.ms / 10) * CFG.frameSize * 2);
  });

  it('a tail still in speech is NOT an ended utterance — the live track continues it', () => {
    const clip = ringWith([...repeat(20, silence), ...repeat(12, speech)]).harvest();
    expect(clip.endedInSilence).toBe(false);
  });

  it('a quiet tail means the whole utterance is in the ring and the turn is stranded', () => {
    const clip = ringWith([
      ...repeat(20, silence),
      ...repeat(12, speech),
      ...repeat(12, silence),
    ]).harvest();
    expect(clip.hadSpeech).toBe(true);
    expect(clip.endedInSilence).toBe(true);
  });

  it('speech that starts immediately (no lead-in) still survives, minus only the warmup', () => {
    // The user who clicks and talks in the same motion — the reported bug.
    // Warmup frames cannot be flagged, but everything after them can, and the
    // pad reaches back over the warmup so those frames ship anyway.
    const clip = ringWith(repeat(20, speech)).harvest();
    expect(clip.hadSpeech).toBe(true);
    expect(clip.ms).toBeGreaterThanOrEqual(14 * 10);
  });
});

describe('prerollRing — the cap', () => {
  it('never holds more than maxMs of audio', () => {
    const maxFrames = CFG.maxMs / 10;
    const ring = ringWith(repeat(maxFrames + 50, silence));
    expect(ring.size).toBe(maxFrames);
  });

  it('the cap drops the OLDEST audio: recent speech survives a long stall', () => {
    const maxFrames = CFG.maxMs / 10;
    // Fill far past the cap with silence, then speak at the very end.
    const ring = ringWith([...repeat(maxFrames + 40, silence), ...repeat(10, speech)]);
    const clip = ring.harvest();
    expect(clip.hadSpeech).toBe(true);
  });
});

describe('framesToBase64 — byte-exact little-endian PCM16', () => {
  it('encodes the exact bytes of the samples', () => {
    // 258 = 0x0102 → LE bytes [0x02, 0x01] → base64 "AgE="
    expect(framesToBase64([new Int16Array([258])])).toBe('AgE=');
  });

  it('concatenates frames in order', () => {
    const a = new Int16Array([258]);
    const b = new Int16Array([772]); // 0x0304 → [0x04, 0x03]
    const decoded = Buffer.from(framesToBase64([a, b]), 'base64');
    expect([...decoded]).toEqual([0x02, 0x01, 0x04, 0x03]);
  });
});
