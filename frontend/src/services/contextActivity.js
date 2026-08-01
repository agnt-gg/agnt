/**
 * Has this conversation produced anything the Context & Cost panel can report?
 *
 * The trap this exists to close: a model's context window is known the moment a
 * model is selected, so `tokenLimit` is populated on a brand-new chat that has
 * never sent a request. Gating the panel on it made an empty conversation
 * announce "0% full · 0 / 1.0M" over an empty transcript — a measurement of
 * nothing, presented as a measurement.
 *
 * Only evidence that a request actually happened counts. Every signal here is
 * something the backend reports after the fact; none of them can be true before
 * the user sends their first message, and all of them are reset when a new
 * conversation starts.
 *
 * @param {object} s
 * @param {object} [s.contextStatus]    latest context_status payload
 * @param {object} [s.totalTokenUsage]  accumulated usage for the conversation
 * @param {number} [s.totalCost]        accumulated billed cost
 * @param {number} [s.executionsCount]  turns billed so far
 * @param {Array}  [s.rounds]           requests in the turn currently in flight
 * @returns {boolean}
 */
export function hasContextActivity(s = {}) {
  const cs = s.contextStatus || {};
  const usage = s.totalTokenUsage || {};
  const num = (v) => (Number(v) || 0);

  return num(cs.currentTokens) > 0
    || num(cs.messagesCount) > 0
    || num(s.totalCost) > 0
    || num(s.executionsCount) > 0
    || (Array.isArray(s.rounds) && s.rounds.length > 0)
    || num(usage.inputTokens) > 0
    || num(usage.outputTokens) > 0;
}

export default hasContextActivity;
