import { describe, it, expect } from 'vitest';
import { groupOutputsBySource, outputsForWorkflow, outputsForConversation, outputsForGoal, recentOutputs, outputLabel } from './outputSources.js';

const T = (d) => `2026-09-0${d} 10:00:00`;
const rows = [
  { id: 'a', conversation_id: 'c1', updated_at: T(1), title: 'A' },
  { id: 'b', workflow_id: 'w1', updated_at: T(2), title: 'B' },
  { id: 'c', tool_id: 't1', updated_at: T(3), title: 'C' },
  { id: 'd', updated_at: T(4), title: 'D' },
  { id: 'e', conversation_id: 'c2', updated_at: T(5), title: 'E' },
  { id: 'f', workflow_id: 'w1', updated_at: T(6), title: 'F', archived_at: T(6) },
  { id: 'g', workflow_id: 'w1', conversation_id: 'c9', updated_at: T(7), title: 'G' },
];
const names = { workflows: new Map([['w1', 'Nightly digest']]), tools: new Map([['t1', 'Joke Generator']]), conversations: new Map([['c1', 'Mobile study'], ['c2', 'Ops']]) };

describe('groupOutputsBySource', () => {
  it('groups by producer, names them, newest first inside, empty groups absent, archived skipped', () => {
    const g = groupOutputsBySource(rows, names);
    expect(g.map((x) => x.label)).toEqual(['Ops', 'Mobile study', 'Nightly digest', 'Joke Generator', 'Loose']);
    expect(g.find((x) => x.label === 'Nightly digest').items.map((i) => i.id)).toEqual(['g', 'b']);
    expect(g.every((x) => x.count === x.items.length && x.count > 0)).toBe(true);
    expect(g.flatMap((x) => x.items).some((i) => i.id === 'f')).toBe(false);
  });

  it('puts the open chat first as "This chat", and workflow wins over conversation for a run that ran in a chat', () => {
    const g = groupOutputsBySource(rows, names, { activeConversationId: 'c2' });
    expect(g[0]).toMatchObject({ id: 'conv:active', label: 'This chat', count: 1 });
    // g has both ids; a file a workflow wrote belongs to the workflow.
    expect(g.find((x) => x.id === 'wf:w1').items.map((i) => i.id)).toContain('g');
  });

  it('falls back to a kind label when a name is unknown', () => {
    const g = groupOutputsBySource([{ id: 'x', workflow_id: 'w9', updated_at: T(1) }], {});
    expect(g[0].label).toBe('Workflow');
  });
});

describe('slices', () => {
  it('outputsForWorkflow / outputsForConversation are newest-first and ignore archived', () => {
    expect(outputsForWorkflow(rows, 'w1').map((o) => o.id)).toEqual(['g', 'b']);
    expect(outputsForConversation(rows, 'c1').map((o) => o.id)).toEqual(['a']);
    expect(outputsForWorkflow(rows, null)).toEqual([]);
  });

  it('outputsForGoal unions the goal and task conversations and workflows', () => {
    const goal = { conversation_id: 'c1', tasks: [{ workflow_id: 'w1' }, { conversationId: 'c2' }] };
    expect(outputsForGoal(rows, goal).map((o) => o.id)).toEqual(['g', 'e', 'b', 'a']);
    expect(outputsForGoal(rows, null)).toEqual([]);
  });

  it('recentOutputs is the newest N across sources', () => {
    expect(recentOutputs(rows, 3).map((o) => o.id)).toEqual(['g', 'e', 'd']);
  });

  it('outputLabel prefers title, then file name, then content, then id', () => {
    expect(outputLabel({ title: 'T' })).toBe('T');
    expect(outputLabel({ file_path: 'C:\\x\\report.html' })).toBe('report.html');
    expect(outputLabel({ content: '  hello world ' })).toBe('hello world');
    expect(outputLabel({ id: 'abcdefghijk' })).toBe('output abcdefgh');
  });
});
