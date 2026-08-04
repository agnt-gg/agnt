/**
 * voiceTurn — marks the single next orchestrator turn as one that will be
 * spoken aloud, so the backend can ask for a spoken register.
 *
 * WHY A ONE-SHOT FLAG AND NOT A MODE
 * ----------------------------------
 * "Is voice on?" is the wrong question. A user with a voice session open can
 * still type, and a typed turn is NOT spoken — the realtime model only speaks
 * what comes back from its own run_agnt call. Treating voice as a mode would
 * put a spoken register on typed answers, truncating them on screen for no
 * reason.
 *
 * So the unit is a TURN, not a session: the voice path arms exactly the turn it
 * is about to submit, and the store consumes it.
 *
 * WHY IT IS KEYED BY TEXT
 * -----------------------
 * A bare boolean leaks. If the submit it was armed for never happens (empty
 * input, a disabled composer), the flag survives and the user's next TYPED
 * message silently becomes a voice turn. Keying on the exact instruction means
 * only the intended send can consume it, and anything else leaves it alone —
 * so a missed submit costs nothing rather than mislabelling a later turn.
 *
 * Not a store module on purpose: this is a handoff between two callers one
 * dispatch apart, with no UI reading it and nothing to persist.
 */

/** The instruction armed for the next send, or null. */
let armed = null;

/**
 * Mark the turn carrying exactly `instruction` as spoken.
 * Re-arming replaces the previous arm — the newer send is the real one.
 */
export function armVoiceTurn(instruction) {
  const text = typeof instruction === 'string' ? instruction.trim() : '';
  armed = text || null;
}

/**
 * Is THIS send the armed turn? Consumes the arm when it matches, so a turn is
 * never counted twice and a retry of the same text is not silently spoken.
 *
 * @param {string} userInput the text actually being sent
 * @returns {boolean}
 */
export function consumeVoiceTurn(userInput) {
  if (!armed) return false;
  const text = typeof userInput === 'string' ? userInput.trim() : '';
  if (!text || text !== armed) return false;
  armed = null;
  return true;
}

/** Drop any pending arm — the session ended before its turn was sent. */
export function clearVoiceTurn() {
  armed = null;
}

export default { armVoiceTurn, consumeVoiceTurn, clearVoiceTurn };
