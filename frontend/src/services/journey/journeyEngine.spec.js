import { describe, expect, it } from 'vitest';
import { clickSelectors, emptyFacts, journeySummary, nextMilestoneAfter, offerFor, stepSatisfied } from './journeyEngine.js';
import { MILESTONES } from './missions.js';

const facts = (overrides = {}) => ({ ...emptyFacts(), ...overrides });
const ctx = (overrides = {}) => ({
  facts: facts(),
  baseline: facts(),
  events: new Set(),
  clicks: new Set(),
  flags: {},
  ...overrides,
});
const progress = (overrides = {}) => ({ done: {}, dismissed: {}, flags: {}, ...overrides });

describe('stepSatisfied', () => {
  it('a manual step (no until) is never satisfied by itself', () => {
    expect(stepSatisfied(undefined, ctx())).toBe(false);
  });

  it('grows: only a count ABOVE the step-start baseline counts', () => {
    // An account that already had 3 agents has not made one during this step.
    expect(stepSatisfied({ grows: 'agents' }, ctx({ facts: facts({ agents: 3 }), baseline: facts({ agents: 3 }) }))).toBe(false);
    expect(stepSatisfied({ grows: 'agents' }, ctx({ facts: facts({ agents: 4 }), baseline: facts({ agents: 3 }) }))).toBe(true);
  });

  it('event, flag and fact thresholds', () => {
    expect(stepSatisfied({ event: 'chat.sent' }, ctx({ events: new Set(['chat.sent']) }))).toBe(true);
    expect(stepSatisfied({ event: 'chat.sent' }, ctx())).toBe(false);
    expect(stepSatisfied({ flag: 'modelChosen' }, ctx({ flags: { modelChosen: true } }))).toBe(true);
    expect(stepSatisfied({ fact: 'apps', atLeast: 2 }, ctx({ facts: facts({ apps: 1 }) }))).toBe(false);
    expect(stepSatisfied({ fact: 'apps' }, ctx({ facts: facts({ apps: 1 }) }))).toBe(true);
  });

  it('click: on the step target, or on a named selector', () => {
    const clicks = new Set(['#save-workflow']);
    expect(stepSatisfied({ click: true }, ctx({ clicks, target: '#save-workflow' }))).toBe(true);
    expect(stepSatisfied({ click: true }, ctx({ clicks, target: '#other' }))).toBe(false);
    expect(stepSatisfied({ click: true }, ctx({ clicks }))).toBe(false); // no target, nothing to click
    expect(stepSatisfied({ clickOn: '#save-workflow' }, ctx({ clicks }))).toBe(true);
  });

  it('any / all compose', () => {
    const c = ctx({ events: new Set(['chat.sent']) });
    expect(stepSatisfied({ any: [{ flag: 'x' }, { event: 'chat.sent' }] }, c)).toBe(true);
    expect(stepSatisfied({ all: [{ flag: 'x' }, { event: 'chat.sent' }] }, c)).toBe(false);
    expect(stepSatisfied({ all: [] }, c)).toBe(false); // vacuous truth would skip the step
  });
});

describe('clickSelectors', () => {
  it('collects the target (for click) and every clickOn, nested', () => {
    const step = { target: '#t', until: { any: [{ click: true }, { all: [{ clickOn: '#a' }] }, { grows: 'x' }] } };
    expect(clickSelectors(step).sort()).toEqual(['#a', '#t']);
    expect(clickSelectors({ until: { click: true } })).toEqual([]);
  });
});

describe('journeySummary', () => {
  it('an empty account is at the first milestone', () => {
    const summary = journeySummary(facts());
    expect(summary.done).toBe(0);
    expect(summary.total).toBe(MILESTONES.length);
    expect(summary.next.id).toBe('model');
  });

  it('done comes from account state, so work done elsewhere counts', () => {
    const summary = journeySummary(facts({ aiModels: 1, chats: 4, workflows: 2, executions: 9 }));
    expect(summary.items.filter((i) => i.done).map((i) => i.id)).toEqual(['model', 'chat', 'workflow', 'run']);
    expect(summary.next.id).toBe('apps');
  });

  it('a recorded choice counts: keeping AGNT Flash is choosing a model', () => {
    expect(journeySummary(facts(), { modelChosen: true }).next.id).toBe('chat');
  });
});

describe('offerFor', () => {
  it('offers the page mission for an outcome the account has not reached', () => {
    expect(offerFor('AgentsScreen', { facts: facts(), progress: progress() })).toBe('first-agent');
  });

  it('never offers what the account already has', () => {
    expect(offerFor('AgentsScreen', { facts: facts({ agents: 1 }), progress: progress() })).toBeNull();
  });

  it('never re-offers a finished or turned-down mission', () => {
    expect(offerFor('AgentsScreen', { facts: facts(), progress: progress({ done: { 'first-agent': true } }) })).toBeNull();
    expect(offerFor('AgentsScreen', { facts: facts(), progress: progress({ dismissed: { 'first-agent': true } }) })).toBeNull();
  });

  it('page missions with no milestone are offered until done', () => {
    expect(offerFor('ToolsScreen', { facts: facts({ tools: 5 }), progress: progress() })).toBe('build-tool');
  });

  it('the Dashboard offers the next milestone, wherever it lives', () => {
    expect(offerFor('DashboardScreen', { facts: facts({ aiModels: 1, chats: 1 }), progress: progress() })).toBe('connect-app');
    expect(offerFor('DashboardScreen', { facts: facts({ aiModels: 1, chats: 1 }), progress: progress({ dismissed: { 'connect-app': true } }) })).toBeNull();
  });

  it('a page with no mission offers nothing', () => {
    expect(offerFor('BallJumperScreen', { facts: facts(), progress: progress() })).toBeNull();
    expect(offerFor(null, { facts: facts(), progress: progress() })).toBeNull();
  });
});

describe('nextMilestoneAfter', () => {
  it('points at the next unfinished milestone, skipping the one just done and any turned down', () => {
    // chats is still 0 when the mission completes (the count lags the send):
    // the milestone just finished must not be offered straight back.
    expect(nextMilestoneAfter('first-chat', facts({ aiModels: 1 }), {}, progress()).id).toBe('apps');
    expect(nextMilestoneAfter('first-chat', facts({ aiModels: 1 }), {}, progress({ dismissed: { 'connect-app': true } })).id).toBe('agent');
  });

  it('returns null when nothing is left', () => {
    const all = facts({ aiModels: 1, chats: 1, apps: 1, agents: 1, workflows: 1, executions: 1, goals: 1, skills: 1 });
    expect(nextMilestoneAfter('first-skill', all)).toBeNull();
  });
});
