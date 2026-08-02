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
 */

import { createVad } from './energyVad.js';

export const DEFAULT_CAPTURE_CONFIG = Object.freeze({
  /** Frame size fed to the VAD. 1024 @48k ~= 21ms. */
  frameSize: 1024,
  /** Extra confidence required to declare speech while WE are talking. */
  duckedOnsetMultiplier: 2.2,
  /** MediaRecorder chunk cadence. */
  timesliceMs: 250,
  mimeType: 'audio/webm',
});

/**
 * @param {object} [config]
 * @param {object} [deps] injectable for tests: getUserMedia, AudioContextCtor,
 *   MediaRecorderCtor.
 */
export function createAudioCapture(config = {}, deps = {}) {
  const cfg = { ...DEFAULT_CAPTURE_CONFIG, ...config };

  const _getUserMedia =
    deps.getUserMedia ||
    ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const _AudioContext = deps.AudioContext || (typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null);
  const _MediaRecorder = deps.MediaRecorder || (typeof window !== 'undefined' ? window.MediaRecorder : null);

  let stream = null;
  let ctx = null;
  let source = null;
  let processor = null;
  let vad = null;

  let recorder = null;
  let chunks = [];
  let recording = false;

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

  async function start() {
    if (stream) return { ok: true, already: true };

    try {
      stream = await _getUserMedia({
        audio: {
          echoCancellation: true, // see header — barge-in depends on this
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      return { ok: false, error: err?.name || 'mic-denied', message: err?.message };
    }

    if (!_AudioContext) return { ok: false, error: 'no-audio-context' };

    ctx = new _AudioContext();
    source = ctx.createMediaStreamSource(stream);
    vad = createVad({ frameMs: Math.round((cfg.frameSize / (ctx.sampleRate || 48000)) * 1000) });

    // ScriptProcessor is deprecated in favour of AudioWorklet, but it needs no
    // separate module file, works identically in Electron and the browser, and
    // this node only computes an RMS per frame. The upgrade path is a drop-in
    // replacement behind this same interface.
    processor = ctx.createScriptProcessor(cfg.frameSize, 1, 1);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
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
  }

  /** Begin buffering audio for transcription. Idempotent. */
  function startRecording() {
    if (recording || !stream || !_MediaRecorder) return false;
    chunks = [];
    try {
      const supported =
        typeof _MediaRecorder.isTypeSupported === 'function' ? _MediaRecorder.isTypeSupported(cfg.mimeType) : true;
      recorder = new _MediaRecorder(stream, supported ? { mimeType: cfg.mimeType } : undefined);
    } catch {
      recorder = new _MediaRecorder(stream);
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.start(cfg.timesliceMs);
    recording = true;
    return true;
  }

  /**
   * Stop and return the buffered audio.
   *
   * Resolves with null rather than rejecting when there is nothing to return —
   * an endpoint on room noise is normal, and a rejection there would surface a
   * scary error for an ordinary event.
   */
  function stopRecording() {
    if (!recording || !recorder) {
      recording = false;
      return Promise.resolve(null);
    }
    const rec = recorder;
    recording = false;
    recorder = null;

    return new Promise((resolve) => {
      const finish = () => {
        const blob = chunks.length ? new Blob(chunks, { type: chunks[0]?.type || cfg.mimeType }) : null;
        chunks = [];
        resolve(blob);
      };
      rec.onstop = finish;
      try {
        rec.stop();
      } catch {
        finish();
      }
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
  };
}

export default { createAudioCapture, DEFAULT_CAPTURE_CONFIG };
