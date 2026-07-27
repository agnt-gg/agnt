/**
 * CursorCliClient — error surfacing and session continuity (PR #50 hardening).
 *
 * CursorCliService.runExec has a split contract: it REJECTS on timeout/auth
 * but RESOLVES { success: false, error } on usage limits and bare CLI exits.
 * The client must surface that resolved-error shape — before this suite
 * existed, a usage-limit rendered as a silent empty assistant message.
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

const okResult = (text, sessionId = 'sess-1') => ({
  success: true,
  text,
  sessionId,
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe('CursorCliClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the CLI text as an assistant message', async () => {
    CursorCliService.runExec.mockResolvedValue(okResult('hello from cursor'));
    const client = createCursorCliClient({ userId: 'u1', conversationId: 'c1' });
    const res = await client.chat.completions.create({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.choices[0].message.content).toBe('hello from cursor');
    expect(res.choices[0].finish_reason).toBe('stop');
  });

  it('throws on the resolved { success: false } shape instead of returning empty content', async () => {
    CursorCliService.runExec.mockResolvedValue({
      success: false,
      error: 'cursor_exec: model usage limit reached. Try a different model (e.g. composer-2.5 or auto).',
      exitCode: 1,
    });
    const client = createCursorCliClient({ userId: 'u1', conversationId: 'c2' });
    await expect(
      client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/usage limit/);
  });

  it('throws a generic error when the failure shape carries no message', async () => {
    CursorCliService.runExec.mockResolvedValue({ success: false, exitCode: 1 });
    const client = createCursorCliClient({ userId: 'u1', conversationId: 'c3' });
    await expect(
      client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/no result/i);
  });

  it('propagates rejected errors (timeout/auth) untouched', async () => {
    CursorCliService.runExec.mockRejectedValue(new Error('cursor_exec: not authenticated. Run `cursor-agent login` in a terminal.'));
    const client = createCursorCliClient({ userId: 'u1', conversationId: 'c4' });
    await expect(
      client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/not authenticated/);
  });

  it('resumes with the stored session id on the second turn', async () => {
    CursorCliService.runExec.mockResolvedValue(okResult('first', 'sess-abc'));
    const client = createCursorCliClient({ userId: 'u1', conversationId: 'c5' });
    await client.chat.completions.create({ messages: [{ role: 'user', content: 'one' }] });

    CursorCliService.runExec.mockResolvedValue(okResult('second', 'sess-abc'));
    await client.chat.completions.create({ messages: [{ role: 'user', content: 'two' }] });

    const secondCall = CursorCliService.runExec.mock.calls[1][0];
    expect(secondCall.resume).toBe(true);
    expect(secondCall.sessionId).toBe('sess-abc');
  });

  it('does not store a session id from a failed run', async () => {
    CursorCliService.runExec.mockResolvedValue({ success: false, error: 'boom', sessionId: null });
    const client = createCursorCliClient({ userId: 'u1', conversationId: 'c6' });
    await expect(
      client.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow();

    CursorCliService.runExec.mockResolvedValue(okResult('recovered'));
    await client.chat.completions.create({ messages: [{ role: 'user', content: 'retry' }] });
    const retryCall = CursorCliService.runExec.mock.calls[1][0];
    expect(retryCall.resume).toBe(false);
  });
});
