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

export default { sanitizeTranscript };
