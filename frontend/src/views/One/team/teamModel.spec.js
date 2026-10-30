import { describe, it, expect } from 'vitest';
import { teamLocation, teamQuery, initials, toPeople, nameOf, mentionsIn, mentionRuns, ago, filterTasks, unreadCount, pendingApprovals, inboxSentence } from './teamModel.js';

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
    expect(teamLocation({ view: 'evil', tab: '<script>', space: '../../x', task: 'a b' })).toEqual({ view: 'home', space: null, tab: 'chat', task: null, doc: null });
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
