/**
 * audioCapture — the recorder must record the past.
 *
 * The bug these tests exist for: "the beginning of my sentence gets cut off."
 * Recording began when the VAD announced speech, and the VAD cannot announce
 * speech until it has already heard some — so the audio that PROVED the user
 * was talking was never in the recording. Every test below is written so that
 * it fails on the old behaviour.
 *
 * The audio here is synthetic and deliberately boring: each frame is a constant
 * value, so "did this frame end up in the recording" is answerable by counting
 * samples equal to that value. That makes the assertions exact rather than
 * approximate, which matters — an off-by-one-frame pre-roll is invisible to a
 * tolerance-based test and audible to a person.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAudioCapture, encodeWav, DEFAULT_CAPTURE_CONFIG } from './audioCapture.js';
import { MIC_CONSTRAINTS } from './micConstraints.js';

const FRAME = DEFAULT_CAPTURE_CONFIG.frameSize; // 1024
const RATE = 48000;

/**
 * The 16-bit value a constant float frame encodes to.
 *
 * Mirrors toInt16 INCLUDING the truncation that storing into an Int16Array
 * performs — 0.5 * 0x7fff is 16383.5 and lands as 16383, not 16384. Rounding
 * here instead would make every exact-count assertion below quietly match
 * nothing.
 */
const asInt16 = (v) => Math.trunc(v < 0 ? v * 0x8000 : v * 0x7fff);

function createHarness(config = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);

  let processor = null;
  class FakeAudioContext {
    constructor() {
      this.sampleRate = RATE;
      this.state = 'running';
      this.destination = {};
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      processor = { onaudioprocess: null, connect() {}, disconnect() {} };
      return processor;
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    close() {
      this.state = 'closed';
    }
  }

  const capture = createAudioCapture(config, { getUserMedia, AudioContext: FakeAudioContext });

  /** Push `count` frames of constant amplitude through the graph. */
  const feed = (value, count = 1) => {
    for (let i = 0; i < count; i++) {
      const buf = new Float32Array(FRAME).fill(value);
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => buf } });
    }
  };

  return { capture, feed, getUserMedia, track };
}

/** Read a Blob back as bytes, whichever API this environment provides. */
async function bytesOf(blob) {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function samplesOf(segment) {
  const bytes = await bytesOf(segment.blob);
  // 44-byte canonical WAV header, then interleaved 16-bit LE samples (mono).
  return new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) / 2);
}

const countOf = (samples, value) => {
  let n = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i] === value) n++;
  return n;
};

