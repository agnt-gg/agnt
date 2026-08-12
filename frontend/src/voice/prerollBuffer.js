/**
 * prerollBuffer — the words spoken before the connection existed.
 *
 * THE HOLE THIS FILLS
 * -------------------
 * WebRTC carries microphone audio only once ICE + DTLS are up and a track is
 * attached to the sender. Everything said during the handshake — which is
 * exactly when a user who just pressed the voice button starts talking — has
 * nowhere to go and is destroyed at the source. The cascade pipeline fixed
 * its version of this bug with a pre-roll ring inside audioCapture.js
 * ("the recorder records the past"); the realtime transport never got an
 * equivalent because WebRTC has no buffer to put one in.
 *
 * So the buffer lives HERE, outside the transport: a second consumer of the
 * same MediaStream (never a second getUserMedia — see audioCapture.js's
 * one-mic-one-graph rule) records into a bounded ring while the handshake
 * runs. The moment the session is live, useRealtimeVoice harvests the ring,
 * hands it to the model as an input_audio conversation item, and only THEN
 * attaches the live track — one continuous audio timeline with a single
 * boundary, no gap and no overlap.
 *
 * FORMAT IS NOT A CHOICE
 * ----------------------
 * The session declares `audio.input.format` as PCM16 mono at 24kHz
 * (realtimeVoiceService.buildSessionConfig), so the ring records at 24kHz by
 * running its own AudioContext at that rate — the browser resamples the
 * capture into the graph, and no resampling code has to exist here.
 *
 * The pure ring (`createPrerollRing`) is separated from the Web Audio wiring
 * (`createPrerollBuffer`) so the interesting logic — trim, cap, speech
 * detection, encoding — is testable against synthetic frames, exactly as
 * energyVad and realtimeBridge are.
 */

import { createVad } from './energyVad.js';
import { toInt16 } from './audioCapture.js';

export const DEFAULT_PREROLL_CONFIG = Object.freeze({
  /** Matches the session's declared input format. See header. */
  sampleRate: 24000,
  /** ScriptProcessor frame. 512 @ 24kHz ≈ 21ms — same granularity as the VAD expects. */
  frameSize: 512,
  /**
   * Hard ceiling. A stalled handshake must cap memory, not grow it: 8s of
   * 24kHz mono 16-bit is ~375KB, and anything the user said more than 8s
   * before the session went live is a conversation with a dead button, not a
   * first word to recover.
   */
  maxMs: 8000,
  /**
   * Room tone kept ahead of the first detected speech frame. The VAD cannot
   * fire until it has HEARD speech (three confirming frames), so the frames
   * that proved it are already behind the onset — same reasoning as
   * audioCapture's prerollMs, at this module's smaller scale.
   */
  padFrames: 6,
  /**
   * How many trailing quiet frames mean "the utterance ended in the ring".
   * ~250ms — long enough that a stop-consonant gap does not read as an
   * ending, short enough that a finished sentence is recognised as one.
   */
  tailSilenceFrames: 12,
  /**
   * VAD calibration window, deliberately SHORTER than the session-length
   * default (15 frames). The default exists to survive noisy rooms over long
   * sessions; here the recording is seconds long and the user is very likely
   * already talking when frame 1 arrives — every warmup frame is a frame in
   * which their speech cannot be flagged. 5 frames ≈ 100ms is the trade.
   * Frames are RECORDED during warmup either way; only the flag waits.
   */
  warmupFrames: 5,
});

/**
 * Int16 frames -> base64 of their little-endian bytes, which is what the
 * realtime API's `input_audio` content expects for PCM16.
 */
export function framesToBase64(frames) {
  let binary = '';
  for (const frame of frames) {
    const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
    // String.fromCharCode has an argument-count ceiling; feed it in slabs.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
  }
  if (typeof btoa === 'function') return btoa(binary);
  // Node (tests): same bytes, same encoding.
  return Buffer.from(binary, 'binary').toString('base64');
}

