/**
 * voiceReplyPolicy — which part of the answer is the SPOKEN one.
 *
 * The prompt side of this lives in the backend
 * (system-prompts/voiceRegister.js): on a voice turn the assistant is asked to
 * open with the finding in as few sentences as it takes, then leave a blank
 * line, then write the detail for the screen. This module is the reader of
 * that convention.
 *
 * WHY A BLANK LINE AND NOT A MARKER
 * ---------------------------------
 * The spoken register is the answer's opening paragraph — not a tagged block,
 * not a separate field. Nothing has to be stripped before the chat renders, no
 * marker can leak into the transcript, and the spoken text is a literal PREFIX
 * of the written text. That last property is the valuable one: "the voice and
 * the screen must never contradict" then holds by construction instead of by
 * good behaviour.
 *
 * STREAMING SAFETY
 * ----------------
 * This is called repeatedly on a growing string. Before the blank line arrives
 * the whole answer looks like the opening paragraph, and the result grows with
 * it; the moment the blank line lands the result STOPS growing and is fixed
 * forever after. Feeding that into sentenceChunker means the voice speaks the
 * lead as it streams and then falls silent for the detail, with no
 * coordination between the two.
 */

/**
 * The part of an answer that should be spoken: everything up to the first
 * blank line.
 *
 * A single-paragraph answer is returned whole — which is correct, because an
 * answer with no detail section is one that was short enough to say.
 *
 * @param {string} text  the assistant's answer, possibly still streaming
 * @returns {string}
 */
export function spokenRegister(text) {
  const raw = String(text || '');
  if (!raw) return '';

  // \n\s*\n rather than a literal \n\n: a "blank" line commonly carries
  // trailing spaces, and treating that as ordinary text would hand the entire
  // answer to the voice — the exact failure this exists to prevent.
  const boundary = raw.search(/\n[ \t]*\n/);
  return boundary === -1 ? raw : raw.slice(0, boundary);
}

/**
 * Has the spoken register been fully received? Once true, `spokenRegister`
 * will never return anything longer for this answer.
 */
export function spokenRegisterComplete(text) {
  return /\n[ \t]*\n/.test(String(text || ''));
}

export const DEFAULT_VOICE_POLICY = Object.freeze({
  /** Spoken registers longer than this suggest the convention was ignored. */
  maxWords: 60,
});

/**
 * Diagnostic only: is this spoken register long enough to be worth flagging?
 *
 * Deliberately NOT enforced. Truncating a reply after the fact produces a
 * sentence that stops mid-thought, which is worse than one that runs long; the
 * length belongs to whoever wrote the answer, and the prompt is where that is
 * asked for.
 */
export function assessSpokenLength(text, policy = {}) {
  const p = { ...DEFAULT_VOICE_POLICY, ...policy };
  const clean = String(text || '').trim();
  if (!clean) return { words: 0, tooLong: false };
  const words = clean.split(/\s+/).filter(Boolean).length;
  return { words, tooLong: words > p.maxWords };
}

export default { spokenRegister, spokenRegisterComplete, assessSpokenLength, DEFAULT_VOICE_POLICY };
