import { describe, it, expect } from 'vitest';
import { teamLocation, teamQuery, initials, toPeople, nameOf, mentionsIn, mentionRuns, ago, filterTasks, unreadCount, pendingApprovals, inboxSentence, runTone, runStats, blockingRun, sparkPath, visibleToOptions, homeSpaceOf, PRIVATE_SCOPE } from './teamModel.js';

describe('visible to', () => {
  const spaces = [{ id: 'ws-sales', name: 'Sales' }, { id: 'ws-gen', name: 'General', is_default: true }, { id: 'ws-x', name: 'Labs', emoji: '🧪' }];
  it('lists every teamspace, with Only you first only when asked', () => {
    expect(visibleToOptions(spaces)).toEqual([
      { value: 'ws-sales', label: '💼 Sales' }, { value: 'ws-gen', label: '💬 General' }, { value: 'ws-x', label: '🧪 Labs' },
    ]);
    expect(visibleToOptions(spaces, { includePrivate: true, privateLabel: 'Only you (My Space)' })[0]).toEqual({ value: PRIVATE_SCOPE, label: 'Only you (My Space)' });
    expect(visibleToOptions()).toEqual([]);
  });
  it('the private value can never collide with a teamspace, and My Space is the default teamspace', () => {
    expect(spaces.map((s) => s.id)).not.toContain(PRIVATE_SCOPE);
    expect(homeSpaceOf(spaces).id).toBe('ws-gen');
    expect(homeSpaceOf([{ id: 'only' }]).id).toBe('only');
    expect(homeSpaceOf([])).toBeNull();
  });
});

describe('team location ↔ query', () => {
  it('round-trips every view', () => {
    for (const loc of [
      { view: 'home' },
      { view: 'inbox' },
      { view: 'mine' },
      { view: 'space', space: 'ws-1', tab: 'board', task: 't-9' },
      { view: 'space', space: 'ws-1', tab: 'chat' },
      { view: 'doc', space: 'ws-1', doc: 'd-1' },
    ]) {
      const back = teamLocation(teamQuery(loc));
      expect(back).toMatchObject({ ...loc, tab: loc.tab || 'chat' });
    }
  });
  it('falls back instead of trusting a crafted URL', () => {
    expect(teamLocation({ view: 'evil', tab: '<script>', space: '../../x', task: 'a b', item: '<x>' })).toEqual({ view: 'home', space: null, tab: 'chat', task: null, doc: null, item: null });
  });
  it('the mockup\u2019s pages have routes: Agents, an agent, Library tabs, Members', () => {
    expect(teamLocation(teamQuery({ view: 'agent', item: 'a-1' }))).toMatchObject({ view: 'agent', item: 'a-1' });
    expect(teamLocation(teamQuery({ view: 'library', tab: 'skills' }))).toMatchObject({ view: 'library', tab: 'skills' });
    expect(teamLocation({ view: 'library' }).tab).toBe('agents');
    expect(teamLocation({ view: 'members' }).view).toBe('members');
  });
});

describe('people', () => {
  const people = toPeople([{ user_id: 'u1', name: 'Jess Park', email: 'jess@acme.co', role: 'admin' }, { user_id: 'u2', name: '', email: 'marco@acme.co' }, { nope: true }], 'u2');
  it('maps cloud members, with a name even when the profile has none', () => {
    expect(people).toEqual([
      { id: 'u1', name: 'Jess Park', first: 'Jess', email: 'jess@acme.co', role: 'admin', isMe: false },
      { id: 'u2', name: 'marco', first: 'marco', email: 'marco@acme.co', role: 'member', isMe: true },
    ]);
  });
  it('names people, agents and you', () => {
    const ctx = { people, agents: [{ id: 'a1', name: 'Proposal Agent' }], me: 'u2' };
    expect(nameOf({ kind: 'person', id: 'u1' }, ctx)).toBe('Jess');
    expect(nameOf({ kind: 'person', id: 'u2' }, ctx)).toBe('You');
    expect(nameOf({ kind: 'agent', id: 'a1' }, ctx)).toBe('Proposal Agent');
    expect(nameOf(null, ctx)).toBe('Unassigned');
  });
  it('initials', () => {
    expect(initials('Jess Park')).toBe('JP');
    expect(initials('sam@globex.com')).toBe('SA');
    expect(initials('')).toBe('?');
  });
});

