import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, manageContext } from './contextManager.js';

describe('contextManager', () => {
  it('counts assistant tool call arguments when estimating message tokens', () => {
    const small = [{ role: 'assistant', content: '', tool_calls: [] }];
    const large = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'large_tool',
              arguments: 'x'.repeat(100_000),
            },
          },
        ],
      },
    ];

    expect(estimateMessagesTokens(large)).toBeGreaterThan(estimateMessagesTokens(small) + 20_000);
  });

  it('compresses oversized histories and keeps the summary in conversation messages', () => {
    const hugePayload = 'x'.repeat(700_000);
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Start' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'large_tool', arguments: hugePayload },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'large_tool',
        content: JSON.stringify({ success: true, data: hugePayload }),
      },
      { role: 'user', content: 'Continue' },
    ];

    const result = manageContext(messages, 'unknown-model', [], null);

    expect(result.wasManaged).toBe(true);
    expect(result.totalRequestTokens).toBeLessThan(result.contextWindow);
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toContain('Previous conversation');
  });
});
