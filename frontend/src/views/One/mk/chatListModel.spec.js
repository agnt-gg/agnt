import { describe, it, expect } from 'vitest';
import { searchRows, unreadRows, groupSections } from './chatListModel.js';

const rows = [
  { id: 'a', title: 'Northwind renewal' }, { id: 'b', title: 'Q3 plan' }, { id: 'c', title: 'Hiring', working: true }, { id: 'd', title: 'Old group chat' },
];
const tree = [{ id: 'g1', name: 'Clients', children: [{ id: 'g2', name: 'Northwind', children: [] }] }, { id: 'g3', name: 'Empty', children: [] }];
const groups = { a: 'g2', b: 'g1', d: 'gone' };
const groupOf = (id) => groups[id] || null;

describe('One chat list views', () => {
  it('searches titles, ignoring case', () => {
    expect(searchRows(rows, 'north').map((r) => r.id)).toEqual(['a']);
    expect(searchRows(rows, '  ')).toBe(rows);
  });

  it('unread never includes the open chat or one still being written', () => {
    expect(unreadRows(rows, new Set(['a', 'b', 'c']), 'b').map((r) => r.id)).toEqual(['a']);
  });

  it('groups: collapsed hides chats and sub-groups; empty groups stay droppable; lost groups fall to No group', () => {
    const closed = groupSections(rows, tree, groupOf, new Set());
    expect(closed.map((s) => [s.id, s.depth, s.count, s.chats.length])).toEqual([['g1', 0, 1, 0], ['g3', 0, 0, 0], [null, 0, 2, 2]]);
    expect(closed.at(-1).chats.map((r) => r.id)).toEqual(['c', 'd']);
    const open = groupSections(rows, tree, groupOf, new Set(['g1', 'g2']));
    expect(open.map((s) => [s.id, s.depth, s.chats.map((r) => r.id)])).toEqual([['g1', 0, ['b']], ['g2', 1, ['a']], ['g3', 0, []], [null, 0, ['c', 'd']]]);
  });

  it('a chat in a collapsed sub-group is not shown as ungrouped', () => {
    const sections = groupSections(rows, tree, groupOf, new Set(['g1']));
    expect(sections.at(-1).chats.map((r) => r.id)).toEqual(['c', 'd']);
  });
});
