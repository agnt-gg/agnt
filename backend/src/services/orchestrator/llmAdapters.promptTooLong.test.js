// Anthropic shrink-on-wall — the recovery Codex had and Anthropic didn't.
//
// A 400 "prompt is too long: N tokens > M maximum" was fatal on Anthropic:
// no retry can succeed unchanged, and the adapter had no path that changed
// anything. These tests pin the new behavior: parse the provider's own
// overshoot figure, drop oldest units (tool-pairing safe), retry.
import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from './llmAdapters.js';

const tooLongError = (real = 1_001_090, max = 1_000_000) => {
  const err = new Error(`prompt is too long: ${real} tokens > ${max} maximum`);
  err.status = 400;
  return err;
};

// system + N (user, assistant+tool_use, user+tool_result) triplets + live tail.
const buildMessages = (units = 25, charsPer = 4000) => {
  const messages = [{ role: 'system', content: 'system prompt' }];
  for (let i = 0; i < units; i++) {
    messages.push({ role: 'user', content: `question ${i} ` + 'q'.repeat(charsPer) });
    messages.push({
      role: 'assistant',
      content: [
        { type: 'text', text: `working on ${i}` },
        { type: 'tool_use', id: `tu_${i}`, name: 'web_search', input: { q: 'x'.repeat(charsPer) } },
      ],
    });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: 'r'.repeat(charsPer) }],
    });
  }
  messages.push({ role: 'user', content: 'the live question' });
  return messages;
};

describe('_isPromptTooLongError', () => {
  const adapter = new AnthropicAdapter({ messages: {} }, 'claude-opus-5');

  it('matches the exact production error', () => {
    expect(adapter._isPromptTooLongError(tooLongError())).toBe(true);
  });

  it('does not match other 400s or other statuses', () => {
    const other400 = new Error('unexpected tool_use_id found in tool_result blocks');
    other400.status = 400;
    expect(adapter._isPromptTooLongError(other400)).toBe(false);
    const overloaded = new Error('prompt is too long: 1 tokens > 0 maximum');
    overloaded.status = 529;
    expect(adapter._isPromptTooLongError(overloaded)).toBe(false);
    expect(adapter._isPromptTooLongError(null)).toBe(false);
  });
});

describe('_shrinkForPromptTooLong', () => {
  const adapter = new AnthropicAdapter({ messages: {} }, 'claude-opus-5');

  it('derives the drop target from the provider-reported overshoot', () => {
    const msgs = buildMessages(25);
    const { messages, dropped, overshoot } = adapter._shrinkForPromptTooLong(msgs, tooLongError());
    expect(overshoot).toBe(1090);
    expect(dropped).toBeGreaterThan(0);
    expect(messages.length).toBeLessThan(msgs.length);
  });

  it('never orphans a tool_result at the new front', () => {
    const msgs = buildMessages(25);
    const { messages } = adapter._shrinkForPromptTooLong(msgs, tooLongError(1_200_000));
    const firstNonSystem = messages.find((m) => m.role !== 'system');
    const hasToolResult = Array.isArray(firstNonSystem?.content) &&
      firstNonSystem.content.some((b) => b?.type === 'tool_result');
    expect(hasToolResult).toBe(false);
  });

  it('preserves system messages and the live tail', () => {
    const msgs = buildMessages(3);
    // Massive overshoot: tries to drop everything it is allowed to.
    const { messages } = adapter._shrinkForPromptTooLong(msgs, tooLongError(5_000_000));
    expect(messages.some((m) => m.role === 'system')).toBe(true);
    // The floor is ONE valid message, not two: with a huge overshoot on a
    // short history, the second-to-last message can be a tool_result whose
    // tool_use was dropped — keeping it to satisfy a count would guarantee
    // another 400. Validity beats quantity.
    expect(messages.filter((m) => m.role !== 'system').length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(messages)).toContain('the live question');
  });

  it('returns a NEW array — the canonical history is never mutated', () => {
    const msgs = buildMessages(10);
    const lenBefore = msgs.length;
    adapter._shrinkForPromptTooLong(msgs, tooLongError());
    expect(msgs.length).toBe(lenBefore);
  });

  it('handles an unparseable message with a proportional fallback drop', () => {
    const err = new Error('prompt is too long');
    err.status = 400;
    const { dropped } = adapter._shrinkForPromptTooLong(buildMessages(25), err);
    expect(dropped).toBeGreaterThan(0);
  });
});

describe('callStream shrink-retry loop', () => {
  it('retries with strictly fewer messages until shrink budget is exhausted, then resolves (never throws)', async () => {
    const calls = [];
    const stubClient = {
      messages: {
        stream: async (params) => {
          calls.push(params.messages.length);
          throw tooLongError();
        },
      },
    };
    const adapter = new AnthropicAdapter(stubClient, 'claude-opus-5', 'anthropic');
    const messages = buildMessages(25, 8000);
    const before = messages.length;

    const result = await adapter.callStream(messages, [], null, {});

    // Initial attempt + 4 shrink retries at minimum.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    // Every shrink retry sent strictly fewer messages.
    for (let i = 1; i <= 4; i++) {
      expect(calls[i]).toBeLessThan(calls[i - 1]);
    }
    // NEVER-STOPPING contract: resolves with an error message, not a throw.
    expect(result.responseMessage).toBeTruthy();
    // Caller's canonical array untouched.
    expect(messages.length).toBe(before);
  }, 30_000);

  it('a genuine transient error still uses the normal retry path untouched', async () => {
    let callCount = 0;
    const stubClient = {
      messages: {
        stream: async () => {
          callCount++;
          const err = new Error('Overloaded');
          err.status = 529;
          throw err;
        },
      },
    };
    const adapter = new AnthropicAdapter(stubClient, 'claude-opus-5', 'anthropic');
    adapter.baseDelay = 1; // don't sleep for real in tests
    const result = await adapter.callStream(buildMessages(2), [], null, {});
    expect(callCount).toBe(adapter.maxRetries + 1);
    expect(result.responseMessage).toBeTruthy();
  }, 30_000);
});
