import { describe, it, expect } from 'vitest';
import {
  deleteCut,
  forkCut,
  regenerateSource,
  copyText,
  messageActions,
  branchPlan,
  BRANCH_ACTIONS,
  NO_BRANCH_ACTIONS,
} from './messageBranching.js';

const greeting = { id: 'g', role: 'assistant', content: "Hi! I'm Annie." };
const transcript = () => [
  greeting,
  { id: 'u1', role: 'user', content: 'continue' },
  { id: 'a1', role: 'assistant', content: 'Step one.' },
  { id: 'u2', role: 'user', content: 'find the bug' },
  { id: 'a2', role: 'assistant', content: 'In a.js.' },
  { id: 'u3', role: 'user', content: 'continue' },
  { id: 'a3', role: 'assistant', content: 'Done.' },
];

describe('deleteCut', () => {
  it('a user message: cut before it, anchored on its words and the repeats after it', () => {
    expect(deleteCut(transcript(), 'u1')).toEqual({
      index: 1, removed: 6, emptied: false,
      cut: { anchorText: 'continue', sameTextAfter: 1, mode: 'before' },
    });
    expect(deleteCut(transcript(), 'u3').cut).toEqual({ anchorText: 'continue', sameTextAfter: 0, mode: 'before' });
  });

  it('a reply: keep the user message it answered, cut through it', () => {
    expect(deleteCut(transcript(), 'a2')).toMatchObject({
      index: 4, removed: 3, cut: { anchorText: 'find the bug', sameTextAfter: 0, mode: 'through' },
    });
  });

  it('a greeting above every user message cuts before the first one, and empties the chat', () => {
    expect(deleteCut(transcript(), 'g')).toMatchObject({ index: 0, emptied: true, cut: { anchorText: 'continue', sameTextAfter: 1, mode: 'before' } });
  });

  it('flags a delete that leaves nothing worth saving', () => {
    const noGreeting = transcript().slice(1);
    expect(deleteCut(noGreeting, 'u1').emptied).toBe(true);
    expect(deleteCut(noGreeting, 'a1').emptied).toBe(false);
    // A provider-setup card is not worth saving (autosave skips it too).
    expect(deleteCut([{ id: 's', role: 'assistant', content: 'Connect a provider', showProviderSetup: true }, ...noGreeting], 'u1').emptied).toBe(true);
  });

  it('a second reply in one turn is cut here only: the server stores the turn as one', () => {
    const groupChat = [
      { id: 'u1', role: 'user', content: 'everyone weigh in' },
      { id: 'a1', role: 'assistant', content: 'Annie: yes.', agentName: 'Annie' },
      { id: 'a2', role: 'assistant', content: 'Bob: no.', agentName: 'Bob' },
    ];
    expect(deleteCut(groupChat, 'a2')).toMatchObject({ index: 2, removed: 1, cut: null });
    expect(deleteCut(groupChat, 'a1').cut).toEqual({ anchorText: 'everyone weigh in', sameTextAfter: 0, mode: 'through' });
  });

  it('cannot name a cut for an image-only message', () => {
    const images = [greeting, { id: 'u1', role: 'user', content: '', files: [{ name: 'a.png' }] }, { id: 'a1', role: 'assistant', content: 'A cat.' }];
    expect(deleteCut(images, 'u1').cut).toBeNull();
    expect(deleteCut(images, 'a1').cut).toBeNull();
  });

  it('returns null for a message that is not in the transcript', () => {
    expect(deleteCut(transcript(), 'nope')).toBeNull();
    expect(deleteCut(null, 'u1')).toBeNull();
  });
});

describe('forkCut', () => {
  it('a user message: the fork ends on it, unanswered', () => {
    const fork = forkCut(transcript(), 'u2');
    expect(fork.messages.map((m) => m.id)).toEqual(['g', 'u1', 'a1', 'u2']);
    expect(fork.cut).toEqual({ anchorText: 'find the bug', sameTextAfter: 0, mode: 'through' });
  });

  it('a reply: the fork keeps it, and the server keeps its whole turn', () => {
    const fork = forkCut(transcript(), 'a1');
    expect(fork.messages.map((m) => m.id)).toEqual(['g', 'u1', 'a1']);
    expect(fork.cut).toEqual({ anchorText: 'continue', sameTextAfter: 1, mode: 'turn' });
  });

  it('forks without server context when no user message anchors it', () => {
    expect(forkCut(transcript(), 'g')).toEqual({ messages: [greeting], cut: null });
  });

  it('does not copy or reorder the messages it keeps', () => {
    const rows = transcript();
    expect(forkCut(rows, 'a2').messages[4]).toBe(rows[4]);
  });
});

