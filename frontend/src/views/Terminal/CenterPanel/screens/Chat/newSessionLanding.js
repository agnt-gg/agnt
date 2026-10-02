/**
 * When must the kept-alive Chat screen re-land after the session changed?
 *
 * Exactly once per session that STARTS after one ENDED in this tab: sign-out
 * then sign-in, or signing straight in as another account (a new token drops
 * the session to 'unknown' before it is verified 'valid' again). Not on the
 * first verification at boot (unknown -> valid), which the screen's own cold
 * start already handles, and not on a blip that never left 'valid'.
 *
 * @param {() => unknown} land  what to do when a new session is ready
 * @returns {(next: string, prev: string) => unknown} a sessionState watcher
 */
export function createNewSessionLanding(land) {
  let sessionEndedSinceLanding = false;
  return (next, prev) => {
    if (prev === 'valid' && next !== 'valid') {
      sessionEndedSinceLanding = true;
      return undefined;
    }
    if (next !== 'valid' || !sessionEndedSinceLanding) return undefined;
    sessionEndedSinceLanding = false;
    return land();
  };
}
