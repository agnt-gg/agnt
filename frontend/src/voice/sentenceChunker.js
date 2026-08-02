/**
 * sentenceChunker — turns a growing LLM stream into speakable units.
 *
 * WHY THIS IS THE WHOLE LATENCY STORY
 * -----------------------------------
 * If you wait for `done` before synthesising, time-to-first-audio is the time
 * to generate the ENTIRE answer — three, five, ten seconds. Nothing else you do
 * to the pipeline can recover that. Speak the first sentence while the rest is
 * still being written and time-to-first-audio becomes the time to generate ~12
 * words plus one TTS round trip. That is the difference between a conversation
 * and a lookup.
 *
 * The orchestrator already emits `accumulated` on every `content_delta`, so
 * this needs no backend change at all — it is a pure function of a string that
 * grows.
 *
 * WHY NOT JUST SPLIT ON `.`
 * -------------------------
 * Because the text is technical, and a naive split mangles it into nonsense:
 *
 *   "run npm install"        → the period in `v2.17.2` is not a sentence end
 *   "see index.js line 40"   → neither is the one in a filename
 *   "costs $1.50"            → nor a decimal
 *   "Dr. Chen said"          → nor an abbreviation
 *
 * Each bad split produces a chunk that ends mid-phrase, and TTS renders it with
 * falling sentence-final intonation. The result sounds broken in a way users
 * cannot name but immediately hear.
 *
 * WHAT DOES NOT GET SPOKEN
 * ------------------------
 * Code fences, tables, URLs, image refs, and math are visual. Reading a fenced
 * block aloud is unbearable — 40 seconds of punctuation names. They are removed
 * and replaced with a short spoken acknowledgement, while the full text still
 * renders in the transcript. Voice is a second channel onto the same answer,
 * not a transcription of it.
 *
 * Pure and incremental: feed it the accumulated string, get back whatever is
 * newly speakable.
 */

/** Abbreviations whose trailing period never ends a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt',
  'e.g', 'i.e', 'etc', 'vs', 'approx', 'est', 'dept', 'inc', 'ltd', 'co',
  'fig', 'no', 'vol', 'pp', 'al', 'ca', 'cf',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'u.s', 'u.k', 'a.m', 'p.m',
]);

export const DEFAULT_CHUNKER_CONFIG = Object.freeze({
  /** Do not emit a chunk shorter than this unless the stream has ended — tiny
   *  chunks cost a TTS round trip each and sound clipped. */
  minChunkChars: 12,
  /** Force a break past this length even with no terminator, so a model that
   *  writes one enormous comma-spliced sentence still starts speaking. */
  maxChunkChars: 240,
  /** Where to break when maxChunkChars is hit, in order of preference. */
  softBreaks: [';', ':', ',', ' — ', ' - '],
});

/** Announcements substituted for visual-only content. */
export const VISUAL_SUBSTITUTIONS = Object.freeze({
  codeBlock: 'I have put the code in the chat.',
  table: 'There is a table in the chat.',
  chart: 'I have put a chart in the chat.',
  image: 'I have put an image in the chat.',
});

/**
 * Clip the text at an UNTERMINATED code fence.
 *
 * A fence only matches the strip regex once its closing ``` arrives. While it
 * is still streaming there is no closing marker, so the code body looks like
 * ordinary prose — and gets spoken. The user hears a long stretch of `const`,
 * `require`, and punctuation names before the fence ever closes.
 *
 * Nothing after an open fence can be classified yet, so nothing after it is
 * safe to speak. Holding it back costs a moment of latency on exactly one
 * chunk and removes the failure entirely: when the fence closes, the whole
 * span collapses to a short note and the text after it becomes speakable.
 */
