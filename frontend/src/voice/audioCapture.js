/**
 * audioCapture — one microphone, one graph, one truth.
 *
 * WHY A SINGLE CAPTURE PATH IS AN ARCHITECTURAL DECISION
 * ------------------------------------------------------
 * The obvious build has two audio paths: one always-on listener for the wake
 * word, and a separate recorder opened when it is time to capture a command.
 * Every implementation that does this ships the same bug class — the two paths
 * disagree about which device is selected, or one holds the mic while the other
 * tries to open it, or OS permission is granted to one and not the other. It
 * presents as "it says it's listening but hears nothing", and it is
 * unfixable in general because the two paths can always drift apart.
 *
 * So there is ONE getUserMedia stream and ONE AudioContext here. The VAD, the
 * wake detector and the recorder are all consumers of that single graph. They
 * cannot disagree about the device, because there is only one.
 *
 * ECHO CANCELLATION IS LOAD-BEARING
 * ---------------------------------
 * Barge-in requires the mic to stay open while we speak. Without AEC the
 * assistant hears itself, the VAD fires, and it interrupts its own sentence —
 * on every single reply. `echoCancellation: true` is therefore not a nicety,
 * and `analyserGuard` below is the belt to its braces: while our own audio is
 * playing we require a higher energy ratio before believing it is the user.
 * The full reasoning for every mic flag lives in micConstraints.js.
 *
 * THE RECORDER RECORDS THE PAST — AND THAT IS THE WHOLE POINT
 * -----------------------------------------------------------
 * Reported: "the beginning of my sentence gets cut off."
 *
 * It did, by construction. Recording used to begin when the VAD announced
 * speech, and a MediaRecorder can only record forward from the moment it is
 * created. But the VAD cannot announce speech until it has already HEARD some:
 * three consecutive frames above the noise floor (~60ms) before it will commit,
 * on top of however long the speaker took to cross that threshold at all. A
 * sentence that opens softly — "hey, so what I need is…" — spends its first
 * word below the bar. Every one of those milliseconds was audio that existed,
 * proved the user was talking, and was then thrown away because nothing was
 * holding it.
 *
 * So the graph now keeps a rolling `prerollMs` of PCM at all times, and
 * startRecording() seeds the recording with it. The audio that proves speech
 * began is the same audio that gets transcribed.
 *
 * WHY PCM AND NOT MediaRecorder
 * -----------------------------
 * A MediaRecorder cannot be handed audio from before it existed, and a WebM
 * stream cannot be trimmed or restarted at an arbitrary point without decoding
 * it. Since this module already receives every frame as Float32 PCM in order to
 * run the VAD, the recording is assembled from those same frames and encoded as
 * a WAV on stop. One source of audio, no second capture path — which is the
 * rule at the top of this file, now applied to the recorder as well.
 *
 * The cost is bytes on the wire (WAV is uncompressed) to a transcription
 * endpoint on localhost. The benefit is that the recording is exact, starts
 * where we say it starts, and is testable without a MediaRecorder.
 */

import { createVad } from './energyVad.js';
import { MIC_CONSTRAINTS } from './micConstraints.js';

export const DEFAULT_CAPTURE_CONFIG = Object.freeze({
  /** Frame size fed to the VAD. 1024 @48k ~= 21ms. */
  frameSize: 1024,
  /** Extra confidence required to declare speech while WE are talking. */
  duckedOnsetMultiplier: 2.2,
  /**
   * How much audio from BEFORE the VAD fired is kept and prepended to a
   * recording. Covers the detector's own onset delay plus a soft sentence
   * opener. Too small and the first word is still clipped; too large and every
   * utterance carries needless room tone in front of it.
   */
  prerollMs: 800,
  /**
   * Hard ceiling on a single recording. Without it a session left open with a
   * stuck VAD grows an array until the tab dies. Two minutes of 48kHz mono
   * 16-bit is ~11MB, which is the most this is ever allowed to hold.
   */
  maxUtteranceMs: 120000,
});

/**
 * Float PCM in [-1,1] to 16-bit signed, clipped rather than wrapped.
 *
 * Exported: prerollBuffer.js converts its ring with THIS function rather than
 * a copy. Duplicated per-sample math across capture paths is exactly how the
 * mic-constraint bugs shipped (see micConstraints.js header) — one definition,
 * every consumer.
 */
