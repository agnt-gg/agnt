/**
 * semanticEndpointer — decides WHEN a spoken turn is over.
 *
 * THE PROBLEM WITH A SILENCE TIMER
 * --------------------------------
 * Every assistant that feels like a menu uses one number: "700ms of silence =
 * you're done". That single number cannot be right, because the same pause
 * means opposite things depending on what was just said:
 *
 *   "what's the weather"        + 700ms → they're done. Waiting is dead air.
 *   "I want you to look at the" + 700ms → they're THINKING. Cutting in is rude
 *                                         and destroys the thought.
 *
 * Set it low and you interrupt people mid-sentence. Set it high and every
 * exchange has a beat of lag. There is no value that fixes both, which is why
 * this is the single highest-leverage component in the pipeline.
 *
 * THE FIX
 * -------
 * Look at WHAT was said, not just how long it's been quiet. The ASR partial is
 * scored for syntactic completeness, and that score picks the threshold:
 *
 *   COMPLETE     ("what's the weather")           → fast   (~180ms)
 *   NEUTRAL      (can't tell)                     → normal (~600ms)
 *   CONTINUING   ("look at the", "and then, uh")  → slow   (~1100ms)
 *
 * A hard ceiling (`maxWaitMs`) always fires regardless of classification, so a
 * trailing "umm..." cannot hold the turn open forever.
 *
 * WHY THIS IS SHALLOW ON PURPOSE
 * ------------------------------
 * The classifier is lexical — function-word tails, filled pauses, question
 * openers, punctuation from the ASR. Not a parser, not a model. It runs on
 * every ASR partial (many times a second) and must cost nothing. Its job is
 * only to pick between three timeouts; being wrong costs 400ms, not a turn.
 * The reopen window (see turnGate) is what makes a wrong guess recoverable.
 *
 * Pure and synchronous. No timers — the caller owns the clock and passes
 * `silenceMs`, which is what makes this replayable against recorded audio.
 */

export const Completeness = Object.freeze({
  COMPLETE: 'complete',
  NEUTRAL: 'neutral',
  CONTINUING: 'continuing',
});

export const DEFAULT_ENDPOINT_CONFIG = Object.freeze({
  completeMs: 180,
  neutralMs: 600,
  continuingMs: 1100,
  /** Absolute ceiling. Fires whatever the classification says. */
  maxWaitMs: 2000,
  /** Below this many characters the transcript is treated as too thin to
   *  classify — a single word is usually a fragment of something longer, but
   *  may also be a complete answer ("yes"), so it lands on NEUTRAL. */
  minCharsForComplete: 2,
});

/**
 * Words that cannot end an English sentence. If the transcript's last token is
 * one of these, the speaker is mid-thought — an article with no noun, a
 * preposition with no object, a conjunction with no second clause.
 */
const DANGLING_TOKENS = new Set([
  // articles & determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their', 'his', 'her', 'its',
  // prepositions
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'about', 'into', 'onto', 'over',
  'under', 'between', 'through', 'during', 'without', 'within', 'against', 'toward', 'towards',
  'across', 'behind', 'beyond', 'near', 'upon', 'via',
  // conjunctions
  'and', 'or', 'but', 'so', 'because', 'if', 'when', 'while', 'although', 'though', 'unless',
  'until', 'whereas', 'plus', 'nor', 'yet',
  // auxiliaries & copulas (a bare auxiliary has no main verb yet)
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must',
  // relative / interrogative pronouns mid-clause
  'which', 'who', 'whom', 'whose',
  // comparatives that demand a complement
  'than', 'as', 'like',
  // very common trailing verbs that take an object
  'want', 'need', 'make', 'let', 'get', 'put', 'give', 'take', 'try', 'use',
]);

/** Filled pauses. Their presence at the tail is the strongest "still thinking" signal there is. */
const FILLERS = new Set(['uh', 'um', 'umm', 'uhh', 'er', 'erm', 'hmm', 'hm', 'ah', 'eh', 'mm', 'mmm', 'like']);

/**
 * Pronouns are the one word class that is genuinely ambiguous at the tail:
 *
 *   "I fixed it"                → complete
 *   "the problem is that it"    → wide open
 *   "let me"                    → wide open
 *
 * The pronoun itself carries no signal; the word BEFORE it does. A pronoun
 * following a dangling function word (a complementizer, a conjunction, or a
 * verb still waiting for its object) is a subject or object with no clause
 * around it yet. Treating that as complete cuts the speaker off mid-thought,
 * which is the exact failure this module exists to prevent — so the bigram is
 * worth the extra rule.
 */
const PRONOUNS = new Set(['it', 'me', 'you', 'him', 'her', 'them', 'us', 'they', 'we', 'he', 'she', 'i', 'this', 'that']);

/** Openers that make a full question likely once a verb phrase has landed. */
const QUESTION_OPENERS = new Set(['what', 'where', 'when', 'why', 'how', 'who', 'which', 'is', 'are', 'can', 'could', 'do', 'does', 'did', 'should', 'would', 'will']);

/** Short utterances that are complete on their own. */
const STANDALONE = new Set([
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah', 'ok', 'okay', 'sure', 'stop', 'wait',
  'thanks', 'hi', 'hey', 'hello', 'go', 'done', 'right', 'correct', 'exactly', 'please',
]);

