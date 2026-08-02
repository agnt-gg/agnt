import { describe, it, expect } from 'vitest';
import { createVad, rms, DEFAULT_VAD_CONFIG } from './energyVad.js';

/**
 * A frame of deterministic white-ish noise with an EXACT target RMS.
 *
 * Normalising matters: uniform noise in [-a, a] has RMS = a/sqrt(3) ~= 0.577a,
 * so passing a raw amplitude makes every threshold assertion off by 42% and
 * silently turns a "mid-band" test signal into a below-release one. Generating
 * to a known RMS lets the tests state thresholds in the same units the VAD
 * compares in.
 */
function frame(targetRms, n = 320, seed = 1) {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (s / 0x7fffffff) * 2 - 1;
  }
  if (targetRms === 0) return out.fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += out[i] * out[i];
  const actual = Math.sqrt(sum / n);
  const scale = actual > 0 ? targetRms / actual : 0;
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}

function feed(vad, targetRms, count, seed = 1) {
  let last = null;
  for (let i = 0; i < count; i++) last = vad.push(frame(targetRms, 320, seed + i));
  return last;
}

describe('rms', () => {
  it('is 0 for empty and silent frames', () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(new Float32Array(128))).toBe(0);
    expect(rms(null)).toBe(0);
  });

  it('equals the amplitude of a constant signal', () => {
    const f = new Float32Array(64).fill(0.5);
    expect(rms(f)).toBeCloseTo(0.5, 6);
  });

  it('is amplitude/sqrt(2) for a full-scale sine', () => {
    const n = 1024;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = Math.sin((2 * Math.PI * 8 * i) / n);
    expect(rms(f)).toBeCloseTo(1 / Math.SQRT2, 2);
  });

  it('the test helper produces the RMS it claims', () => {
    // Guards the assertions below: every threshold test is stated in RMS.
    expect(rms(frame(0.01))).toBeCloseTo(0.01, 6);
    expect(rms(frame(0.4))).toBeCloseTo(0.4, 6);
  });
});

describe('createVad — onset and release', () => {
  it('does not declare speech from a silent room', () => {
    const vad = createVad();
    const last = feed(vad, 0.001, 50);
    expect(last.speaking).toBe(false);
    expect(vad.isSpeaking).toBe(false);
  });

  it('declares speech after onsetFrames of loud audio, not before', () => {
    const vad = createVad({ onsetFrames: 3 });
    feed(vad, 0.002, 30); // settle the floor

    const f1 = vad.push(frame(0.3, 320, 99));
    expect(f1.speaking).toBe(false);
    const f2 = vad.push(frame(0.3, 320, 100));
    expect(f2.speaking).toBe(false);
    const f3 = vad.push(frame(0.3, 320, 101));
    expect(f3.speaking).toBe(true);
    expect(f3.onset).toBe(true);
  });

  it('releases after releaseFrames of quiet audio', () => {
    const vad = createVad({ onsetFrames: 2, releaseFrames: 3 });
    feed(vad, 0.002, 30);
    feed(vad, 0.3, 10);
    expect(vad.isSpeaking).toBe(true);

    vad.push(frame(0.001, 320, 1));
    vad.push(frame(0.001, 320, 2));
    expect(vad.isSpeaking).toBe(true);
    const r = vad.push(frame(0.001, 320, 3));
    expect(r.speaking).toBe(false);
    expect(r.release).toBe(true);
  });

  it('hysteresis: a mid-band signal neither triggers nor releases', () => {
    // Between releaseRatio (2.0) and onsetRatio (3.5) relative to the floor.
    const vad = createVad();
    feed(vad, 0.002, 40);
    const floor = vad.noiseFloor;
    const mid = floor * 2.7;

    const res = feed(vad, mid, 20);
    expect(res.speaking).toBe(false);

    // And from the speaking side it does not release either.
    feed(vad, 0.4, 10);
    expect(vad.isSpeaking).toBe(true);
    const res2 = feed(vad, mid, 20);
    expect(res2.speaking).toBe(true);
  });

  it('a single loud frame (a click) does not trigger speech', () => {
    const vad = createVad({ onsetFrames: 3 });
    feed(vad, 0.002, 30);
    const spike = vad.push(frame(0.9, 320, 7));
    expect(spike.speaking).toBe(false);
    const after = feed(vad, 0.002, 5);
    expect(after.speaking).toBe(false);
  });
});

