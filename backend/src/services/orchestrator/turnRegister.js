/**
 * turnRegister — how a spoken or texted turn is marked, without touching the
 * system prompt.
 *
 * WHY NOT A SYSTEM-PROMPT SECTION
 * -------------------------------
 * Voice and text-message are properties of ONE turn, and the system prompt is
 * the cached prefix of EVERY turn. Appending a section to it on voice turns
 * only (even at the tail) changes the system block between a typed turn and a
 * spoken one; Anthropic caches the system as one block, so that miss re-writes
 * the system AND the entire message history at cache-write price. Measured
 * 2026-10-06: a dictated reply in a long conversation re-wrote 320k tokens.
 *
 * THE RULE
 * --------
 * The register guidance lives in the system prompt UNCONDITIONALLY (it never
 * changes), and the per-turn fact rides on the user message it belongs to, as
 * a fixed marker line in front of the user's words:
 *
 *   [VOICE TURN]\n\n<what the user said>
 *
 * The marked message is stored in the server transcript exactly as sent, and
 * historyRehydration restores it on later turns (the client only has the
 * user's own words), so every later request replays the same bytes. This is
 * the same mechanism the [ATTACHED FILES] block already uses.
 */

/** Marks a turn whose answer is spoken aloud as well as shown. */
export const VOICE_TURN_MARKER = '[VOICE TURN]';
/** Marks a turn that arrived, and is answered, as a text message. */
export const TEXT_TURN_MARKER = '[TEXT MESSAGE TURN]';
/** Every marker, for the rehydration aligner. */
export const TURN_MARKERS = Object.freeze([VOICE_TURN_MARKER, TEXT_TURN_MARKER]);

/** Multipart bodies carry booleans as strings; 'false' is not a voice turn. */
function isOn(flag) {
  return flag === true || flag === 'true';
}

/** The marker lines for this turn, in a fixed order, or '' for a plain typed turn. */
export function turnMarkerPrefix({ voiceMode, textMode } = {}) {
  const markers = [];
  if (isOn(voiceMode)) markers.push(VOICE_TURN_MARKER);
  if (isOn(textMode)) markers.push(TEXT_TURN_MARKER);
  return markers.length ? `${markers.join('\n')}\n\n` : '';
}

/**
 * The user message content with this turn's markers in front, or the content
 * unchanged for a typed turn.
 *
 * Only string content is marked. historyRehydration can restore a marked
 * string on later turns; a marked block array it could not, and the next turn
 * would re-write the cache from that message on. Every client sends string
 * user content, so this only guards a shape that does not occur today. An
 * empty message is left alone for the same reason: the aligner never restores
 * one.
 */
export function markTurnContent(content, flags) {
  const prefix = turnMarkerPrefix(flags);
  if (!prefix || typeof content !== 'string' || content === '') return content;
  return `${prefix}${content}`;
}

export default { VOICE_TURN_MARKER, TEXT_TURN_MARKER, TURN_MARKERS, turnMarkerPrefix, markTurnContent };