/** Strip ASR punctuation/casing down to comparable tokens. */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Classify how syntactically finished a transcript looks.
 * @param {string} transcript  latest ASR text for the current turn
 * @param {Partial<typeof DEFAULT_ENDPOINT_CONFIG>} [config]
 * @returns {{ completeness: string, reason: string, tokens: number }}
 */
export function classifyCompleteness(transcript, config = {}) {
  const cfg = { ...DEFAULT_ENDPOINT_CONFIG, ...config };
  const raw = String(transcript || '').trim();

  if (!raw) return { completeness: Completeness.NEUTRAL, reason: 'empty', tokens: 0 };

  const tokens = tokenize(raw);
  if (tokens.length === 0) return { completeness: Completeness.NEUTRAL, reason: 'no-tokens', tokens: 0 };

  const last = tokens[tokens.length - 1];

  // Filled pause at the tail beats everything — including terminal punctuation,
  // which ASR engines cheerfully hallucinate onto a trailing "um".
  if (FILLERS.has(last)) {
    return { completeness: Completeness.CONTINUING, reason: 'filler-tail', tokens: tokens.length };
  }

  // A trailing comma is the ASR telling us the clause continues.
  if (/[,;:\-—]$/.test(raw)) {
    return { completeness: Completeness.CONTINUING, reason: 'clause-punctuation', tokens: tokens.length };
  }

  // Dangling function word: article with no noun, preposition with no object.
  if (DANGLING_TOKENS.has(last)) {
    return { completeness: Completeness.CONTINUING, reason: 'dangling-token', tokens: tokens.length };
  }

  // Bare pronoun hanging off a dangling word — an open clause. See PRONOUNS.
  if (tokens.length >= 2 && PRONOUNS.has(last) && DANGLING_TOKENS.has(tokens[tokens.length - 2])) {
    return { completeness: Completeness.CONTINUING, reason: 'dangling-pronoun', tokens: tokens.length };
  }

  // Terminal punctuation from the ASR is a strong completeness signal.
  if (/[.!?]$/.test(raw)) {
    return { completeness: Completeness.COMPLETE, reason: 'terminal-punctuation', tokens: tokens.length };
  }

  // Single-token utterances: complete only if they stand alone by convention.
  if (tokens.length === 1) {
    if (STANDALONE.has(last)) {
      return { completeness: Completeness.COMPLETE, reason: 'standalone-word', tokens: 1 };
    }
    return { completeness: Completeness.NEUTRAL, reason: 'single-token', tokens: 1 };
  }

  if (raw.length < cfg.minCharsForComplete) {
    return { completeness: Completeness.NEUTRAL, reason: 'too-short', tokens: tokens.length };
  }

  // A wh-/aux- opener with enough material after it is very likely a whole
  // question, even without punctuation ("what's the weather in tokyo").
  if (QUESTION_OPENERS.has(tokens[0]) && tokens.length >= 3) {
    return { completeness: Completeness.COMPLETE, reason: 'question-form', tokens: tokens.length };
  }

  // Imperatives are how people talk to an assistant, and they rarely arrive
  // with punctuation ("open the repo", "run the tests"). A multi-token
  // utterance ending on a content word is a reasonable bet for complete.
  if (tokens.length >= 3) {
    return { completeness: Completeness.COMPLETE, reason: 'content-word-tail', tokens: tokens.length };
  }

  return { completeness: Completeness.NEUTRAL, reason: 'short-phrase', tokens: tokens.length };
}

/** The silence budget, in ms, for a given completeness class. */
export function thresholdFor(completeness, config = {}) {
  const cfg = { ...DEFAULT_ENDPOINT_CONFIG, ...config };
  if (completeness === Completeness.COMPLETE) return cfg.completeMs;
  if (completeness === Completeness.CONTINUING) return cfg.continuingMs;
  return cfg.neutralMs;
}

/**
 * Should the turn end right now?
 *
 * @param {{ transcript?: string, silenceMs?: number, hasSpeech?: boolean }} input
 *   `hasSpeech` guards the case where the mic opens into a silent room: without
 *   it, silenceMs climbs past every threshold and we would endpoint a turn that
 *   never began.
 * @param {Partial<typeof DEFAULT_ENDPOINT_CONFIG>} [config]
 * @returns {{ endpoint: boolean, completeness: string, reason: string, thresholdMs: number, silenceMs: number }}
 */
export function shouldEndpoint(input = {}, config = {}) {
  const cfg = { ...DEFAULT_ENDPOINT_CONFIG, ...config };
  const silenceMs = Number.isFinite(input.silenceMs) ? input.silenceMs : 0;
  const transcript = input.transcript || '';
  const hasSpeech = input.hasSpeech !== false;

  const { completeness, reason } = classifyCompleteness(transcript, cfg);
  const thresholdMs = thresholdFor(completeness, cfg);

  if (!hasSpeech) {
    return { endpoint: false, completeness, reason: 'no-speech-yet', thresholdMs, silenceMs };
  }

  if (silenceMs >= cfg.maxWaitMs) {
    return { endpoint: true, completeness, reason: 'max-wait', thresholdMs: cfg.maxWaitMs, silenceMs };
  }

  if (silenceMs >= thresholdMs) {
    return { endpoint: true, completeness, reason, thresholdMs, silenceMs };
  }

  return { endpoint: false, completeness, reason, thresholdMs, silenceMs };
}

export default { Completeness, classifyCompleteness, thresholdFor, shouldEndpoint, DEFAULT_ENDPOINT_CONFIG };
