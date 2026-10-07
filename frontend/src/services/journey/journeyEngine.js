/**
 * The journey's rules. Pure: every input is passed in, so each rule is tested
 * on its own (journeyEngine.spec.js) and the runtime (useJourney.js) is only
 * wiring.
 */
import { FACT_KEYS, JOURNEY_SCREEN, MILESTONES, MISSIONS } from './missions.js';

export function emptyFacts() {
  return Object.fromEntries(FACT_KEYS.map((key) => [key, 0]));
}

export function getMission(id) {
  return (id && MISSIONS[id]) || null;
}

/**
 * Whether one step's `until` holds.
 * @param {object|undefined} until
 * @param {object} ctx
 * @param {object} ctx.facts     current counts
 * @param {object} ctx.baseline  counts when the step began
 * @param {Set<string>} ctx.events  events seen since the step began
 * @param {object} ctx.flags     persisted choices
 * @param {Set<string>} ctx.clicks  selectors clicked since the step began
 * @param {string} [ctx.target]  the step's own target selector
 */
export function stepSatisfied(until, ctx) {
  if (!until || typeof until !== 'object') return false;
  if (Array.isArray(until.any)) return until.any.some((part) => stepSatisfied(part, ctx));
  if (Array.isArray(until.all)) return until.all.length > 0 && until.all.every((part) => stepSatisfied(part, ctx));
  if (until.grows) return (ctx.facts?.[until.grows] || 0) > (ctx.baseline?.[until.grows] || 0);
  if (until.fact) return (ctx.facts?.[until.fact] || 0) >= (until.atLeast ?? 1);
  if (until.event) return !!ctx.events?.has(until.event);
  if (until.flag) return !!ctx.flags?.[until.flag];
  if (until.click) return !!ctx.target && !!ctx.clicks?.has(ctx.target);
  if (until.clickOn) return !!ctx.clicks?.has(until.clickOn);
  return false;
}

/** Every selector whose click can complete this step: the runtime listens for these. */
export function clickSelectors(step) {
  const found = new Set();
  const walk = (until) => {
    if (!until || typeof until !== 'object') return;
    (until.any || until.all || []).forEach(walk);
    if (until.click && step?.target) found.add(step.target);
    if (until.clickOn) found.add(until.clickOn);
  };
  walk(step?.until);
  return [...found];
}

/** The checklist: each milestone with `done`, plus the counts and the next one to do. */
export function journeySummary(facts, flags = {}) {
  const items = MILESTONES.map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    outcome: milestone.outcome,
    mission: milestone.mission,
    done: !!milestone.isDone({ ...emptyFacts(), ...facts }, flags),
  }));
  const next = items.find((item) => !item.done) || null;
  return { items, done: items.filter((item) => item.done).length, total: items.length, next };
}

function milestoneDone(id, facts, flags) {
  const milestone = MILESTONES.find((candidate) => candidate.id === id);
  return !!milestone && !!milestone.isDone({ ...emptyFacts(), ...facts }, flags);
}

/**
 * The mission a page offers on a visit, or null. A mission is offered when it
 * is not finished, not turned down, and — for a journey mission — its
 * milestone is not already true of the account. The Dashboard offers the next
 * milestone, whatever page that is on.
 */
export function offerFor(screen, { facts, flags = {}, progress }) {
  if (!screen) return null;
  const open = (id) => !!MISSIONS[id] && !progress?.done?.[id] && !progress?.dismissed?.[id];
  if (screen === JOURNEY_SCREEN) {
    const next = journeySummary(facts, flags).next;
    return next && open(next.mission) ? next.mission : null;
  }
  for (const [id, mission] of Object.entries(MISSIONS)) {
    if (!mission.screens?.includes(screen) || !open(id)) continue;
    if (mission.milestone && milestoneDone(mission.milestone, facts, flags)) continue;
    return id;
  }
  return null;
}

/** After a mission finishes: the next unfinished milestone to point at, or null. */
export function nextMilestoneAfter(missionId, facts, flags = {}, progress = {}) {
  const summary = journeySummary(facts, flags);
  return (
    summary.items.find((item) => !item.done && item.mission !== missionId && !progress?.dismissed?.[item.mission]) || null
  );
}

/**
 * The selector for a visible instance of a step target. KeepAlive keeps hidden
 * copies of screens in the DOM, so "the first match" can be an invisible one.
 */
export function firstVisible(selector, root = typeof document === 'undefined' ? null : document) {
  if (!selector || !root) return null;
  let nodes;
  try {
    nodes = root.querySelectorAll(selector);
  } catch {
    return null; // an invalid selector is a missing target, not a crash
  }
  for (const node of nodes) {
    if (node.getClientRects().length === 0) continue;
    const style = typeof window === 'undefined' ? null : window.getComputedStyle(node);
    if (style && (style.visibility === 'hidden' || style.display === 'none')) continue;
    return node;
  }
  return null;
}
