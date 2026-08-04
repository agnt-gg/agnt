/**
 * speechOut — the voice, and the record of what was heard.
 *
 * ENGINE CHOICE: THE FLOOR MUST ALWAYS WORK
 * -----------------------------------------
 * Voice output has one non-negotiable property: it works. An assistant that
 * cannot speak because a key is missing, a model has not downloaded, or the
 * network is down is not "degraded" — it is broken, and the user cannot tell
 * why. So the DEFAULT engine is the browser's own synthesiser: no key, no
 * download, no network, no cost, present on every OS AGNT ships to. Provider
 * TTS (OpenAI, ElevenLabs) is strictly an upgrade layered on top, and a failure
 * there falls back rather than going silent.
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

export const OutputState = Object.freeze({
  IDLE: 'idle',
  SPEAKING: 'speaking',
});

export const DEFAULT_OUTPUT_CONFIG = Object.freeze({
  /** 'webspeech' (always works) or 'provider' (better, needs a key). */
  engine: 'webspeech',
  /** Provider engine id passed to the backend when engine === 'provider'. */
  providerEngine: 'openai',
  voice: null,
  rate: 1.05,
  pitch: 1,
  volume: 1,
  /** Backend base path. */
  apiBase: '/api',
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

  function speakWebSpeech(text, gen) {
    return new Promise((resolve) => {
      if (!_synth || !_Utterance) return resolve({ ok: false, reason: 'unavailable' });

      const u = new _Utterance(text);
      u.rate = cfg.rate;
      u.pitch = cfg.pitch;
      u.volume = cfg.volume;
      if (cfg.voice) u.voice = cfg.voice;

      let settled = false;
      const done = (ok, reason) => {
        if (settled) return;
        settled = true;
        currentUtterance = null;
        resolve({ ok, reason });
      };

      u.onend = () => done(true);
      // `cancel()` fires onerror with 'interrupted'/'canceled'. That is an
      // expected control-flow event, not a failure, and must not trigger the
      // provider fallback or a retry.
      u.onerror = (e) => done(false, e?.error || 'error');

      currentUtterance = u;
      if (gen !== generation) return done(false, 'stale');
      _synth.speak(u);
    });
  }

  async function speakProvider(text, gen) {
    if (!_fetch) return { ok: false, reason: 'no-fetch' };

    let res;
    try {
      const token = _getToken();
      res = await _fetch(`${cfg.apiBase}/speech/synthesize`, {
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
      // The documented "no credentials configured" answer. Fall back quietly.
      return { ok: false, reason: 'unavailable' };
    }

    const blob = await res.blob();
    if (gen !== generation) return { ok: false, reason: 'stale' };

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
      let settled = false;
      const done = (ok, reason) => {
        if (settled) return;
        settled = true;
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* already revoked */
        }
        currentAudio = null;
        resolve({ ok, reason });
      };
      try {
        audio.onended = () => done(true);
        audio.onerror = () => done(false, 'playback');
        currentAudio = audio;
        if (gen !== generation) return done(false, 'stale');
        const p = audio.play?.();
        if (p && typeof p.catch === 'function') p.catch(() => done(false, 'blocked'));
      } catch {
        done(false, 'playback-setup');
      }
    });
  }

  // --- public API ---------------------------------------------------------

  /**
   * Queue a chunk and speak it after everything already queued.
   * Serialised through a promise chain so chunks never overlap.
   */
  function speak(text) {
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) return Promise.resolve({ ok: false, reason: 'empty' });

    const gen = generation;
    const id = queue.enqueue(clean, estimateDurationMs(clean));

    chain = chain.then(async () => {
      if (gen !== generation) return;

      setState(OutputState.SPEAKING);
      startedAt = _now();
      queue.markPlaying(id, startedAt);
      emit('chunk', { text: clean, id });

      let result;
      if (cfg.engine === 'provider') {
        result = await speakProvider(clean, gen);
        // A provider failure must not mean silence. The one exception is a
        // stale generation: the user interrupted, and falling back would speak
        // the very text they just cancelled.
        if (!result.ok && result.reason !== 'stale') {
          result = await speakWebSpeech(clean, gen);
        }
      } else {
        result = await speakWebSpeech(clean, gen);
      }

      if (gen !== generation) return;
      queue.markDone(id, _now());
      if (!queue.pending.length) setState(OutputState.IDLE);
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
        queue.markDone(id, _now());
        if (!queue.pending.length) setState(OutputState.IDLE);
      }
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
    generation += 1;
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