/**
 * The pure ring: push float frames in, harvest one clip out.
 *
 * @param {Partial<typeof DEFAULT_PREROLL_CONFIG>} [config]
 */
export function createPrerollRing(config = {}) {
  const cfg = { ...DEFAULT_PREROLL_CONFIG, ...config };
  const frameMs = (cfg.frameSize / cfg.sampleRate) * 1000;
  const maxFrames = Math.max(1, Math.round(cfg.maxMs / frameMs));
  const vad = createVad({ frameMs: Math.round(frameMs), warmupFrames: cfg.warmupFrames });

  /** @type {Int16Array[]} */
  const frames = [];
  /** Speech flag per stored frame, index-aligned with `frames`. */
  const speech = [];

  /** @param {Float32Array|number[]} floatFrame PCM in [-1, 1] */
  function push(floatFrame) {
    const snap = vad.push(floatFrame);
    // Converted NOW, not at harvest: the source buffer is reused by the audio
    // graph after this call returns, so keeping a reference would keep noise.
    frames.push(toInt16(floatFrame));
    speech.push(Boolean(snap.speaking || snap.onset));
    if (frames.length > maxFrames) {
      frames.shift();
      speech.shift();
    }
  }

  /**
   * The clip, trimmed to just before the first speech.
   *
   * @returns {{ base64: string, ms: number, hadSpeech: boolean, endedInSilence: boolean }}
   *   hadSpeech       false = nothing worth injecting; send nothing.
   *   endedInSilence  true  = the utterance finished INSIDE the ring, so no
   *                   live audio will follow and no server VAD event will ever
   *                   close the turn — the caller must close it (the
   *                   stranded-utterance timer in useRealtimeVoice).
   */
  function harvest() {
    const firstSpeech = speech.indexOf(true);
    if (firstSpeech === -1) {
      return { base64: '', ms: 0, hadSpeech: false, endedInSilence: true };
    }
    const from = Math.max(0, firstSpeech - cfg.padFrames);
    const kept = frames.slice(from);
    const tail = speech.slice(-cfg.tailSilenceFrames);
    const endedInSilence = tail.length === cfg.tailSilenceFrames && tail.every((s) => !s);
    return {
      base64: framesToBase64(kept),
      ms: Math.round(kept.length * frameMs),
      hadSpeech: true,
      endedInSilence,
    };
  }

  return {
    push,
    harvest,
    get frameMs() {
      return frameMs;
    },
    get size() {
      return frames.length;
    },
  };
}

/**
 * The Web Audio wiring around the ring. Lives for the length of a handshake
 * (seconds); closed by useRealtimeVoice the moment the live track attaches,
 * so it has zero steady-state cost.
 *
 * @param {MediaStream} stream  the SAME stream the sender will use
 * @param {Partial<typeof DEFAULT_PREROLL_CONFIG>} [config]
 */
export function createPrerollBuffer(stream, config = {}) {
  const cfg = { ...DEFAULT_PREROLL_CONFIG, ...config };
  const ring = createPrerollRing(cfg);

  // Its own context AT THE SESSION'S RATE — see "format is not a choice".
  const ac = new AudioContext({ sampleRate: cfg.sampleRate });
  const source = ac.createMediaStreamSource(stream);
  const processor = ac.createScriptProcessor(cfg.frameSize, 1, 1);
  processor.onaudioprocess = (e) => ring.push(e.inputBuffer.getChannelData(0));
  source.connect(processor);
  // A ScriptProcessor only runs while routed to the destination. Its output
  // buffer is never written, so this contributes silence, not an echo path.
  processor.connect(ac.destination);

  let closed = false;
  return {
    harvest: () => ring.harvest(),
    close() {
      if (closed) return;
      closed = true;
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        /* already gone */
      }
      try {
        source.disconnect();
      } catch {
        /* already gone */
      }
      try {
        void ac.close();
      } catch {
        /* already closed */
      }
    },
  };
}

export default { createPrerollBuffer, createPrerollRing, framesToBase64, DEFAULT_PREROLL_CONFIG };
