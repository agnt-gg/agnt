/**
 * voiceFloor — exactly one live voice session in the whole app.
 *
 * WHY THIS CANNOT LIVE IN A COMPONENT
 * -----------------------------------
 * Every chat surface owns its own voice session, and each one ends that
 * session when ITS OWN conversation changes (`epoch`). That is correct and it
 * is not enough, because the question that actually matters — "is another
 * surface already listening?" — is one no component can answer about itself.
 *
 * It bit exactly as you would predict. Terminal.vue caches screens in
 * <KeepAlive>, and panel chats stay mounted behind whatever is on top, so
 * several hosts are alive at once. Start voice in one chat, move to another,
 * start voice there, and both sessions were listening to the same microphone:
 * the utterance was committed into two conversations and both answers were
 * spoken over each other.
 *
 * The microphone is a singleton, and so is the person talking into it. A voice
 * session therefore has to be a singleton too, and the only place that fact
 * can be enforced is above all of the hosts.
 *
 * WHY EVICT RATHER THAN REFUSE
 * ----------------------------
 * The user pressing the voice button in a chat they are looking at has stated
 * their intent unambiguously. Refusing the claim would mean the button does
 * nothing until they remember which other chat left a session running — which
 * they cannot see. So the newest claim always wins and the previous holder is
 * ended for them.
 *
 * A TICKET, NOT A BOOLEAN
 * -----------------------
 * Release is keyed on the ticket that claimed the floor, and THAT COMPARISON
 * is the mechanism. Eviction runs the old holder's stop, which releases in
 * turn: a bare `holder = null` there would hand the floor back while the new
 * session is live, so the next claim would find nobody to evict and two
 * sessions would be listening again. Comparing tickets makes a late release
 * from a dead session the no-op it should be.
 *
 * (Installing the new holder BEFORE running the eviction is belt to that
 * braces, not the protection itself — a negative control proved the ticket
 * comparison alone is sufficient on every reachable path. It is kept because
 * it costs nothing and keeps `holder` naming the newest claim at every
 * instant, including inside a stop handler.)
 */

/** @type {{ ticket: number, stop: () => void } | null} */
let holder = null;
let nextTicket = 1;

/**
 * Take the floor for a session that is about to open the microphone.
 *
 * The previous holder is stopped. Call this BEFORE opening a mic, so two
 * sessions never overlap even for the length of a handshake.
 *
 * @param {() => void} stop ends the claiming session
 * @returns {number} the ticket to release with
 */
export function claimVoiceFloor(stop) {
  const previous = holder;
  const ticket = nextTicket++;
  // Installed before the eviction runs: the outgoing session's stop() calls
  // releaseVoiceFloor with ITS ticket, which must not clear the new holder.
  holder = { ticket, stop: typeof stop === 'function' ? stop : () => {} };
  if (previous) {
    try {
      previous.stop();
    } catch {
      /* a host that fails to stop must not stop the new session starting */
    }
  }
  return ticket;
}

/** Give up the floor, if this ticket still holds it. */
export function releaseVoiceFloor(ticket) {
  if (holder && holder.ticket === ticket) holder = null;
}

/** Ticket currently holding the floor, or null. Test/diagnostic seam. */
export function voiceFloorTicket() {
  return holder ? holder.ticket : null;
}

export default { claimVoiceFloor, releaseVoiceFloor, voiceFloorTicket };
