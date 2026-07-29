/**
 * chatStreamReducer — wire-protocol semantics.
 *
 * Every assertion here is written against the payload shapes
 * OrchestratorService actually sends:
 *   content_delta  { assistantMessageId, delta, accumulated }
 *   reasoning_delta{ assistantMessageId, delta, accumulated }
 *   tool_pending   { assistantMessageId, toolCall: { id, name } }
 *   tool_start     { assistantMessageId, toolCall: { id, name, args } }
 *   tool_end       { assistantMessageId, toolCall: { id, name, result?, error? } }
 *   final_content  { assistantMessageId, content, usage }
 */
import { describe, it, expect } from 'vitest';
import {
  createAssistantMessage,
  applyStreamEvent,
  hydrateMessage,
  HANDLED_STREAM_EVENTS,
} from './chatStreamReducer.js';

const emit = (msg, name, data) => applyStreamEvent(msg, name, data);

describe('content deltas', () => {
  it('accumulates into content', () => {
    const m = createAssistantMessage();
    emit(m, 'content_delta', { delta: 'Hello ' });
    emit(m, 'content_delta', { delta: 'world' });
    expect(m.content).toBe('Hello world');
  });

  it('coalesces consecutive deltas into ONE text part', () => {
    const m = createAssistantMessage();
    for (const d of ['a', 'b', 'c', 'd']) emit(m, 'content_delta', { delta: d });
    expect(m.contentParts).toEqual([{ type: 'text', text: 'abcd' }]);
  });

  it('coalescing is what lets a fence split across deltas render as one block', () => {
    const m = createAssistantMessage();
    for (const d of ['```js\n', 'const a = 1;\n', '```']) emit(m, 'content_delta', { delta: d });
    expect(m.contentParts).toHaveLength(1);
    expect(m.contentParts[0].text).toBe('```js\nconst a = 1;\n```');
  });

  it('ignores empty and non-string deltas', () => {
    const m = createAssistantMessage();
    expect(emit(m, 'content_delta', { delta: '' }).changed).toBe(false);
    expect(emit(m, 'content_delta', {}).changed).toBe(false);
    expect(emit(m, 'content_delta', { delta: null }).changed).toBe(false);
    expect(m.contentParts).toHaveLength(0);
  });

  it('clears a stale tool status once prose resumes', () => {
    const m = createAssistantMessage();
    emit(m, 'tool_start', { toolCall: { id: 't1', name: 'web_search' } });
    expect(emit(m, 'content_delta', { delta: 'Found it' }).status).toBe('');
  });
});

describe('tool calls', () => {
  it('reads the name from toolCall, not the event root', () => {
    // The pre-existing mobile client read data.name (always undefined) and
    // labelled every card "tool". This is that bug, pinned.
    const m = createAssistantMessage();
    emit(m, 'tool_start', { toolCall: { id: 't1', name: 'web_search', args: { q: 'x' } } });
    expect(m.toolCalls[0].name).toBe('web_search');
    expect(m.toolCalls[0].args).toEqual({ q: 'x' });
  });

  it('tool_pending then tool_start is ONE card, upgraded with args', () => {
    const m = createAssistantMessage();
    emit(m, 'tool_pending', { toolCall: { id: 't1', name: 'web_search' } });
    emit(m, 'tool_start', { toolCall: { id: 't1', name: 'web_search', args: { q: 'x' } } });
    expect(m.toolCalls).toHaveLength(1);
    expect(m.contentParts.filter((p) => p.type === 'tool_call')).toHaveLength(1);
    expect(m.toolCalls[0].status).toBe('running');
    expect(m.toolCalls[0].args).toEqual({ q: 'x' });
  });

  it('records interleave order: text, tool, text', () => {
    const m = createAssistantMessage();
    emit(m, 'content_delta', { delta: 'Let me look. ' });
    emit(m, 'tool_start', { toolCall: { id: 't1', name: 'web_search' } });
    emit(m, 'tool_end', { toolCall: { id: 't1', result: 'ok' } });
    emit(m, 'content_delta', { delta: 'Here it is.' });
    expect(m.contentParts.map((p) => p.type)).toEqual(['text', 'tool_call', 'text']);
    expect(m.contentParts[0].text).toBe('Let me look. ');
    expect(m.contentParts[2].text).toBe('Here it is.');
  });

  it('tool_end attaches the result and completes the card', () => {
    const m = createAssistantMessage();
    emit(m, 'tool_start', { toolCall: { id: 't1', name: 'read_file' } });
    emit(m, 'tool_end', { toolCall: { id: 't1', result: { ok: true } } });
    expect(m.toolCalls[0].result).toEqual({ ok: true });
    expect(m.toolCalls[0].status).toBe('completed');
    expect(m.toolCalls[0].error).toBeUndefined();
  });

  it('tool_end with an error marks the card errored', () => {
    const m = createAssistantMessage();
    emit(m, 'tool_start', { toolCall: { id: 't1', name: 'read_file' } });
    emit(m, 'tool_end', { toolCall: { id: 't1', error: 'EISDIR' } });
    expect(m.toolCalls[0].status).toBe('error');
    expect(m.toolCalls[0].error).toBe('EISDIR');
  });

  it('surfaces a tool_end that never had a tool_start (argument-parse failure)', () => {
    // OrchestratorService emits tool_end alone when arguments fail to parse.
    // Dropping it would hide the only evidence the call happened.
    const m = createAssistantMessage();
    emit(m, 'tool_end', { toolCall: { id: 't9', name: 'edit_file', error: 'bad args' } });
    expect(m.toolCalls).toHaveLength(1);
    expect(m.toolCalls[0].name).toBe('edit_file');
    expect(m.toolCalls[0].status).toBe('error');
  });

  it('ignores tool events with no id rather than creating a ghost card', () => {
    const m = createAssistantMessage();
    expect(emit(m, 'tool_start', { toolCall: { name: 'x' } }).changed).toBe(false);
    expect(emit(m, 'tool_start', {}).changed).toBe(false);
    expect(m.toolCalls).toHaveLength(0);
  });
});

