/**
 * speechOut — the voice, and the record of what was heard.
 *
 * ENGINE CHOICE: THE FLOOR MUST ALWAYS WORK
 * -----------------------------------------
 * Browser synthesis is the default, not an availability guarantee. It can be
 * absent, blocked or backed by an OS network service. Every speak() returns a
 * typed playback receipt; failed synthesis must not enter the heard record.
 * Provider fallback is allowed only before any playback has started.
 *
 * CANCELLATION IS THE WHOLE GAME
 * ------------------------------
 * Barge-in is judged on one number: how long the assistant keeps talking after
 * the user starts. Above ~150ms it reads as "it didn't hear me" and the user
 * repeats themselves, which cascades into a mess. So `cancel()` is synchronous
 * and unconditional — it stops current audio, drops every queued chunk, and
 * invalidates in-flight synthesis via a generation counter.
 *
 * The generation counter is what makes it correct rather than merely fast. A
 * synthesis request started before the interruption will still resolve
 * afterwards; without a generation check it would cheerfully begin playing
 * audio the user already interrupted. Every async continuation re-checks its
 * generation before touching playback state.
 *
 * WHAT WAS ACTUALLY HEARD
 * -----------------------
 * Playback drives a `createPlaybackQueue`, so at any instant we can answer
 * "what has the user actually heard?" — including a fraction of the sentence
 * in flight. That prefix, not the generated text, is what a barge-in seals the
 * assistant turn at. See spokenPrefix.js.
 */

import { createPlaybackQueue, estimateDurationMs } from './spokenPrefix.js';
import { consumePcmStream } from './pcmStream.js';
import { createPcmPlaybackSink } from './pcmPlaybackSink.js';

export const OutputState = Object.freeze({
  IDLE: 'idle',
  SPEAKING: 'speaking',
});

export const DEFAULT_OUTPUT_CONFIG = Object.freeze({
  /** 'webspeech' or 'provider'; either can return a typed failure. */
  engine: 'webspeech',
  /** Provider engine id passed to the backend when engine === 'provider'. */
  providerEngine: 'openai',
  voice: null,
  rate: 1.05,
  pitch: 1,
  volume: 1,
  /** Backend base path. */
  apiBase: '/api',
  /** Hard bound for synthesis plus playback; a stalled engine is not success. */
  playbackTimeoutMs: 120000,
});