describe('createVad — adaptive noise floor', () => {
  it('adapts up to a noisy room so speech is still detectable', () => {
    const vad = createVad();
    const quiet = createVad();
    feed(quiet, 0.001, 100);

    feed(vad, 0.02, 200); // loud fan
    expect(vad.noiseFloor).toBeGreaterThan(quiet.noiseFloor);
    expect(vad.isSpeaking).toBe(false); // steady noise is not speech

    // Real speech well above the adapted floor still registers.
    const res = feed(vad, 0.35, 5);
    expect(res.speaking).toBe(true);
  });

  it('does NOT adapt while speaking — no self-muting on a long sentence', () => {
    const vad = createVad();
    feed(vad, 0.002, 40);
    const floorBefore = vad.noiseFloor;

    feed(vad, 0.4, 300); // a very long, loud sentence
    expect(vad.isSpeaking).toBe(true);
    expect(vad.noiseFloor).toBeCloseTo(floorBefore, 6);
  });

  it('clamps the floor to minFloor on digital silence', () => {
    const vad = createVad();
    feed(vad, 0, 500);
    expect(vad.noiseFloor).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.minFloor);
    // and a nonzero-but-tiny sample must not read as speech
    const res = feed(vad, 0.0005, 10);
    expect(res.speaking).toBe(false);
  });

  it('clamps the floor to maxFloor under sustained loud noise', () => {
    // Isolate the clamp: an unreachable onsetRatio means speech is never
    // declared, so every frame feeds the floor. Without the clamp the floor
    // would converge on 0.9 and no human voice could ever clear it again.
    const vad = createVad({ onsetRatio: 1e9, releaseRatio: 1e9 });
    for (let i = 0; i < 2000; i++) vad.push(frame(0.9, 320, i));
    expect(vad.isSpeaking).toBe(false);
    expect(vad.noiseFloor).toBeLessThanOrEqual(DEFAULT_VAD_CONFIG.maxFloor);
    expect(vad.noiseFloor).toBeCloseTo(DEFAULT_VAD_CONFIG.maxFloor, 6);
  });
});

describe('createVad — cold start in a noisy room (regression)', () => {
  /**
   * THE BUG: initialFloor is a guess. Open the mic in a room already louder
   * than that guess and the first frames clear the onset ratio, so ambient
   * noise is declared speech. Because the floor deliberately stops adapting
   * while speaking, the detector then LATCHES ON for the whole session — the
   * user's real speech is never detected as an onset because it never released.
   *
   * Caught by an assertion failure, not by inspection. Guarded here forever.
   */
  it('does not latch on when the mic opens into an already-noisy room', () => {
    const vad = createVad();
    // Ambient noise 4x the initial floor guess — a fan, a café, a hot mic.
    const ambient = DEFAULT_VAD_CONFIG.initialFloor * 4;

    const settled = feed(vad, ambient, 200);
    expect(settled.speaking).toBe(false);
    expect(vad.isSpeaking).toBe(false);

    // And crucially, real speech over that noise is still detected.
    const speech = feed(vad, ambient * 20, 6);
    expect(speech.speaking).toBe(true);
  });

  it('reports the calibration window so callers can ignore warm-up frames', () => {
    const vad = createVad({ warmupFrames: 10 });
    expect(vad.isCalibrating).toBe(true);
    feed(vad, 0.002, 10);
    expect(vad.isCalibrating).toBe(false);
  });

  it('never declares speech during calibration, however loud the input', () => {
    const vad = createVad({ warmupFrames: 15 });
    for (let i = 1; i <= 15; i++) {
      const r = vad.push(frame(0.9, 320, i));
      expect(r.speaking).toBe(false);
      expect(r.warmup).toBe(true);
    }
  });
});

describe('createVad — duration bookkeeping', () => {
  it('accumulates silenceMs only while not speaking', () => {
    const vad = createVad({ frameMs: 20, onsetFrames: 2, releaseFrames: 2 });
    feed(vad, 0.002, 30);
    feed(vad, 0.4, 10);
    expect(vad.silenceMs).toBe(0);

    feed(vad, 0.001, 2); // release
    const after = feed(vad, 0.001, 10);
    expect(after.speaking).toBe(false);
    expect(vad.silenceMs).toBeGreaterThanOrEqual(200);
  });

  it('reset() returns to construction state', () => {
    const vad = createVad();
    feed(vad, 0.4, 50);
    expect(vad.isSpeaking).toBe(true);
    vad.reset();
    expect(vad.isSpeaking).toBe(false);
    expect(vad.noiseFloor).toBe(DEFAULT_VAD_CONFIG.initialFloor);
  });
});