describe('audioCapture pre-roll', () => {
  it('includes audio spoken BEFORE startRecording was called', async () => {
    const { capture, feed } = createHarness();
    await capture.start();

    feed(0, 40); // room tone: clears the VAD warm-up and fills the ring
    feed(0.5, 3); // the head of the sentence — nobody has asked to record yet

    capture.startRecording();
    feed(0.5, 10);
    const segment = await capture.stopRecording();

    const samples = await samplesOf(segment);
    // All 13 frames of speech, not just the 10 that followed the VAD.
    expect(countOf(samples, asInt16(0.5))).toBe(13 * FRAME);
  });

  it('keeps nothing from the past when pre-roll is disabled (control)', async () => {
    const { capture, feed } = createHarness({ prerollMs: 0 });
    await capture.start();

    feed(0, 40);
    feed(0.5, 3);

    capture.startRecording();
    feed(0.5, 10);
    const segment = await capture.stopRecording();

    const samples = await samplesOf(segment);
    // This is the OLD behaviour, and it is exactly what the user reported.
    expect(countOf(samples, asInt16(0.5))).toBe(10 * FRAME);
  });

  it('reports a duration that accounts for the pre-roll', async () => {
    const { capture, feed } = createHarness();
    await capture.start();

    feed(0, 40);
    capture.startRecording();
    feed(0.5, 10);
    const segment = await capture.stopRecording();

    const samples = await samplesOf(segment);
    expect(segment.durationMs).toBe(Math.round((samples.length / RATE) * 1000));
    // ~800ms of retained room tone plus ~213ms of speech.
    expect(segment.durationMs).toBeGreaterThan(900);
    expect(segment.sampleRate).toBe(RATE);
  });

  it('never re-delivers audio that a previous recording already carried', async () => {
    // The reopen path: a pause that turns out not to end the sentence starts a
    // second recording while the ring still holds the first one's tail. Without
    // a boundary the user's words are transcribed twice and stutter.
    const { capture, feed } = createHarness();
    await capture.start();

    feed(0, 40);
    feed(0.5, 5);
    capture.startRecording();
    feed(0.5, 5);
    await capture.stopRecording();

    feed(0.7, 5); // spoken in the gap, after the first segment closed
    capture.startRecording();
    feed(0.7, 5);
    const second = await capture.stopRecording();

    const samples = await samplesOf(second);
    expect(countOf(samples, asInt16(0.5))).toBe(0); // nothing from segment one
    expect(countOf(samples, asInt16(0.7))).toBe(10 * FRAME); // its own pre-roll intact
  });

  it('bounds the retained window regardless of how long the session runs', async () => {
    const { capture, feed } = createHarness();
    await capture.start();

    feed(0.01, 400); // ~8.5 seconds
    expect(capture.prerollMs).toBeGreaterThanOrEqual(DEFAULT_CAPTURE_CONFIG.prerollMs);
    // One frame of overshoot is the most the trim can leave behind.
    expect(capture.prerollMs).toBeLessThanOrEqual(DEFAULT_CAPTURE_CONFIG.prerollMs + 25);
  });

  it('caps a single recording so a stuck VAD cannot exhaust memory', async () => {
    const { capture, feed } = createHarness({ prerollMs: 0, maxUtteranceMs: 100 });
    await capture.start();

    feed(0, 40);
    capture.startRecording();
    feed(0.5, 500);
    const segment = await capture.stopRecording();

    const samples = await samplesOf(segment);
    const ceiling = Math.round((100 / 1000) * RATE) + FRAME; // cap + one frame
    expect(samples.length).toBeLessThanOrEqual(ceiling);
  });
});

describe('audioCapture recording contract', () => {
  it('resolves null when nothing was recorded', async () => {
    const { capture, feed } = createHarness();
    await capture.start();
    feed(0, 10);
    await expect(capture.stopRecording()).resolves.toBeNull();
  });

  it('resolves null when a recording captured no frames at all', async () => {
    const { capture } = createHarness({ prerollMs: 0 });
    await capture.start();
    capture.startRecording();
    await expect(capture.stopRecording()).resolves.toBeNull();
  });

  it('opens the microphone through the shared constraints', async () => {
    const { capture, getUserMedia } = createHarness();
    await capture.start();
    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
  });

  it('startRecording is idempotent and reports whether it started', async () => {
    const { capture, feed } = createHarness();
    await capture.start();
    feed(0, 40);
    expect(capture.startRecording()).toBe(true);
    expect(capture.startRecording()).toBe(false);
    expect(capture.isRecording).toBe(true);
    await capture.stopRecording();
    expect(capture.isRecording).toBe(false);
  });

  it('forgets everything on stop, so a new session cannot inherit old audio', async () => {
    const { capture, feed } = createHarness();
    await capture.start();
    feed(0.5, 60);
    capture.stop();
    expect(capture.prerollMs).toBe(0);
    expect(capture.isActive).toBe(false);
  });
});

describe('encodeWav', () => {
  it('writes a canonical 16-bit mono PCM header', async () => {
    const frames = [Int16Array.from([1, -1, 32767, -32768])];
    const blob = encodeWav(frames, 4, RATE);
    const bytes = await bytesOf(blob);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const ascii = (o, n) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));

    expect(blob.type).toBe('audio/wav');
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(RATE);
    expect(view.getUint32(28, true)).toBe(RATE * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(bytes.length).toBe(44 + 8);
  });

  it('clips rather than wrapping at the rails', async () => {
    const { capture, feed } = createHarness({ prerollMs: 0 });
    await capture.start();
    feed(0, 40);
    capture.startRecording();
    feed(2, 1); // beyond full scale
    feed(-2, 1);
    const segment = await capture.stopRecording();
    const samples = await samplesOf(segment);
    expect(countOf(samples, 32767)).toBe(FRAME);
    expect(countOf(samples, -32768)).toBe(FRAME);
  });
});