/** Is the browser synthesiser usable in this runtime? */
export function isWebSpeechAvailable() {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

/**
 * Create a voice output pipeline.
 *
 * @param {object} [config]
 * @param {object} [deps] injectable seams for testing: fetch, speechSynthesis,
 *   an Audio factory, a clock. Nothing here touches a global directly, which is
 *   what makes the interruption semantics testable without a sound card.
 */
export function createSpeechOut(config = {}, deps = {}) {
  const cfg = { ...DEFAULT_OUTPUT_CONFIG, ...config };

  const _fetch = deps.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const _synth = deps.speechSynthesis || (typeof window !== 'undefined' ? window.speechSynthesis : null);
  const _Utterance = deps.SpeechSynthesisUtterance || (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null);
  const _createAudio = deps.createAudio || ((src) => new Audio(src));
  const _now = deps.now || (() => Date.now());
  const _getToken = deps.getToken || (() => null);

  let queue = createPlaybackQueue();
  let state = OutputState.IDLE;
  /**
   * Bumped on every cancel. Any async continuation captured an older value and
   * must bail — this is what stops a synthesis that was already in flight from
   * playing audio the user has interrupted.
   */
  let generation = 0;
  let chain = Promise.resolve();
  let currentAudio = null;
  let currentUtterance = null;
  let startedAt = null;
  let cancelCurrent = null;
  let requestAbort = null;
  let cancelWait = null;

  const listeners = { state: [], chunk: [] };

  function emit(event, payload) {
    for (const fn of listeners[event] || []) {
      try {
        fn(payload);
      } catch {
        // A listener must never break playback.
      }
    }
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', state);
  }

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return () => {
      listeners[event] = listeners[event].filter((f) => f !== fn);
    };
  }

  // --- engines ------------------------------------------------------------

  function speakWebSpeech(text, gen, onPlaying) {
    return new Promise((resolve) => {
      if (typeof _synth?.speak !== 'function' || !_Utterance) return resolve({ ok: false, reason: 'unavailable' });

      const u = new _Utterance(text);
      u.rate = cfg.rate;
      u.pitch = cfg.pitch;
      u.volume = cfg.volume;
      if (cfg.voice) u.voice = cfg.voice;

      let settled = false, playbackStarted = false;
      const done = (ok, reason) => {
        if (settled) return;
        settled = true;
        currentUtterance = null;
        cancelCurrent = null;
        resolve({ ok, reason });
      };

      u.onstart = () => { if (!settled && gen === generation) { playbackStarted = true; onPlaying(); } };
      u.onend = () => done(playbackStarted, playbackStarted ? undefined : 'zero-audio');
      // `cancel()` fires onerror with 'interrupted'/'canceled'. That is an
      // expected control-flow event, not a failure, and must not trigger the
      // provider fallback or a retry.
      u.onerror = (e) => done(false, e?.error || 'error');

      currentUtterance = u;
      if (gen !== generation) return done(false, 'stale');
      cancelCurrent = () => done(false, 'stale');
      try { _synth.speak(u); } catch { done(false, 'synthesis'); }
    });
  }

  async function speakProvider(text, gen, onPlaying) {
    if (!_fetch) return { ok: false, reason: 'no-fetch' };

    let res;
    try {
      const token = _getToken();
      requestAbort = new AbortController();
      res = await _fetch(`${cfg.apiBase}/speech/synthesize`, {
        signal: requestAbort.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, engine: cfg.providerEngine, voice: cfg.voice }),
      });
    } catch {
      return { ok: false, reason: 'network' };
    }

    if (gen !== generation) return { ok: false, reason: 'stale' };

    /**
     * Some provider failures are PERMANENT for the session, not transient:
     * an exhausted quota, a revoked key, a forbidden org. Retrying one of
     * those on the next sentence cannot succeed, and it is not free — every
     * chunk pays a failed network round trip before falling back, so the
     * whole conversation gains latency for an outcome that is already known.
     * Demote to the local voice once and stop asking.
     */
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      cfg.engine = 'webspeech';
      // eslint-disable-next-line no-console
      console.warn(`[voice] provider TTS unavailable (${res.status}); using the local voice for this session`);
      return { ok: false, reason: `http-${res.status}` };
    }

    if (!res.ok) return { ok: false, reason: `http-${res.status}` };

    const type = res.headers?.get?.('content-type') || '';
    if (type.includes('application/json')) {
      // A normal unavailable answer must demote once too; otherwise every
      // queued sentence retries a provider already known to be unconfigured.
      let body;
      try { body = await res.json(); } catch { return { ok: false, reason: 'invalid-response' }; }
      if (gen !== generation) return { ok: false, reason: 'stale' };
      if (body?.available === false) cfg.engine = 'webspeech';
      return { ok: false, reason: 'unavailable' };
    }

    const blob = await res.blob();
    if (gen !== generation) return { ok: false, reason: 'stale' };
    if (!blob.size) return { ok: false, reason: 'zero-audio' };

    // Object URLs are not universally available (older webviews, and jsdom in
    // tests). Treat an absent implementation as "provider unusable here" so we
    // fall back to a voice that works, instead of throwing into the chain.
    let url;
    try {
      url = URL.createObjectURL(blob);
    } catch {
      return { ok: false, reason: 'no-object-url' };
    }
    if (typeof url !== 'string') return { ok: false, reason: 'no-object-url' };

    return new Promise((resolve) => {
      const audio = _createAudio(url);
      audio.volume = cfg.volume;
      let settled = false, playbackStarted = false;
      const done = (ok, reason) => {
        if (settled) return;
        settled = true;
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* already revoked */
        }
        // Teardown before releasing ownership: cancellation and timeout must
        // silence the actual element, not merely settle its promise.
        audio.onplaying = audio.onended = audio.onerror = null;
        try { audio.pause?.(); } catch { /* already detached */ }
        try { audio.src = ''; } catch { /* already detached */ }
        if (currentAudio === audio) { currentAudio = null; cancelCurrent = null; }
        resolve({ ok, reason });
      };
      try {
        audio.onplaying = () => { if (!settled && gen === generation) { playbackStarted = true; onPlaying(Number.isFinite(audio.duration) ? audio.duration * 1000 : null); } };
        audio.onended = () => done(playbackStarted, playbackStarted ? undefined : 'zero-audio');
        audio.onerror = () => done(false, 'playback');
        currentAudio = audio;
        if (gen !== generation) return done(false, 'stale');
        cancelCurrent = () => done(false, 'stale');
        const p = audio.play?.();
        if (p && typeof p.catch === 'function') p.catch(() => done(false, 'blocked'));
      } catch {
        done(false, 'playback-setup');
      }
    });
  }

  async function speakLocalStream(text, gen, onPlaying) {
    if (!_fetch) return { ok: false, reason: 'no-fetch' };
    const requestId = globalThis.crypto?.randomUUID?.();
    if (!requestId) return { ok: false, reason: 'no-request-identity' };
    const abort = new AbortController(); requestAbort = abort;
    let sink;
    try {
      const token = _getToken();
      const res = await _fetch(`${cfg.apiBase}/speech/synthesize-stream`, {
        method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text, voice: cfg.voice, requestId, engine: cfg.providerEngine }),
      });
      if (gen !== generation) { await res.body?.cancel?.(); return { ok: false, reason: 'stale' }; }
      if (!res.ok) { await res.body?.cancel?.(); return { ok: false, reason: `http-${res.status}` }; }
      if (!res.headers?.get?.('content-type')?.includes('application/x-ndjson')) {
        await res.body?.cancel?.(); return { ok: false, reason: 'stream-content-type' };
      }
      sink = (deps.createPcmSink || createPcmPlaybackSink)({ volume: cfg.volume });
      cancelCurrent = () => sink.stop();
      return await consumePcmStream({ body: res.body, sink, requestId, signal: abort.signal, isAllowed: () => gen === generation, onPlaying });
    } catch { return { ok: false, reason: gen === generation ? 'stream' : 'stale' }; }
    finally {
      sink?.stop();
      if (requestAbort === abort) { requestAbort = null; cancelCurrent = null; }
    }
  }

  // --- public API ---------------------------------------------------------

  /**
   * Queue a chunk and speak it after everything already queued.
   * Serialised through a promise chain so chunks never overlap.
   */
  function speak(text) {
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) return Promise.resolve({ ok: false, reason: 'empty' });

    // Candidate synthesis queue: one active plus at most one pending text.
    if (cfg.engine === 'local-stream' && queue.pending.length >= 2) return Promise.resolve({ ok: false, reason: 'queue-full' });
    const gen = generation;
    const id = queue.enqueue(clean, estimateDurationMs(clean));

    chain = chain.then(async () => {
      if (gen !== generation) return { ok: false, reason: 'stale' };
      let playing = false, timer, resolveCancelled;
      const cancelled = new Promise(resolve => { resolveCancelled = resolve; });
      cancelWait = resolveCancelled;
      const onPlaying = durationMs => {
        if (gen !== generation || playing) return;
        playing = true;
        startedAt = _now();
        queue.markPlaying(id, startedAt, durationMs);
        setState(OutputState.SPEAKING);
        emit('chunk', { text: clean, id });
      };
      const deadline = new Promise(resolve => {
        const bound = Number.isFinite(cfg.playbackTimeoutMs) ? Math.min(300000, Math.max(1, cfg.playbackTimeoutMs)) : 120000;
        timer = setTimeout(() => { resolve({ ok: false, reason: 'timeout' }); cancel(); }, bound);
      });
      const operation = async () => {
        let result;
        if (cfg.engine === 'local-stream') {
          // Explicit candidate selection: never change audio destination on error.
          result = await speakLocalStream(clean, gen, onPlaying);
        } else if (cfg.engine === 'provider') {
          result = await speakProvider(clean, gen, onPlaying);
          // Never retry after partial playback: replay would duplicate words.
          if (!result.ok && !playing && gen === generation && result.reason !== 'stale') result = await speakWebSpeech(clean, gen, onPlaying);
        } else result = await speakWebSpeech(clean, gen, onPlaying);
        return result;
      };
      let result;
      try { result = await Promise.race([operation(), deadline, cancelled]); }
      catch { result = { ok: false, reason: 'synthesis' }; }
      finally { clearTimeout(timer); if (cancelWait === resolveCancelled) cancelWait = null; }
      if (gen !== generation) return result?.reason === 'timeout' ? result : { ok: false, reason: 'stale' };
      if (result.ok) queue.markDone(id, _now());
      else queue.markFailed(id, _now());
      if (!queue.pending.length) setState(OutputState.IDLE);
      if (!result.ok) emit('error', result);
      return result;
    });

    /**
     * A rejection here would be terminal, not transient: `chain` is the queue,
     * so once it rejects every later `.then` is skipped and the assistant is
     * mute for the rest of the session with no error the user can see. One bad
     * chunk must cost one chunk.
     */
    chain = chain.catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[voice] chunk failed, continuing:', err?.message || err);
      if (gen === generation) {
        queue.markFailed(id, _now());
        if (!queue.pending.length) setState(OutputState.IDLE);
      }
      return { ok: false, reason: 'synthesis' };
    });

    return chain;
  }

  /**
   * Stop immediately and report what was actually heard.
   * Synchronous by design — see the header.
   */
  function cancel() {
    generation += 1;
    const at = _now();
    cancelWait?.({ ok: false, reason: 'stale' }); cancelWait = null;
    requestAbort?.abort(); requestAbort = null;
    cancelCurrent?.(); cancelCurrent = null;

    try {
      _synth?.cancel?.();
    } catch {
      /* nothing to cancel */
    }
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.src = '';
      } catch {
        /* already torn down */
      }
      currentAudio = null;
    }
    currentUtterance = null;

    const result = queue.interrupt(at);
    chain = Promise.resolve();
    setState(OutputState.IDLE);
    return result;
  }

  /** Everything the user has heard so far in this turn. */
  function spokenPrefix() {
    return queue.spokenPrefix(_now());
  }

  /** Begin a new assistant turn: clears the heard-so-far record. */
  function reset() {
    cancel();
    try {
      _synth?.cancel?.();
    } catch {
      /* nothing to cancel */
    }
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch {
        /* already stopped */
      }
      currentAudio = null;
    }
    queue = createPlaybackQueue();
    chain = Promise.resolve();
    startedAt = null;
    setState(OutputState.IDLE);
  }

  /**
   * Resolves once everything queued SO FAR has finished playing (or been
   * cancelled). Resolves immediately when nothing is queued.
   *
   * THE BUG THIS REPLACES: the session used `speak('')` as a drain — "queue an
   * empty chunk, its turn comes when everything before it is done." But the
   * empty-text guard in speak() returns WITHOUT touching the chain, so the
   * caller's .then ran instantly, `reply_end` fired the moment the stream
   * ended, and the new turn's reset() cancelled every chunk still playing.
   * The assistant went silent mid-sentence on every reply longer than one
   * chunk. A drain must be its own primitive, not a special case of speak.
   */
  function whenIdle() {
    return chain.then(() => undefined);
  }

  return {
    speak,
    cancel,
    reset,
    whenIdle,
    spokenPrefix,
    on,
    get state() {
      return state;
    },
    get isSpeaking() {
      return state === OutputState.SPEAKING;
    },
    get pending() {
      return queue.pending;
    },
    get config() {
      return cfg;
    },
    /** Change engine/voice/rate mid-session without losing the queue. */
    configure(patch = {}) {
      Object.assign(cfg, patch);
    },
  };
}

export default { createSpeechOut, isWebSpeechAvailable, OutputState, DEFAULT_OUTPUT_CONFIG };
