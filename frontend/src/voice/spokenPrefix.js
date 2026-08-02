/**
 * spokenPrefix — the playback queue, and the record of what was actually HEARD.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ------------------------------
 * The model generates four sentences. TTS is mid-way through sentence two when
 * the user cuts in with "no, that's not what I meant."
 *
 * Naively, the conversation history now contains all four sentences, and the
 * correction is attached to them. The model then defends — or elaborates on —
 * two sentences the user never heard. It reads as not listening, and it is the
 * single most common reason an interruptible assistant still feels deaf.
 *
 * The fix is bookkeeping, not intelligence. The playback queue knows exactly
 * which chunks finished, which one was mid-flight, and how far into it we got.
 * That prefix — and only that prefix — is what the user heard. On barge-in we
 * seal the assistant turn at the prefix and mark it interrupted, so the model
 * resolves the correction against reality.
 *
 * PARTIAL CHUNK ACCOUNTING
 * ------------------------
 * The interrupted chunk is included proportionally, estimated from elapsed
 * playback time against the chunk's duration, then rounded back to a word
 * boundary — cutting mid-word produces a garbage token that reads as an ASR
 * error to the model. If duration is unknown we fall back to a words-per-minute
 * estimate, which is imprecise but bounded and always better than dropping or
 * including the whole chunk.
 *
 * This module owns queue STATE only. It performs no audio I/O, so the whole
 * interruption path is testable without a sound card.
 */

export const DEFAULT_PLAYBACK_CONFIG = Object.freeze({
  /** Fallback speaking rate when a chunk's real duration is unknown. */
  wordsPerMinute: 165,
  /** Round a partial chunk back to a word boundary. */
  snapToWord: true,
});

const wordCount = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);

/** Estimated ms to speak `text` at `wpm`. */
export function estimateDurationMs(text, wpm = DEFAULT_PLAYBACK_CONFIG.wordsPerMinute) {
  const words = wordCount(text);
  if (words === 0) return 0;
  return Math.round((words / wpm) * 60000);
}

/**
 * Take the leading `fraction` of `text`, snapped back to a word boundary.
 * Guarantees: fraction<=0 → '', fraction>=1 → whole string.
 */
export function partialText(text, fraction, config = {}) {
  const cfg = { ...DEFAULT_PLAYBACK_CONFIG, ...config };
  const s = String(text || '');
  if (!s) return '';
  if (!Number.isFinite(fraction) || fraction <= 0) return '';
  if (fraction >= 1) return s;

  const cut = Math.floor(s.length * fraction);
  if (cut <= 0) return '';
  if (!cfg.snapToWord) return s.slice(0, cut);

  // Already at a boundary?
  if (cut >= s.length || /\s/.test(s[cut])) return s.slice(0, cut).trimEnd();

  const back = s.lastIndexOf(' ', cut);
  if (back <= 0) return '';
  return s.slice(0, back).trimEnd();
}

/**
 * Create a playback queue.
 *
 * The host calls `enqueue` as chunks are synthesised, `markPlaying` when audio
 * for a chunk actually starts, `markDone` when it ends, and `interrupt(now)`
 * on barge-in. `spokenPrefix()` is valid at any point.
 */
export function createPlaybackQueue(config = {}) {
  const cfg = { ...DEFAULT_PLAYBACK_CONFIG, ...config };

  /** @type {Array<{id:number,text:string,durationMs:number|null,state:string,startedAt:number|null,endedAt:number|null}>} */
  let items = [];
  let nextId = 1;
  let interruptedAt = null;

  function enqueue(text, durationMs = null) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const item = {
      id: nextId++,
      text: clean,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
      state: 'queued',
      startedAt: null,
      endedAt: null,
    };
    items.push(item);
    return item.id;
  }

  function markPlaying(id, now, durationMs = null) {
    const item = items.find((i) => i.id === id);
    if (!item) return false;
    item.state = 'playing';
    item.startedAt = Number.isFinite(now) ? now : 0;
    if (Number.isFinite(durationMs) && durationMs > 0) item.durationMs = durationMs;
    return true;
  }

  function markDone(id, now) {
    const item = items.find((i) => i.id === id);
    if (!item) return false;
    item.state = 'done';
    item.endedAt = Number.isFinite(now) ? now : 0;
    return true;
  }

  /**
   * Freeze the queue at `now`. Everything queued-but-unplayed is discarded —
   * the user will never hear it, so it must not enter the transcript.
   * @returns {{ spoken:string, discarded:string, partial:string }}
   */
  function interrupt(now) {
    interruptedAt = Number.isFinite(now) ? now : 0;

    const spokenParts = [];
    const discardedParts = [];
    let partial = '';

    for (const item of items) {
      if (item.state === 'done') {
        spokenParts.push(item.text);
        continue;
      }
      if (item.state === 'playing') {
        const dur = item.durationMs || estimateDurationMs(item.text, cfg.wordsPerMinute);
        const elapsed = Math.max(0, interruptedAt - (item.startedAt ?? interruptedAt));
        const fraction = dur > 0 ? elapsed / dur : 0;
        partial = partialText(item.text, fraction, cfg);
        if (partial) spokenParts.push(partial);
        const rest = item.text.slice(partial.length).trim();
        if (rest) discardedParts.push(rest);
        item.state = 'interrupted';
        item.endedAt = interruptedAt;
        continue;
      }
      if (item.state === 'queued') {
        discardedParts.push(item.text);
        item.state = 'discarded';
      }
    }

    return {
      spoken: spokenParts.join(' ').replace(/\s+/g, ' ').trim(),
      discarded: discardedParts.join(' ').replace(/\s+/g, ' ').trim(),
      partial,
    };
  }

  /** Everything the user has heard so far. Safe to call at any time. */
  function spokenPrefix(now = null) {
    const t = Number.isFinite(now) ? now : interruptedAt;
    const parts = [];
    for (const item of items) {
      if (item.state === 'done') {
        parts.push(item.text);
      } else if (item.state === 'interrupted') {
        const dur = item.durationMs || estimateDurationMs(item.text, cfg.wordsPerMinute);
        const elapsed = Math.max(0, (item.endedAt ?? 0) - (item.startedAt ?? 0));
        const p = partialText(item.text, dur > 0 ? elapsed / dur : 0, cfg);
        if (p) parts.push(p);
      } else if (item.state === 'playing' && t !== null) {
        const dur = item.durationMs || estimateDurationMs(item.text, cfg.wordsPerMinute);
        const elapsed = Math.max(0, t - (item.startedAt ?? t));
        const p = partialText(item.text, dur > 0 ? elapsed / dur : 0, cfg);
        if (p) parts.push(p);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  return {
    enqueue,
    markPlaying,
    markDone,
    interrupt,
    spokenPrefix,
    reset() {
      items = [];
      nextId = 1;
      interruptedAt = null;
    },
    get pending() {
      return items.filter((i) => i.state === 'queued' || i.state === 'playing').map((i) => i.text);
    },
    get size() {
      return items.length;
    },
    get wasInterrupted() {
      return interruptedAt !== null;
    },
    /** Debug/testing view. */
    get items() {
      return items.map((i) => ({ ...i }));
    },
  };
}

export default { createPlaybackQueue, partialText, estimateDurationMs, DEFAULT_PLAYBACK_CONFIG };
