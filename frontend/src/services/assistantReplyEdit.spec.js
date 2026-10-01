// Editing the latest assistant reply in place: which message qualifies, and
// what an edit changes. See assistantReplyEdit.js for the cache rationale.
import { describe, it, expect } from 'vitest';
import { closingText, editableReplyId, applyReplyEdit } from './assistantReplyEdit.js';

const user = (id, content = 'question') => ({ id, role: 'user', content });
const plainReply = (id, content = 'An answer.') => ({ id, role: 'assistant', content, contentParts: [{ type: 'text', text: content }] });

/** text₁ → call → closing text, exactly as the stream reducer builds it. */
const toolReply = (id, { before = 'Checking. ', closing = 'Found it.' } = {}) => ({
  id,
  role: 'assistant',
  content: before + closing,
  contentParts: [
    { type: 'text', text: before },
    { type: 'tool_call', toolCallId: 'tc-1' },
    { type: 'text', text: closing },
  ],
  toolCalls: [{ id: 'tc-1', name: 'web_search', args: {}, result: 'r' }],
  reasoning: 'thinking about it',
  reasoning_content: 'thinking about it',
});

describe('closingText', () => {
  it('is the whole reply when no tool ran', () => {
    expect(closingText(plainReply('a'))).toBe('An answer.');
  });

  it('is only the text after the last tool call', () => {
    expect(closingText(toolReply('a'))).toBe('Found it.');
  });

  it('is null when the reply ends on a tool call', () => {
    const reply = toolReply('a');
    reply.contentParts.pop();
    expect(closingText(reply)).toBeNull();
  });

  it('falls back to content for legacy messages without contentParts', () => {
    expect(closingText({ id: 'a', role: 'assistant', content: 'old' })).toBe('old');
  });

  it('is null for user messages and empty replies', () => {
    expect(closingText(user('u'))).toBeNull();
    expect(closingText({ id: 'a', role: 'assistant', content: '  ', contentParts: [] })).toBeNull();
  });
});

describe('editableReplyId', () => {
  it('is the latest reply', () => {
    expect(editableReplyId([user('u1'), plainReply('a1'), user('u2'), plainReply('a2')])).toBe('a2');
  });

  it('is null when the user spoke last', () => {
    expect(editableReplyId([user('u1'), plainReply('a1'), user('u2')])).toBeNull();
  });

  it('skips non-conversational rows such as goal cards and the compaction marker', () => {
    const messages = [user('u1'), plainReply('a1'), { id: 'g', role: 'system', kind: 'goal-event' }, { id: 'c', role: 'compaction' }];
    expect(editableReplyId(messages)).toBe('a1');
  });

  it('excludes a welcome message that answers nothing', () => {
    expect(editableReplyId([plainReply('welcome', 'Hi!')])).toBeNull();
  });

  it('excludes provider-setup prompts and replies ending on a tool call', () => {
    expect(editableReplyId([user('u'), { ...plainReply('a'), showProviderSetup: true }])).toBeNull();
    const reply = toolReply('a');
    reply.contentParts.pop();
    expect(editableReplyId([user('u'), reply])).toBeNull();
  });

  it('tolerates junk input', () => {
    expect(editableReplyId(null)).toBeNull();
    expect(editableReplyId([null, undefined])).toBeNull();
  });
});

describe('applyReplyEdit', () => {
  it('replaces the closing text and keeps content and contentParts in step', () => {
    const reply = toolReply('a');
    const previous = applyReplyEdit(reply, 'Fixed answer.');
    expect(previous).toBe('Found it.');
    expect(reply.contentParts[2].text).toBe('Fixed answer.');
    expect(reply.content).toBe('Checking. Fixed answer.');
  });

  it('never touches earlier text or the tool calls', () => {
    const reply = toolReply('a');
    const toolCalls = reply.toolCalls;
    applyReplyEdit(reply, 'Fixed answer.');
    expect(reply.contentParts[0]).toEqual({ type: 'text', text: 'Checking. ' });
    expect(reply.contentParts[1]).toEqual({ type: 'tool_call', toolCallId: 'tc-1' });
    expect(reply.toolCalls).toBe(toolCalls);
  });

  it('replaces the edited part object so identity-memoised renders refresh', () => {
    const reply = toolReply('a');
    const before = reply.contentParts[2];
    applyReplyEdit(reply, 'Fixed answer.');
    expect(reply.contentParts[2]).not.toBe(before);
  });

  it('drops saved reasoning, which argued for the old words', () => {
    const reply = toolReply('a');
    applyReplyEdit(reply, 'Fixed answer.');
    expect(reply).not.toHaveProperty('reasoning');
    expect(reply).not.toHaveProperty('reasoning_content');
  });

  it('adds no edit marker anywhere (silent by design)', () => {
    const reply = plainReply('a');
    const keysBefore = Object.keys(reply).sort();
    applyReplyEdit(reply, 'Better.');
    expect(Object.keys(reply).sort()).toEqual(keysBefore);
  });

  it('edits legacy messages without contentParts', () => {
    const reply = { id: 'a', role: 'assistant', content: 'old' };
    applyReplyEdit(reply, 'new');
    expect(reply.content).toBe('new');
  });

  it('rebuilds content from parts when content had drifted from them', () => {
    const reply = toolReply('a');
    reply.content = 'something else entirely';
    applyReplyEdit(reply, 'Fixed.');
    expect(reply.content).toBe('Checking. Fixed.');
  });

  it('throws on a reply that is not editable or on empty text', () => {
    const reply = toolReply('a');
    reply.contentParts.pop();
    expect(() => applyReplyEdit(reply, 'x')).toThrow();
    expect(() => applyReplyEdit(plainReply('b'), '   ')).toThrow();
  });
});