function clipAtOpenFence(text) {
  const s = String(text || '');
  let count = 0;
  let lastOpen = -1;
  const re = /```/g;
  let m;
  while ((m = re.exec(s))) {
    count += 1;
    if (count % 2 === 1) lastOpen = m.index;
  }
  return count % 2 === 1 && lastOpen !== -1 ? s.slice(0, lastOpen) : s;
}

/**
 * Strip content that must not be read aloud, replacing each with a short
 * spoken note. Order matters: fenced blocks are removed before inline code so
 * a fence containing backticks is not shredded first.
 */
export function stripUnspeakable(text) {
  let out = clipAtOpenFence(text);
  const notes = [];

  // Fenced code blocks (including the chartjs/d3/html renderers).
  out = out.replace(/```([a-zA-Z0-9_-]*)\n?[\s\S]*?```/g, (_m, lang) => {
    const l = String(lang || '').toLowerCase();
    const note = l === 'chartjs' || l === 'd3' ? VISUAL_SUBSTITUTIONS.chart : VISUAL_SUBSTITUTIONS.codeBlock;
    if (!notes.includes(note)) notes.push(note);
    return ' \u0000NOTE\u0000 ';
  });

  // Markdown tables — two or more consecutive lines that look like rows.
  out = out.replace(/(?:^\|.*\|[ \t]*$\n?){2,}/gm, () => {
    if (!notes.includes(VISUAL_SUBSTITUTIONS.table)) notes.push(VISUAL_SUBSTITUTIONS.table);
    return ' \u0000NOTE\u0000 ';
  });

  // Images: markdown, HTML tags, and AGNT image refs.
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, () => {
    if (!notes.includes(VISUAL_SUBSTITUTIONS.image)) notes.push(VISUAL_SUBSTITUTIONS.image);
    return ' \u0000NOTE\u0000 ';
  });
  out = out.replace(/<img\b[^>]*>/gi, () => {
    if (!notes.includes(VISUAL_SUBSTITUTIONS.image)) notes.push(VISUAL_SUBSTITUTIONS.image);
    return ' \u0000NOTE\u0000 ';
  });
  out = out.replace(/\{\{IMAGE_REF:[^}]*\}\}/g, ' ');
  out = out.replace(/\{\{DATA_REF:[^}]*\}\}/g, ' ');

  // Inline code → speak the contents without the backticks. Short identifiers
  // read fine; it is only whole blocks that are unbearable.
  out = out.replace(/`([^`]+)`/g, '$1');

  // Links: keep the label, drop the URL. Nobody wants an h-t-t-p-s spelled out.
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  out = out.replace(/https?:\/\/\S+/g, ' link ');

  // Math delimiters — the expression itself is left, the fences removed.
  out = out.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  out = out.replace(/\\\[[\s\S]*?\\\]/g, ' ');
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, '$1');

  // Markdown emphasis, headings, list bullets, blockquotes.
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/^\s*[-*+]\s+/gm, '');
  out = out.replace(/^\s*\d+\.\s+/gm, '');
  out = out.replace(/^\s*>\s?/gm, '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/~~([^~]+)~~/g, '$1');
  out = out.replace(/^\s*(?:---|\*\*\*|___)\s*$/gm, ' ');

  // Substitute the notes back in, at most one of each, in order of appearance.
  let i = 0;
  out = out.replace(/\u0000NOTE\u0000/g, () => notes[Math.min(i++, notes.length - 1)] || '');

  return out.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

/**
 * True when the period at `index` genuinely ends a sentence.
 * Rejects decimals, version strings, filenames, ellipses and abbreviations.
 */
function isSentenceEnd(text, index) {
  const ch = text[index];
  if (ch === '!' || ch === '?') return true;
  if (ch !== '.') return false;

  const prev = text[index - 1];
  const next = text[index + 1];

  // Ellipsis — a pause, not a terminator.
  if (prev === '.' || next === '.') return false;

  // Digit on both sides: a decimal or a version (1.5, v2.17.2).
  if (/\d/.test(prev || '') && /\d/.test(next || '')) return false;

  // A letter immediately after with no space: a filename or a domain
  // (index.js, agnt.gg). Real sentence ends are followed by whitespace or EOS.
  if (next && /[A-Za-z0-9]/.test(next)) return false;

  // Single capital before the dot: an initial (J. Morency).
  if (prev && /[A-Z]/.test(prev) && (index < 2 || /\s/.test(text[index - 2] || ' '))) return false;

  // Known abbreviation immediately before the dot.
  const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
  const word = (before.match(/([a-z.]+)$/) || [])[1];
  if (word && ABBREVIATIONS.has(word)) return false;

  return true;
}

/** Index just past the first sentence terminator in `text`, or -1. */
export function findSentenceEnd(text, from = 0) {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '\n') continue;
    if (c === '\n') {
      // A hard newline after real content is a legitimate break — headings and
      // list items rarely carry terminal punctuation.
      if (text.slice(from, i).trim().length > 0) return i + 1;
      continue;
    }
    if (isSentenceEnd(text, i)) {
      // Consume trailing quotes/brackets so `He said "go."` stays whole.
      let end = i + 1;
      while (end < text.length && /["'”’)\]]/.test(text[end])) end += 1;
      return end;
    }
  }
  return -1;
}

/**
 * Create an incremental chunker.
 *
 * `push(accumulated)` takes the FULL accumulated text (exactly what
 * `content_delta.accumulated` carries) and returns any newly speakable chunks.
 * `flush()` releases the remainder when the stream ends.
 */
export function createSentenceChunker(config = {}) {
  const cfg = { ...DEFAULT_CHUNKER_CONFIG, ...config };

  /** How much of the SPOKEN (stripped) text has already been emitted. */
  let emitted = 0;
  let lastSpeakable = '';

  function takeChunks(speakable, { final }) {
    const chunks = [];
    let cursor = emitted;

    for (;;) {
      const remaining = speakable.slice(cursor);
      if (!remaining.trim()) break;

      /**
       * Accumulate WHOLE sentences until the chunk clears minChunkChars.
       *
       * The obvious implementation — find one sentence, bail if it is too short
       * — deadlocks the queue behind a short opener. "Ok. Here is the long
       * answer..." would emit nothing at all until the stream ended, because
       * every pass re-examines the same 3-character "Ok." and gives up. The
       * module's entire purpose is to speak before the answer is finished, so a
       * stall is not a minor inefficiency; it is total failure.
       *
       * minChunkChars means "do not emit a chunk smaller than this", and the
       * way to honour that is to MERGE forward, not to wait.
       */
      let take = -1;
      let scan = 0;
      for (;;) {
        const rel = findSentenceEnd(remaining, scan);
        if (rel === -1) break;
        take = rel;
        if (remaining.slice(0, rel).trim().length >= cfg.minChunkChars) break;
        scan = rel;
      }

      if (take !== -1) {
        const candidate = remaining.slice(0, take);
        // Still short and the stream is live: more text is coming that will
        // merge into this chunk, so wait for it.
        if (candidate.trim().length < cfg.minChunkChars && !final && remaining.length < cfg.maxChunkChars) break;
        chunks.push(candidate.trim());
        cursor += take;
        continue;
      }

      // No terminator. Break on a soft boundary once we exceed max length so a
      // run-on sentence still starts speaking.
      if (remaining.length >= cfg.maxChunkChars) {
        let cut = -1;
        for (const br of cfg.softBreaks) {
          const at = remaining.lastIndexOf(br, cfg.maxChunkChars);
          if (at > cut) cut = at + br.length;
        }
        if (cut <= 0) {
          const sp = remaining.lastIndexOf(' ', cfg.maxChunkChars);
          cut = sp > 0 ? sp + 1 : cfg.maxChunkChars;
        }
        chunks.push(remaining.slice(0, cut).trim());
        cursor += cut;
        continue;
      }

      if (final) {
        chunks.push(remaining.trim());
        cursor += remaining.length;
      }
      break;
    }

    emitted = cursor;
    return chunks.filter(Boolean);
  }

  return {
    /**
     * @param {string} accumulated  full accumulated assistant text so far
     * @returns {string[]} newly speakable chunks, in order
     */
    push(accumulated) {
      const speakable = stripUnspeakable(accumulated);

      /**
       * Stripping is not monotonic. A span that read as prose one delta ago can
       * collapse into a four-word note the moment its closing marker arrives,
       * so the speakable string SHRINKS and the old cursor points into text
       * that no longer exists.
       *
       * Rebase to the longest common prefix — the exact point where the two
       * versions diverge. Clamping to the new LENGTH instead (the obvious
       * one-liner) silently swallows every sentence after the collapse: the
       * cursor lands past real text that was never emitted, and `flush` has
       * nothing left to release. That drops the tail of the answer with no
       * error anywhere.
       */
      const prevEmitted = lastSpeakable.slice(0, emitted);
      if (!speakable.startsWith(prevEmitted)) {
        const max = Math.min(prevEmitted.length, speakable.length);
        let i = 0;
        while (i < max && prevEmitted[i] === speakable[i]) i += 1;
        emitted = i;
      }
      if (emitted > speakable.length) emitted = speakable.length;
      lastSpeakable = speakable;

      return takeChunks(speakable, { final: false });
    },

    /** Release whatever remains. Call once on `done`. */
    flush() {
      return takeChunks(lastSpeakable, { final: true });
    },

    reset() {
      emitted = 0;
      lastSpeakable = '';
    },

    /** The spoken-form text emitted so far — the basis for spoken-prefix truth. */
    get emittedText() {
      return lastSpeakable.slice(0, emitted);
    },
  };
}

export default { createSentenceChunker, stripUnspeakable, findSentenceEnd, DEFAULT_CHUNKER_CONFIG, VISUAL_SUBSTITUTIONS };
