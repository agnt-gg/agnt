/**
 * CursorCliClient real token streaming.
 *
 * The CLI supports `--output-format stream-json --stream-partial-output`, so
 * deltas are available; the original client awaited the whole run and emitted
 * one chunk, making Cursor the only provider whose replies materialised all at
 * once. These tests pin the streaming contract AND the delta-vs-final
 * discriminator that makes it correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./CursorCliService.js', () => ({
  default: {
    getDefaultModel: vi.fn(() => 'composer-2.5'),
    getDefaultWorkdir: vi.fn(() => '/tmp/cursor-test-work'),
    resolveCursorBin: vi.fn(() => 'cursor-agent'),
    runExec: vi.fn(),
  },
}));

import CursorCliService from './CursorCliService.js';
import { createCursorCliClient } from './CursorCliClient.js';

async function drain(gen) {
  const out = { content: '', reasoning: '', usage: null, chunks: 0 };
  for await (const chunk of gen) {
    out.chunks++;
    const d = chunk.choices?.[0]?.delta || {};
    if (d.content) out.content += d.content;
    if (d.reasoning_content) out.reasoning += d.reasoning_content;
    if (chunk.usage) out.usage = chunk.usage;
  }
  return out;
}

describe('CursorCliClient streaming', () => {
  beforeEach(() => vi.clearAllMocks());

  it('yields one chunk per delta, not a single blob', async () => {
    CursorCliService.runExec.mockImplementation(async ({ onDelta }) => {
      for (const t of ['1\n', '2\n', '3\n', '4\n', '5']) onDelta(t);
      return { success: true, text: '1\n2\n3\n4\n5', sessionId: 's1', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } };
    });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c1' });
    const gen = await client.chat.completions.create({ messages: [{ role: 'user', content: 'count' }], stream: true });
    const got = await drain(gen);
    expect(got.content).toBe('1\n2\n3\n4\n5');
    // 5 content chunks + 1 usage chunk. The point is >1: a blob would be 1.
    expect(got.chunks).toBeGreaterThan(1);
  });

  it('requests streaming from the service by passing handlers', async () => {
    CursorCliService.runExec.mockResolvedValue({ success: true, text: 'x', sessionId: 's', usage: null });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c2' });
    await drain(await client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }], stream: true }));
    const passed = CursorCliService.runExec.mock.calls[0][0];
    expect(typeof passed.onDelta).toBe('function');
    expect(typeof passed.onReasoning).toBe('function');
  });

  it('forwards thinking as reasoning_content', async () => {
    CursorCliService.runExec.mockImplementation(async ({ onDelta, onReasoning }) => {
      onReasoning('let me think ');
      onReasoning('about this');
      onDelta('answer');
      return { success: true, text: 'answer', sessionId: 's3', usage: null };
    });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c3' });
    const got = await drain(await client.chat.completions.create({ messages: [{ role: 'user', content: 'q' }], stream: true }));
    expect(got.reasoning).toBe('let me think about this');
    expect(got.content).toBe('answer');
  });

  it('emits normalized usage on the final chunk', async () => {
    CursorCliService.runExec.mockImplementation(async ({ onDelta }) => {
      onDelta('ok');
      return { success: true, text: 'ok', sessionId: 's4', usage: { inputTokens: 7283, outputTokens: 61, cacheReadTokens: 2470 } };
    });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c4' });
    const got = await drain(await client.chat.completions.create({ messages: [{ role: 'user', content: 'q' }], stream: true }));
    expect(got.usage).toEqual({
      prompt_tokens: 7283,
      completion_tokens: 61,
      total_tokens: 7344,
      prompt_tokens_details: { cached_tokens: 2470 },
    });
  });

  it('throws through the generator on a resolved failure shape', async () => {
    CursorCliService.runExec.mockResolvedValue({ success: false, error: 'cursor_exec: model usage limit reached.' });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c5' });
    const gen = await client.chat.completions.create({ messages: [{ role: 'user', content: 'q' }], stream: true });
    await expect(drain(gen)).rejects.toThrow(/usage limit/);
  });

  it('throws through the generator on a rejected run', async () => {
    CursorCliService.runExec.mockRejectedValue(new Error('cursor_exec: not authenticated.'));
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c6' });
    const gen = await client.chat.completions.create({ messages: [{ role: 'user', content: 'q' }], stream: true });
    await expect(drain(gen)).rejects.toThrow(/not authenticated/);
  });

  it('does not request streaming for a non-streaming call', async () => {
    CursorCliService.runExec.mockResolvedValue({ success: true, text: 'plain', sessionId: 's7', usage: null });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c7' });
    const res = await client.chat.completions.create({ messages: [{ role: 'user', content: 'q' }] });
    expect(res.choices[0].message.content).toBe('plain');
    const passed = CursorCliService.runExec.mock.calls[0][0];
    expect(passed.onDelta).toBeUndefined();
    expect(passed.onReasoning).toBeUndefined();
  });

  it('stores the session id from a streamed run', async () => {
    CursorCliService.runExec.mockImplementation(async ({ onDelta }) => {
      onDelta('hi');
      return { success: true, text: 'hi', sessionId: 'sess-stream', usage: null };
    });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'c8' });
    await drain(await client.chat.completions.create({ messages: [{ role: 'user', content: 'one' }], stream: true }));
    await drain(await client.chat.completions.create({ messages: [{ role: 'user', content: 'two' }], stream: true }));
    const second = CursorCliService.runExec.mock.calls[1][0];
    expect(second.resume).toBe(true);
    expect(second.sessionId).toBe('sess-stream');
  });
});

describe('CursorCliService streaming contract (source guards)', () => {
  // The delta/final discriminator is the subtle part: with
  // --stream-partial-output the CLI emits BOTH incremental assistant messages
  // (carrying timestamp_ms) and a final consolidated one (without it).
  // Summing both doubles the reply. Pin the mechanism.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'CursorCliService.js'), 'utf8');

  it('opts into stream-json only when handlers are supplied', () => {
    expect(src).toContain("streaming ? 'stream-json' : 'json'");
    expect(src).toContain("args.push('--stream-partial-output')");
  });

  it('discriminates deltas from the final consolidated message', () => {
    expect(src).toContain('obj.timestamp_ms == null');
  });

  it('parses lines incrementally rather than rescanning the whole buffer', () => {
    expect(src).toContain('lineBuffer');
    expect(src).not.toContain('const tryParseResult');
  });
});