describe('mentions', () => {
  const people = [{ id: 'u1', name: 'Jess Park', first: 'Jess' }];
  const agents = [{ id: 'a1', name: 'Proposal' }, { id: 'a2', name: 'Proposal Agent' }];
  it('matches the longest real name, case-insensitive, once', () => {
    expect(mentionsIn('@proposal agent draft it, @Jess check, @jess again', { people, agents })).toEqual([{ kind: 'agent', id: 'a2' }, { kind: 'person', id: 'u1' }]);
  });
  it('ignores @words that are nobody', () => {
    expect(mentionsIn('email me @ home', { people, agents })).toEqual([]);
  });
  it('splits text into runs for safe rendering', () => {
    expect(mentionRuns('hi @Jess, <b>x</b>', ['Jess'])).toEqual([{ text: 'hi ', mention: false }, { text: '@Jess', mention: true }, { text: ', <b>x</b>', mention: false }]);
    expect(mentionRuns('plain', [])).toEqual([{ text: 'plain', mention: false }]);
  });
});

describe('routine runs', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const day = 86400e3;
  const at = (daysAgo) => new Date(now - daysAgo * day).toISOString();
  it('reads each recorded status the way a person would', () => {
    expect(runTone('needs_review')).toMatchObject({ label: 'Waiting for your OK', state: 'need' });
    expect(runTone('completed').state).toBe('done');
    expect(runTone('failed').state).toBe('problem');
    expect(runTone('stuck').state).toBe('problem');
  });
  it('counts real runs: last 30 days, share finished (running excluded), per week', () => {
    const runs = [{ fired_at: at(1), status: 'running' }, { fired_at: at(2), status: 'completed' }, { fired_at: at(9), status: 'failed' }, { fired_at: at(40), status: 'completed' }];
    const stats = runStats(runs, now);
    expect(stats.last30).toBe(3);
    expect(stats.finishedShare).toBe(50);
    expect(stats.weekly).toHaveLength(8);
    expect(stats.weekly.at(-1)).toBe(2);
    expect(stats.weekly.at(-2)).toBe(1);
    expect(runStats([], now)).toEqual({ last30: 0, finishedShare: null, weekly: [0, 0, 0, 0, 0, 0, 0, 0] });
  });
  it('Run now waits only for the newest run, while it runs or waits for you', () => {
    expect(blockingRun([{ id: 'old', fired_at: at(3), status: 'needs_review' }, { id: 'new', fired_at: at(1), status: 'completed' }])).toBeNull();
    expect(blockingRun([{ id: 'a', fired_at: at(3), status: 'completed' }, { id: 'b', fired_at: at(1), status: 'needs_review' }]).id).toBe('b');
    expect(blockingRun([])).toBeNull();
  });
  it('sparkline needs two points', () => {
    expect(sparkPath([1])).toBe('');
    expect(sparkPath([0, 2]).startsWith('M0.0')).toBe(true);
  });
});

describe('small helpers', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  it('ago', () => {
    expect(ago('2026-11-01T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-11-01T11:00:00Z', now)).toBe('1h');
    expect(ago('nonsense', now)).toBe('');
  });
  it('filters the board', () => {
    const tasks = [{ assignee: { kind: 'person', id: 'me' } }, { assignee: { kind: 'agent', id: 'a' } }, { assignee: null }];
    expect(filterTasks(tasks, 'mine', 'me')).toHaveLength(1);
    expect(filterTasks(tasks, 'agents')).toHaveLength(1);
    expect(filterTasks(tasks, 'all')).toHaveLength(3);
  });
  it('inbox counts and wording', () => {
    const items = [{ kind: 'approval', state: 'pending', read: false, summary: 'Draft' }, { kind: 'mention', read: true, summary: 'hi' }];
    expect(unreadCount(items)).toBe(1);
    expect(pendingApprovals(items)).toHaveLength(1);
    expect(inboxSentence(items[0])).toMatch(/needs your approval/);
  });
});
