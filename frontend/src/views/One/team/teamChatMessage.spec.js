import { describe, it, expect } from 'vitest';
import { chatMessageOf } from './teamChatMessage.js';

describe('a teamspace message in the main chat’s shape', () => {
  it('a person’s text becomes one text part', () => {
    const m = chatMessageOf({ id: 'm1', author: { kind: 'person', id: 'a' }, body: '**hi**', createdAt: '2026-11-01T00:00:00Z' });
    expect(m).toMatchObject({ id: 'team-m1', role: 'assistant', content: '**hi**', contentParts: [{ type: 'text', text: '**hi**' }], toolCalls: [], isStreaming: false });
  });
  it('Annie’s reply keeps its tool calls and interleave; a live one is streaming', () => {
    const message = { content: 'Found it', contentParts: [{ type: 'tool_call', toolCallId: 't1' }, { type: 'text', text: 'Found it' }], toolCalls: [{ id: 't1', name: 'web_search', status: 'completed' }] };
    const m = chatMessageOf({ id: 'live-1', author: { kind: 'agent', id: 'annie' }, body: 'Found it', message, live: true, createdAt: '2026-11-01T00:00:00Z' });
    expect(m.contentParts).toBe(message.contentParts);
    expect(m.toolCalls).toBe(message.toolCalls);
    expect(m.isStreaming).toBe(true);
  });
  it('is the same object until the message changes, so MessageItem does not re-render for nothing', () => {
    const src = { id: 'm1', author: { kind: 'person', id: 'a' }, body: 'x', createdAt: '2026-11-01T00:00:00Z' };
    expect(chatMessageOf(src)).toBe(chatMessageOf(src));
    const before = chatMessageOf(src);
    src.body = 'y';
    expect(chatMessageOf(src)).not.toBe(before);
  });
});