export function toInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i] < -1 ? -1 : input[i] > 1 ? 1 : input[i];
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Concatenate 16-bit frames into a mono WAV blob.
 * @param {Int16Array[]} frames
 * @param {number} totalSamples
 * @param {number} sampleRate
 */
export function encodeWav(frames, totalSamples, sampleRate) {
  const bytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  const samples = new Int16Array(buffer, 44, totalSamples);
  let offset = 0;
  for (const frame of frames) {
    samples.set(frame, offset);
    offset += frame.length;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * @param {object} [config]
 * @param {object} [deps] injectable for tests: getUserMedia, AudioContext.
 */
export function createAudioCapture(config = {}, deps = {}) {
  const cfg = { ...DEFAULT_CAPTURE_CONFIG, ...config };

  const _getUserMedia =
    deps.getUserMedia ||
    ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const _AudioContext = deps.AudioContext || (typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null);

  let stream = null;
  let ctx = null;
  let source = null;
  let processor = null;
  let vad = null;
  let sampleRate = 48000;

  let recording = false;
  /** Frames belonging to the recording in progress, pre-roll first. */
  let captured = [];
  let capturedSamples = 0;

  /**
   * The rolling pre-roll window: the most recent `prerollMs` of audio, held
   * whether or not anything is recording. Each entry carries the absolute
   * sample index it ENDS at, which is what makes the boundary check below
   * exact.
   */
  let ring = [];
  let ringSamples = 0;
  /** Samples observed since the graph opened. Monotonic. */
  let samplesSeen = 0;
  /**
   * Where the previous recording stopped.
   *
   * WITHOUT THIS, THE FIX CAUSES A DUPLICATE. A turn can be reopened — a pause
   * that turns out not to be the end of the sentence starts a SECOND recording
   * a few hundred milliseconds later, and its pre-roll window still holds the
   * tail of the segment just transcribed. That tail would be transcribed twice
   * and appended to the same turn, so the user's words would stutter. Pre-roll
   * therefore only reaches back as far as the end of the last recording.
   */
  let lastRecordingEndSample = 0;

  /** True while our own TTS is audible; raises the speech bar. See header. */
  let ducked = false;

  const listeners = { frame: [], speech_start: [], speech_end: [], level: [] };

  function emit(event, payload) {
    for (const fn of listeners[event] || []) {
      try {
        fn(payload);
      } catch {
        // A listener must never take down the audio graph.
      }
    }
  }

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return () => {
      listeners[event] = listeners[event].filter((f) => f !== fn);
    };
  }

  const prerollSamples = () => Math.round((cfg.prerollMs / 1000) * sampleRate);
  const maxCapturedSamples = () => Math.round((cfg.maxUtteranceMs / 1000) * sampleRate);

  /** Retain the frame for pre-roll, discarding anything older than the window. */
  function pushRing(pcm, endsAt) {
    ring.push({ pcm, endsAt });
    ringSamples += pcm.length;
    const keep = prerollSamples();
    // `ring.length` and not `ring.length > 1`: a configured window of zero must
    // be able to empty the ring completely, or "no pre-roll" still smuggles the
    // most recent frame into the recording and the control case is untestable.
    while (ring.length && ringSamples - ring[0].pcm.length >= keep) {
      ringSamples -= ring[0].pcm.length;
      ring.shift();
    }
  }

  async function start() {
    if (stream) return { ok: true, already: true };

    try {
      stream = await _getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      return { ok: false, error: err?.name || 'mic-denied', message: err?.message };
    }

    if (!_AudioContext) return { ok: false, error: 'no-audio-context' };

    ctx = new _AudioContext();
    sampleRate = ctx.sampleRate || 48000;
    source = ctx.createMediaStreamSource(stream);
    vad = createVad({ frameMs: Math.round((cfg.frameSize / sampleRate) * 1000) });

    ring = [];
    ringSamples = 0;
    samplesSeen = 0;
    lastRecordingEndSample = 0;

    // ScriptProcessor is deprecated in favour of AudioWorklet, but it needs no
    // separate module file, works identically in Electron and the browser, and
    // this node only computes an RMS per frame. The upgrade path is a drop-in
    // replacement behind this same interface.
    processor = ctx.createScriptProcessor(cfg.frameSize, 1, 1);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);

      // Retain the audio FIRST, unconditionally — before the VAD is consulted,
      // before calibration is checked, before anything can decide this frame
      // does not matter. The frames that turn out to matter are precisely the
      // ones nobody knew mattered yet.
      const pcm = toInt16(input);
      samplesSeen += pcm.length;
      if (recording && capturedSamples < maxCapturedSamples()) {
        captured.push(pcm);
        capturedSamples += pcm.length;
      }
      pushRing(pcm, samplesSeen);

      const before = vad.isSpeaking;

      const result = vad.push(input);
      emit('frame', result);
      emit('level', Math.min(1, result.energy * 12));

      if (vad.isCalibrating) return;

      // While ducked, demand a clearly higher ratio before believing it is the
      // user rather than AEC leakage of our own voice.
      const duckedBlocked = ducked && result.ratio < vad.config.onsetRatio * cfg.duckedOnsetMultiplier;

      if (!before && result.speaking && !duckedBlocked) emit('speech_start', result);
      else if (before && !result.speaking) emit('speech_end', result);
    };

    source.connect(processor);
    // A ScriptProcessor does not fire unless it is connected to a destination.
    // Route through a silent gain node so nothing is actually played back —
    // connecting the mic straight to the speakers would create a feedback loop.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(ctx.destination);

    return { ok: true };
  }

  function stop() {
    try {
      processor?.disconnect();
      source?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      if (ctx && ctx.state !== 'closed') ctx.close();
    } catch {
      /* already closed */
    }
    try {
      stream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    stopRecording();
    stream = null;
    ctx = null;
    source = null;
    processor = null;
    vad = null;
    ring = [];
    ringSamples = 0;
    captured = [];
    capturedSamples = 0;
    samplesSeen = 0;
    lastRecordingEndSample = 0;
  }

  /**
   * Begin buffering audio for transcription, starting `prerollMs` in the past.
   * Idempotent.
   */
  function startRecording() {
    if (recording || !stream || !ctx) return false;

    captured = [];
    capturedSamples = 0;
    for (const frame of ring) {
      // Anything already inside a previous recording has been transcribed.
      if (frame.endsAt <= lastRecordingEndSample) continue;
      captured.push(frame.pcm);
      capturedSamples += frame.pcm.length;
    }

    recording = true;
    return true;
  }

  /**
   * Stop and return the buffered audio as `{ blob, durationMs, sampleRate }`.
   *
   * Resolves with null rather than rejecting when there is nothing to return —
   * an endpoint on room noise is normal, and a rejection there would surface a
   * scary error for an ordinary event. Duration is reported because the caller
   * decides what is too short to be speech, and the byte length of a WAV says
   * nothing useful about that.
   */
  function stopRecording() {
    if (!recording) return Promise.resolve(null);

    recording = false;
    lastRecordingEndSample = samplesSeen;

    const frames = captured;
    const total = capturedSamples;
    captured = [];
    capturedSamples = 0;

    if (!total) return Promise.resolve(null);

    return Promise.resolve({
      blob: encodeWav(frames, total, sampleRate),
      durationMs: Math.round((total / sampleRate) * 1000),
      sampleRate,
    });
  }

  return {
    start,
    stop,
    startRecording,
    stopRecording,
    on,
    /** Raise the speech bar while our own audio is playing. */
    setDucked(value) {
      ducked = !!value;
    },
    get isRecording() {
      return recording;
    },
    get isActive() {
      return !!stream;
    },
    get silenceMs() {
      return vad ? vad.silenceMs : 0;
    },
    get isSpeaking() {
      return vad ? vad.isSpeaking : false;
    },
    get isCalibrating() {
      return vad ? vad.isCalibrating : true;
    },
    /** Milliseconds of audio currently held for pre-roll. Diagnostics/tests. */
    get prerollMs() {
      return Math.round((ringSamples / sampleRate) * 1000);
    },
  };
}

export default { createAudioCapture, encodeWav, DEFAULT_CAPTURE_CONFIG };
