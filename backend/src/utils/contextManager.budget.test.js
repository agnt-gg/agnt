import { describe, expect, it } from 'vitest';
import { estimateTokens, estimateToolTokens, manageContext } from './contextManager.js';
import { registerDynamicPricing } from '../services/ai/providerConfigs.js';

/**
 * The shared layer-1 gate. It runs for EVERY provider, and its output is what
 * goes on the wire (OrchestratorService hands contextResult.messages straight
 * to the adapter). Two defects lived here:
 *
 *   1. Tool schemas were counted with the prose ratio — a 1.52x overcount that
 *      drove availableTokens negative on every model with a <=200k window,
 *      clamped the budget to 1,000 tokens, and made Strategy 4 destroy chats
 *      as short as two turns on 55 of 111 tool-capable models.
 *   2. Strategy 4 truncated the system prompt CONCURRENTLY with dropping
 *      messages, and did so by mutating the caller's own message object.
 */

function bigToolSurface(count = 295) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'function',
    function: {
      name: `tool_${i}`,
      description: `Tool ${i}. ${'Structured JSON schema description text. '.repeat(20)}`,
      parameters: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] },
    },
  }));
}

describe('estimateToolTokens', () => {
  it('scores dense JSON schemas well below the prose estimator', () => {
    const tools = bigToolSurface();
    const asSchema = estimateToolTokens(tools);
    const asProse = estimateTokens(JSON.stringify(tools));

    expect(asSchema).toBeLessThan(asProse);
    // The prose ratio overcounts schemas by ~1.5x; anything under 1.2x here
    // means the two estimators have drifted back together.
    expect(asProse / asSchema).toBeGreaterThan(1.2);
  });

  it('handles empty and malformed input without throwing', () => {
    expect(estimateToolTokens(null)).toBe(0);
    expect(estimateToolTokens([])).toBeGreaterThanOrEqual(0);
    const cyclic = {}; cyclic.self = cyclic;
    expect(() => estimateToolTokens([cyclic])).not.toThrow();
  });
});

describe('manageContext — conversation survival', () => {
  it('keeps a short chat intact on a 200k model carrying a large tool surface', () => {
    registerDynamicPricing('anthropic', 'budget-test-200k', { contextWindow: 200_000 });
    const system = 'You are a helpful assistant. '.repeat(700);
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: 'My favourite colour is teal.' },
      { role: 'assistant', content: 'Noted.' },
      { role: 'user', content: 'What is my favourite colour?' },
    ];

    const result = manageContext(messages, 'budget-test-200k', bigToolSurface(), 'anthropic');
    const kept = result.messages.filter((m) => m.role !== 'system');

    expect(kept).toHaveLength(3);
    expect(String(result.messages.find((m) => m.role === 'system').content)).toHaveLength(system.length);
  });

  it('never truncates the system prompt while droppable messages remain', () => {
    registerDynamicPricing('groq', 'budget-test-small', { contextWindow: 60_000 });
    const system = 'Operating instructions. '.repeat(200);
    const filler = 'x'.repeat(60_000);
    const messages = [
      { role: 'system', content: system },
      ...Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${filler} turn ${i}` })),
      { role: 'user', content: 'final question' },
    ];

    const originalMessageChars = messages
      .filter((m) => m.role !== 'system')
      .reduce((n, m) => n + String(m.content).length, 0);

    const result = manageContext(messages, 'budget-test-small', [], 'groq');
    const sysOut = result.messages.find((m) => m.role === 'system');
    const managedMessageChars = result.messages
      .filter((m) => m.role !== 'system')
      .reduce((n, m) => n + String(m.content).length, 0);

    // Messages absorbed the pressure (whether by truncation or by dropping
    // whole turns); the operating instructions survived completely intact.
    expect(result.wasManaged).toBe(true);
    expect(managedMessageChars).toBeLessThan(originalMessageChars);
    expect(String(sysOut.content)).toHaveLength(system.length);
  });

  it('does not mutate the caller\'s system message when a last-resort shrink is unavoidable', () => {
    registerDynamicPricing('groq', 'budget-test-tiny', { contextWindow: 20_000 });
    const system = 'Very long operating instructions. '.repeat(2_000);
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: 'hello' },
    ];
    const callerSystemRef = messages[0];

    const result = manageContext(messages, 'budget-test-tiny', [], 'groq');

    // The shrink is legitimate here (the prompt alone exceeds the window), but
    // it must not write through to the caller's array — OrchestratorService
    // persists that verbatim to conversation_logs.full_history.
    expect(callerSystemRef.content).toBe(system);
    expect(messages[0].content).toHaveLength(system.length);
    const sysOut = result.messages.find((m) => m.role === 'system');
    expect(String(sysOut.content).length).toBeLessThan(system.length);
  });
});
