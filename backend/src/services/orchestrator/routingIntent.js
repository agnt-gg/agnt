/**
 * routingIntent.js — what a turn NEEDS, derived from where it came from.
 *
 * Every published LLM router predicts DIFFICULTY from the prompt text with a
 * trained classifier. RouterArena (ICLR 2026) measured twelve of them and all
 * twelve lose to the oracle, almost entirely by over-escalating: they learned
 * "use the big model to be safe", because escalating is invisible and
 * under-routing is embarrassing.
 *
 * This module deliberately predicts nothing. Two facts that matter more than
 * difficulty are already known for free at the call site:
 *
 *   STAKE — what a wrong answer costs. Only the APPLICATION can know this. A
 *     conversation-title generation and a goal evaluation are the same string
 *     length and the same "difficulty"; one of them is worth $0.0001 of
 *     compute and the other gates whether work is accepted. `origin` already
 *     carries this distinction and has since the ledger was built.
 *
 *   VERIFIABILITY — how cheaply the answer can be checked. This decides the
 *     STRATEGY, not the model: when an oracle is nearly free (code that
 *     compiles, JSON that parses, a tool call that errors), you should cascade
 *     and pay for OBSERVED failure. Only when verification is expensive are
 *     you forced to predict. The literature treats cascade-vs-classify as a
 *     fixed architectural commitment; it is a per-turn decision, and this is
 *     the input to it.
 *
 * No text is inspected. Nothing is trained. Nothing rots when a model ships.
 *
 * Pure and dependency-free.
 */

/**
 * Stake multiplier applied to predicted quality in the objective function.
 *
 * Calibrated so 'low' cannot by itself justify a frontier model and 'high'
 * cannot by itself justify a broken one. These are weights on quality, not
 * overrides of eligibility — a model that cannot do the job is removed before
 * scoring ever runs.
 */
export const STAKE_WEIGHTS = Object.freeze({ low: 0.4, normal: 1.0, high: 1.8 });

export const STAKES = Object.freeze(['low', 'normal', 'high']);
export const VERIFIABILITIES = Object.freeze(['mechanical', 'referential', 'subjective']);

/**
 * origin → stake. Origins come from LlmCallModel.ORIGINS.
 *
 * The interesting rows are the background ones. `insight` and `system` run
 * with no user waiting and no user-visible artifact, so their quality bar is
 * "did it produce something usable", not "is this the best answer available" —
 * yet they inherit the account default provider today, which means they have
 * been running at frontier prices by accident. That is the single largest
 * unclaimed saving in the product and it needs no classifier to collect.
 *
 * `goal_eval` is the mirror image: it decides whether other work passes, so it
 * must never be routed down to save money. Being wrong there silently corrupts
 * every downstream judgement.
 */
const ORIGIN_STAKE = Object.freeze({
  insight: 'low',
  system: 'low',
  goal_eval: 'high',
  goal_task: 'high',
  workflow_node: 'normal',
  workflow: 'normal',
  orchestrator: 'normal',
  agent: 'normal',
  tool: 'normal',
  widget: 'normal',
  goal: 'normal',
  artifact: 'normal',
  chat: 'normal',
});

/**
 * origin → verifiability.
 *
 * 'mechanical' is claimed only where a failure is genuinely observable without
 * a second model's opinion: a workflow node throws, a tool call returns an
 * error, generated code fails to parse. Claiming it anywhere else would make
 * the cascade escalate on nothing and quietly become a "always use the cheap
 * model" policy, which is the failure mode in the opposite direction.
 */
const ORIGIN_VERIFIABILITY = Object.freeze({
  workflow_node: 'mechanical',
  workflow: 'mechanical',
  tool: 'mechanical',
  widget: 'mechanical',
  goal_eval: 'referential',
  goal_task: 'referential',
  insight: 'subjective',
  system: 'subjective',
  orchestrator: 'subjective',
  agent: 'subjective',
  goal: 'subjective',
  artifact: 'subjective',
  chat: 'subjective',
});

/**
 * Classify a turn.
 *
 * Everything is optional and every unknown falls to the SAFE side (normal
 * stake, subjective verifiability) — an unrecognised origin must never be
 * treated as cheap-and-checkable, because that combination is the one that
 * routes work down without anything noticing.
 *
 * @param {object} args
 * @param {string} [args.origin]          LlmCallModel origin for this turn
 * @param {boolean} [args.hasImages]      turn carries image content
 * @param {boolean} [args.hasTools]       tool schemas are bound to this turn
 * @param {number} [args.contextTokens]   estimated prompt size
 * @param {boolean} [args.isToolRound]    a follow-up round inside a turn
 * @param {boolean} [args.reasoningWanted] user asked for extended thinking
 * @returns {{stake:string, stakeWeight:number, verifiability:string,
 *            needsVision:boolean, needsTools:boolean, contextTokens:number,
 *            reasoningWanted:boolean}}
 */
export function classifyIntent({
  origin,
  hasImages = false,
  hasTools = false,
  contextTokens = 0,
  isToolRound = false,
  reasoningWanted = false,
} = {}) {
  const key = String(origin || '').trim().toLowerCase();

  let stake = ORIGIN_STAKE[key] || 'normal';
  let verifiability = ORIGIN_VERIFIABILITY[key] || 'subjective';

  // A tool round is checkable by construction: the tool either accepted the
  // arguments or returned an error. That is a real oracle, so the round can
  // cascade even when the surface it belongs to cannot.
  if (isToolRound && verifiability === 'subjective') verifiability = 'mechanical';

  // Asking for extended thinking is an explicit statement that this answer
  // matters. Honour it rather than second-guessing it — but never downgrade,
  // so a low-stake background job that happens to enable reasoning does not
  // get promoted past a user-facing turn.
  if (reasoningWanted && stake === 'normal') stake = 'high';

  return {
    stake,
    stakeWeight: STAKE_WEIGHTS[stake],
    verifiability,
    needsVision: !!hasImages,
    needsTools: !!hasTools,
    contextTokens: Number.isFinite(contextTokens) && contextTokens > 0 ? contextTokens : 0,
    reasoningWanted: !!reasoningWanted,
  };
}

export default { STAKE_WEIGHTS, STAKES, VERIFIABILITIES, classifyIntent };
