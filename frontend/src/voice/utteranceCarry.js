/**
 * utteranceCarry — words the user said that never reached the orchestrator.
 *
 * THE LOSS THIS PREVENTS
 * ----------------------
 * A long spoken turn with a thinking pause in it:
 *
 *   "look at the voice system, it keeps..."  <pause>  "...dropping my words"
 *
 * The pause outlasts semantic VAD, so the server commits the first half and
 * opens a response that starts writing run_agnt("look at the voice system…").
 * The user resumes, the server CANCELS that response, and the bridge — which
 * must never run a cancelled call (see realtimeBridge, the repeat bug) —
 * drops it. The model then quotes only the second half, because it is told to
 * deliver exactly what was just said. The first half was heard by nobody.
 *
 * Not running a cancelled call is right. Forgetting its words is not. So the
 * words are carried, and prepended to the next utterance that IS delivered —
 * one message, in the order spoken.
 *
 * Pure and synchronous: the runtime owns the state, this owns the rules.
 */

/** Lowercase word tokens, punctuation and ASR casing stripped. */
function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does `text` already contain `part`?
 *
 * Token coverage rather than substring: the model re-transcribes the audio
 * when it quotes it again, so "look at the voice system, it keeps" may come
 * back as "Look at the voice system it keeps". Exact matching would call that
 * new and duplicate the whole first half in the chat. 80% of the part's words
 * present is "the model already included it".
 */
export function covers(text, part, threshold = 0.8) {
  const need = tokens(part);
  if (need.length === 0) return true;
  const have = new Set(tokens(text));
  const hits = need.filter((t) => have.has(t)).length;
  return hits / need.length >= threshold;
}

/**
 * Words from a cancelled call worth carrying, or '' when they are not.
 *
 * A cancelled call that only repeats what was ALREADY delivered is the old
 * repeat bug (a narration response re-issuing the last utterance), not lost
 * speech — carrying it would post the user's previous message twice.
 */
export function carryable(cancelledText, lastDelivered) {
  const text = String(cancelledText || '').trim();
  if (!text) return '';
  if (lastDelivered && covers(lastDelivered, text)) return '';
  return text;
}

/** Append a newly-cancelled fragment to what is already carried. */
export function appendCarry(carried, fragment) {
  const next = String(fragment || '').trim();
  if (!next) return carried || '';
  if (!carried) return next;
  // A second cancel of the same half (VAD retriggered) must not double it.
  if (covers(carried, next)) return carried;
  if (covers(next, carried)) return next;
  return `${carried} ${next}`;
}

/**
 * The message to deliver: carried words first, then the new utterance —
 * unless the model already folded the carried words into it.
 */
export function mergeCarry(carried, utterance) {
  const said = String(utterance || '').trim();
  const held = String(carried || '').trim();
  if (!held) return said;
  if (!said) return held;
  if (covers(said, held)) return said;
  return `${held} ${said}`;
}
