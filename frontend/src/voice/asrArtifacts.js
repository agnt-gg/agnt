/**
 * asrArtifacts — strip Whisper's non-speech tokens from a transcript.
 *
 * Whisper does not return an empty string for silence. It emits a literal
 * annotation — [BLANK_AUDIO] is the famous one — and on breaths, hums and
 * room noise it produces [silence], (coughs), *sighs*, [Music], ♪, or a
 * hallucinated filler like a bare "you." / "Thank you." on near-empty audio.
 *
 * Left unfiltered, these commit as REAL MESSAGES: the assistant receives
 * "[BLANK_AUDIO]" and answers it. That is how a user who said nothing at all
 * watched a "blank audio" message get sent on their behalf.
 *
 * The filter is deliberately conservative: it removes only bracketed /
 * parenthesised / starred / music-note annotations, then asks whether any
 * actual speech remains. It never rewrites words the user might have said —
 * "open the [config] file" keeps its brackets' CONTENT loss acceptable
 * because ASR output never contains user-typed brackets; whisper brackets are
 * always annotations.
 */

/** Bracketed, parenthesised, starred, or music annotations, case-insensitive. */
const ANNOTATION = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+|♫+/g;

/**
 * Bare hallucinations whisper emits for near-silent audio when it produces no
 * annotation. Matched only as the ENTIRE utterance — "thank you" mid-sentence
 * is real speech.
 */
const WHOLE_UTTERANCE_HALLUCINATIONS = new Set(['you', 'thank you', 'thanks for watching', 'bye']);

/**
 * @param {string} transcript raw ASR output
 * @returns {string} the transcript with annotations removed; '' when nothing
 *   the user actually said remains.
 */
export function sanitizeTranscript(transcript) {
  const raw = String(transcript || '');
  const stripped = raw.replace(ANNOTATION, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return '';

  const normalized = stripped.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, '').trim();
  if (WHOLE_UTTERANCE_HALLUCINATIONS.has(normalized)) return '';

  return stripped;
}

/**
 * Non-lexical hesitation markers. NOT words — the sounds a throat makes while
 * a brain catches up, and the sounds an ASR model produces from a cough, a
 * chair creak or a doorway bump.
 *
 * WHAT IS DELIBERATELY NOT IN HERE, AND WHY
 * -----------------------------------------
 * Every entry below is a sound. The moment a real WORD goes in, this stops
 * being a noise filter and starts silently discarding turns:
 *
 *   hey, hi, hello   a greeting is a complete turn, and the realtime model is
 *                    explicitly instructed to send "hello" through rather than
 *                    decide it is beneath answering
 *   huh, what        a request to repeat — the user is asking for something
 *   oh, ah-ha        a reaction, and reactions are answerable
 *   ok, yeah, no     assent and refusal; "no" mid-run is a critical steer
 *   stop, wait       the most important thing a user can say
 *
 * The line is "is this a word", not "is this short" and not "is this useful".
 * Judging usefulness is exactly the judgement this system refuses to let the
 * voice model make, and it should not be smuggled in here either.
 */
const FILLERS = new Set([
  'um', 'umm', 'ummm', 'uhm', 'uhmm',
  'uh', 'uhh', 'uhhh',
  'er', 'err', 'erm', 'ermm',
  'hm', 'hmm', 'hmmm', 'hmmmm',
  'mm', 'mmm', 'mmmm',
  'ah', 'ahh', 'ahhh',
  'eh', 'ehh',
]);

/**
 * Does this utterance consist of nothing but hesitation sounds?
 *
 * Whole-utterance only: "um, check the build" is a request with a stumble in
 * front of it, and rejecting it would eat real work.
 *
 * @param {string} transcript  a transcript, already annotation-stripped
 * @returns {boolean}
 */
export function isFillerOnly(transcript) {
  const normalized = String(transcript || '')
    .toLowerCase()
    // Keep letters and apostrophes; drop the punctuation ASR adds around
    // fillers ("um," / "uh..." / "Hmm?").
    .replace(/[^\p{L}'\s]/gu, ' ')
    .trim();
  if (!normalized) return false; // empty is sanitizeTranscript's job, not this one

  return normalized.split(/\s+/).every((token) => FILLERS.has(token));
}

/**
 * Did the user actually take a turn?
 *
 * ONE ENTRY POINT ON PURPOSE. Both voice engines need this answer, and the
 * failure mode of two engines answering it separately is the one this codebase
 * keeps producing: the cascade called sanitizeTranscript and the realtime path
 * called nothing at all, so identical room noise was discarded on one engine
 * and submitted as a turn on the other.
 *
 * @param {string} transcript  raw ASR output
 * @returns {string} the cleaned transcript, or '' when the user said nothing
 */
export function meaningfulTranscript(transcript) {
  const clean = sanitizeTranscript(transcript);
  if (!clean) return '';
  return isFillerOnly(clean) ? '' : clean;
}

export default { sanitizeTranscript, isFillerOnly, meaningfulTranscript };
