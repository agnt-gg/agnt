/**
 * CursorCliClient usage normalization (PR #50 hardening).
 *
 * The Cursor CLI reports camelCase usage — verified live 2026-07-27:
 *   { inputTokens: 7276, outputTokens: 37, cacheReadTokens: 2470, cacheWriteTokens: 0 }
 * Everything downstream (orchestrator token accumulator, workflow LLM node)
 * reads snake_case. Before normalization, cursor chats recorded 0 tokens:
 * context monitor blind, cache metrics blind, notional cost always $0.00/0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./CursorCliService.js', () => ({
  default: {
    getDefaultModel: vi.fn(() => 'cursor-grok-4.5-high'),
    getDefaultWorkdir: vi.fn(() => '/tmp/cursor-test-work'),
    resolveCursorBin: vi.fn(() => 'cursor-agent'),
    runExec: vi.fn(),
  },
}));

import CursorCliService from './CursorCliService.js';
import { createCursorCliClient } from './CursorCliClient.js';

describe('CursorCliClient usage normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates the real camelCase CLI shape to the OpenAI contract', async () => {
    CursorCliService.runExec.mockResolvedValue({
      success: true,
      text: 'ok',
      sessionId: 's1',
      // Literal shape captured from a live cursor-agent run.
      usage: { inputTokens: 7276, outputTokens: 37, cacheReadTokens: 2470, cacheWriteTokens: 0 },
    });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'usage-1' });
    const res = await client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.usage).toEqual({
      prompt_tokens: 7276,
      completion_tokens: 37,
      total_tokens: 7313,
      prompt_tokens_details: { cached_tokens: 2470 },
    });
  });

  it('omits prompt_tokens_details when nothing was cached', async () => {
    CursorCliService.runExec.mockResolvedValue({
      success: true,
      text: 'ok',
      sessionId: 's2',
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'usage-2' });
    const res = await client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.usage).toEqual({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
  });

  it('passes an already snake_case shape through untouched', async () => {
    const snake = { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 };
    CursorCliService.runExec.mockResolvedValue({ success: true, text: 'ok', sessionId: 's3', usage: snake });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'usage-3' });
    const res = await client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.usage).toEqual(snake);
  });

  it('returns null usage when the CLI reports none', async () => {
    CursorCliService.runExec.mockResolvedValue({ success: true, text: 'ok', sessionId: 's4', usage: null });
    const client = createCursorCliClient({ userId: 'u', conversationId: 'usage-4' });
    const res = await client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.usage).toBeNull();
  });
});
