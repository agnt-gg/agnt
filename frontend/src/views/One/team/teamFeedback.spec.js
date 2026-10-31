import { describe, it, expect } from 'vitest';
import { mentionAt, mentionOptions, nameOf, SPACE_TABS, ANNIE } from './teamModel.js';
import { teamActivityRows, ACTIVITY_KINDS } from '@/views/Focused/focusedActivity.js';

const people = [{ id: 'me', name: 'Nathan Wilbanks' }, { id: 'p2', name: 'Jess Park' }, { id: 'p3', name: 'Marco Diaz' }];
const agents = [{ id: 'a1', name: 'Proposal Agent' }];

describe('@ tagging in a teamspace chat', () => {
  it('finds the @ being typed at the caret, and only at a word start', () => {
    expect(mentionAt('hey @je', 7)).toEqual({ query: 'je', start: 4 });
    expect(mentionAt('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionAt('mail me at a@b.com', 18)).toBe(null);
    expect(mentionAt('hey @jess park', 14)).toEqual({ query: 'jess park', start: 4 });
  });
  it('offers Annie, teammates (not me) and the teamspace agents, filtered by any word', () => {
    expect(mentionOptions('', { people, agents, me: 'me' }).map((o) => o.name)).toEqual(['Annie', 'Jess Park', 'Marco Diaz', 'Proposal Agent']);
    expect(mentionOptions('pa', { people, agents, me: 'me' }).map((o) => o.name)).toEqual(['Jess Park']);
    expect(mentionOptions('pro', { people, agents, me: 'me' })[0]).toMatchObject({ kind: 'agent', id: 'a1' });
    expect(mentionOptions('ann', { people, agents })[0]).toMatchObject({ kind: 'agent', id: ANNIE.id, hint: 'Assistant' });
  });
  it('Annie is named Annie wherever her messages show', () => {
    expect(nameOf({ kind: 'agent', id: 'annie' }, { agents: [] })).toBe('Annie');
  });
});

describe('teamspace tabs', () => {
  it('the board is called Tasks, and Docs is not a tab (docs live in Files)', () => {
    const shown = SPACE_TABS.filter((t) => !t.hidden).map((t) => t.label);
    expect(shown).toEqual(['Chat', 'Tasks', 'Agents', 'Routines', 'Files']);
  });
});

describe('Activity shows what people did in teamspaces, in detail', () => {
  const lookups = {
    spaces: new Map([['ws', { name: 'Sales' }]]),
    tasks: new Map([['t1', { title: 'Call Globex', workspaceId: 'ws' }]]),
    docs: new Map([['d1', { name: 'Q4 plan', workspaceId: 'ws' }]]),
    people: new Map([['p2', 'Jess Park']]),
    me: 'me',
  };
  const ev = (id, action, target, actor = 'p2', at = '2026-10-31T10:00:00Z') => ({ id, actor_id: actor, action, target_id: target, created_at: at });
  it('names who did what, to which task or doc, and where', () => {
    const rows = teamActivityRows([
      ev(1, 'task.created', 't1', 'p2', '2026-10-31T09:00:00Z'),
      ev(2, 'task.approved', 't1', 'me', '2026-10-31T11:00:00Z'),
      ev(3, 'doc.revised', 'd1'),
      ev(4, 'message.posted', 'ws'),
      ev(5, 'member.joined', 'p2'),
    ], lookups);
    expect(rows.map((r) => `${r.actor} ${r.sentence}${r.where ? ' · ' + r.where : ''}`)).toEqual([
      'You approved the task “Call Globex” · Sales',
      'Jess Park edited the doc “Q4 plan” · Sales',
      'Jess Park posted in chat · Sales',
      'Jess Park joined the team',
      'Jess Park created the task “Call Globex” · Sales',
    ]);
    expect(rows[0].target).toEqual({ type: 'task', space: 'ws', id: 't1' });
  });
  it('never shows what you cannot see: someone else’s private card, another teamspace, a deleted doc', () => {
    expect(teamActivityRows([ev(1, 'task.created', 'private-card'), ev(2, 'message.posted', 'other-ws'), ev(3, 'doc.created', 'gone')], lookups)).toEqual([]);
  });
  it('has its own Teamspaces filter', () => {
    expect(ACTIVITY_KINDS.map((k) => k.id)).toContain('team');
  });
});