describe('regenerateSource', () => {
  it('is the user message the reply answered', () => {
    expect(regenerateSource(transcript(), 'a2').id).toBe('u2');
  });

  it('is nothing for a user message, a greeting, or an image-only prompt', () => {
    expect(regenerateSource(transcript(), 'u2')).toBeNull();
    expect(regenerateSource(transcript(), 'g')).toBeNull();
    expect(regenerateSource([{ id: 'u', role: 'user', content: '  ' }, { id: 'a', role: 'assistant', content: 'x' }], 'a')).toBeNull();
  });
});

describe('copyText', () => {
  it('copies the message as written, falling back to its text parts', () => {
    expect(copyText({ content: 'Hello **world**' })).toBe('Hello **world**');
    expect(copyText({ content: '', contentParts: [{ type: 'text', text: 'a' }, { type: 'tool_call' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
    expect(copyText(null)).toBe('');
  });
});

describe('messageActions', () => {
  const ids = (args) => messageActions(args).map((a) => a.id);

  it('orders actions the same way on every message', () => {
    expect(ids({ role: 'user', canEdit: true, enabled: BRANCH_ACTIONS })).toEqual(['copy', 'edit', 'fork', 'delete']);
    expect(ids({ role: 'assistant', canEdit: true, enabled: BRANCH_ACTIONS })).toEqual(['copy', 'edit', 'regenerate', 'fork', 'delete']);
  });

  it('offers only Copy and Edit unless the host handles more', () => {
    expect(ids({ role: 'user', canEdit: true })).toEqual(['copy', 'edit']);
    expect(ids({ role: 'assistant' })).toEqual(['copy']);
  });

  it('never offers Regenerate on a user message', () => {
    expect(ids({ role: 'user', enabled: ['regenerate'] })).toEqual(['copy']);
  });

  it('offers nothing while the message is being written, or for a system row', () => {
    expect(messageActions({ role: 'assistant', busy: true, enabled: BRANCH_ACTIONS })).toEqual([]);
    expect(messageActions({ role: 'system', enabled: BRANCH_ACTIONS })).toEqual([]);
  });

  it('names Edit for what it does', () => {
    expect(messageActions({ role: 'assistant', canEdit: true, editLabel: 'Edit reply' })[1]).toMatchObject({ id: 'edit', label: 'Edit reply', icon: 'fas fa-pen' });
  });
});

describe('branchPlan', () => {
  it('gives each message the actions it may offer and its delete count', () => {
    const plan = branchPlan(transcript(), BRANCH_ACTIONS);
    expect(plan.get('g')).toEqual({ actions: ['fork'], deleteCount: 7 });
    expect(plan.get('u1')).toEqual({ actions: ['fork', 'delete'], deleteCount: 6 });
    expect(plan.get('a1')).toEqual({ actions: ['regenerate', 'fork', 'delete'], deleteCount: 5 });
    expect(plan.get('a3').deleteCount).toBe(1);
  });

  it('does not offer a delete that would empty the conversation', () => {
    const plan = branchPlan(transcript().slice(1), BRANCH_ACTIONS);
    expect(plan.get('u1').actions).toEqual(['fork']);
    expect(plan.get('a1').actions).toContain('delete');
  });

  it('honours the host\'s set', () => {
    const plan = branchPlan(transcript(), ['regenerate', 'delete']);
    expect(plan.get('a1').actions).toEqual(['regenerate', 'delete']);
    expect(plan.get('u1').actions).toEqual(['delete']);
  });

  it('keeps each set\'s identity across recomputes, so messages do not re-render', () => {
    const first = branchPlan(transcript(), BRANCH_ACTIONS);
    const second = branchPlan(transcript(), BRANCH_ACTIONS);
    expect(second.get('a1').actions).toBe(first.get('a1').actions);
    expect(Object.isFrozen(first.get('a1').actions)).toBe(true);
    expect(branchPlan(transcript(), []).get('a1').actions).toBe(NO_BRANCH_ACTIONS);
  });

  it('is empty for no transcript', () => {
    expect(branchPlan(null, BRANCH_ACTIONS).size).toBe(0);
  });
});