describe('reasoning', () => {
  it('accumulates separately from content', () => {
    const m = createAssistantMessage();
    emit(m, 'reasoning_delta', { delta: 'think ' });
    emit(m, 'reasoning_delta', { delta: 'more' });
    expect(m.reasoning).toBe('think more');
    expect(m.content).toBe('');
    expect(m.contentParts).toHaveLength(0);
  });
});

describe('final_content', () => {
  it('does NOT duplicate text that already streamed', () => {
    const m = createAssistantMessage();
    emit(m, 'content_delta', { delta: 'The answer.' });
    emit(m, 'final_content', { content: 'The answer.' });
    expect(m.content).toBe('The answer.');
  });

  it('adopts the content when nothing streamed (non-streaming provider)', () => {
    const m = createAssistantMessage();
    emit(m, 'final_content', { content: 'All at once.' });
    expect(m.content).toBe('All at once.');
    expect(m.contentParts).toEqual([{ type: 'text', text: 'All at once.' }]);
  });
});

describe('control events', () => {
  it('reports errors', () => {
    const r = emit(createAssistantMessage(), 'error', { error: 'boom' });
    expect(r.error).toBe('boom');
  });

  it('reports done and clears the status', () => {
    const r = emit(createAssistantMessage(), 'done', {});
    expect(r.done).toBe(true);
    expect(r.status).toBe('');
  });

  it('reports unknown events as unhandled instead of throwing', () => {
    const r = emit(createAssistantMessage(), 'context_status', { foo: 1 });
    expect(r.handled).toBe(false);
    expect(r.changed).toBe(false);
  });

  it('every documented event name is actually handled', () => {
    for (const name of HANDLED_STREAM_EVENTS) {
      const r = applyStreamEvent(createAssistantMessage(), name, { toolCall: { id: 'x', name: 'y' } });
      expect(r.handled, `${name} should be handled`).toBe(true);
    }
  });

  it('never throws on a null message', () => {
    expect(applyStreamEvent(null, 'content_delta', { delta: 'x' }).handled).toBe(false);
  });
});

describe('hydrateMessage', () => {
  it('rebuilds contentParts for legacy saves that only stored content', () => {
    const m = hydrateMessage({ id: 'a', role: 'assistant', content: '# Title' });
    expect(m.contentParts).toEqual([{ type: 'text', text: '# Title' }]);
  });

  it('rebuilds tool_call parts so old chats still show their tool cards', () => {
    const m = hydrateMessage({
      role: 'assistant',
      content: 'done',
      toolCalls: [{ id: 't1', name: 'web_search' }],
    });
    expect(m.contentParts.map((p) => p.type)).toEqual(['text', 'tool_call']);
  });

  it('preserves an explicit contentParts order', () => {
    const parts = [
      { type: 'tool_call', toolCallId: 't1' },
      { type: 'text', text: 'after' },
    ];
    expect(hydrateMessage({ role: 'assistant', content: 'after', contentParts: parts, toolCalls: [{ id: 't1' }] }).contentParts).toBe(
      parts
    );
  });

  it('coerces a non-string content instead of rendering "[object Object]" silently', () => {
    expect(hydrateMessage({ role: 'user', content: null }).content).toBe('');
  });

  it('defaults an unknown role to assistant', () => {
    expect(hydrateMessage({ role: 'system', content: 'x' }).role).toBe('assistant');
    expect(hydrateMessage({ role: 'user', content: 'x' }).role).toBe('user');
  });
});
