/**
 * Per-turn request tracking for the Context & Cost panel.
 *
 * A "turn" is one thing the user asked for; a "round" is one HTTP request to
 * the provider. A turn that calls six tools sends seven requests, each one
 * re-sending the entire context, and the last is usually the expensive one.
 * The panel used to show a single aggregate, which hid that entirely.
 *
 * This lives outside Chat.vue because it is a pure reducer over the
 * context_status stream, and a 2,900-line switch statement is not a place
 * where logic can be verified.
 */

/**
 * Fold one `context_status` event into a conversation's monitoring state.
 *
 * The backend numbers rounds explicitly (round 1 is the first call of a turn,
 * every later round is a tool-loop iteration). Deriving that frontend-side —
 * by watching for message-count resets, say — would be guesswork; the
 * orchestrator is the only place that knows where a turn begins.
 *
 * Mutates `ms` in place, matching how every other case in the event switch
 * updates the reactive monitoring slot.
 *
 * @param {object} ms   monitoring state slot
 * @param {object} data the context_status payload
 */
export function applyContextStatusRound(ms, data) {
  if (!ms || !data) return;

  // Older backends (and any replayed event) omit `round`. Treating a missing
  // round as 1 degrades to exactly the previous behaviour — one round per turn
  // — rather than dropping the event.
  const round = Math.max(1, Math.floor(Number(data.round) || 1));

  if (round === 1) {
    // Growth is measured between the START of consecutive turns. Averaging
    // total tokens over turn count would understate a conversation that only
    // recently began growing fast, which is precisely when the forecast matters.
    if (ms.prevTurnStartTokens != null) {
      ms.growthPerTurn = Math.max(0, (data.currentTokens || 0) - ms.prevTurnStartTokens);
    }
    ms.prevTurnStartTokens = data.currentTokens || 0;
    ms.turnRounds = [];
  }

  if (!Array.isArray(ms.turnRounds)) ms.turnRounds = [];

  ms.turnRounds[round - 1] = {
    round,
    tokens: data.currentTokens || 0,
    limit: data.tokenLimit || 0,
    // Set later by the manifest, which is what actually detects a break.
    prefixBroke: ms.turnRounds[round - 1]?.prefixBroke || false,
  };
}

/**
 * Record a broken cache prefix on the round where it happened.
 *
 * Prefix stability is established at the start of a turn and the manifest that
 * detects it is built during round 1, so round 1 is where the break belongs.
 * It is never inferred onto a later round — a mark on the wrong request would
 * send someone looking for a cause that was not there.
 *
 * @param {object} ms
 * @param {object} manifest the context_manifest payload
 */
export function markPrefixBreak(ms, manifest) {
  if (!ms || manifest?.cache?.prefixStable !== false) return;
  if (Array.isArray(ms.turnRounds) && ms.turnRounds[0]) {
    ms.turnRounds[0].prefixBroke = true;
  }
}
