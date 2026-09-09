import { describe, it, expect } from 'vitest';
import {
  renderTranscript,
  contentToText,
  extractResponseText,
  usageTotals,
  chunkMessages,
  distillConversation,
  buildDistillPrompt,
  TOOL_RESULT_CHARS,
} from './conversationCompaction.js';

const user = (content) => ({ role: 'user', content });
const assistant = (content, toolCalls = null) => ({
  role: 'assistant',
  content,
  ...(toolCalls ? { tool_calls: toolCalls } : {}),
});
const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const toolResult = (id, content) => ({ role: 'tool', tool_call_id: id, content });

describe('renderTranscript', () => {
  it('labels roles, shows tool calls with arguments, and skips system messages', () => {
    const text = renderTranscript([
      { role: 'system', content: 'SECRET SYSTEM PROMPT' },
      user('fix the build'),
      assistant('Looking now.', [toolCall('c1', 'read_file', { path: 'a.js' })]),
      toolResult('c1', 'contents of a.js'),
      assistant('Done.'),
    ]);
    expect(text).not.toContain('SECRET SYSTEM PROMPT');
    expect(text).toContain('USER:\nfix the build');
    expect(text).toContain('ASSISTANT:\nLooking now.');
    expect(text).toContain('read_file({"path":"a.js"})');
    expect(text).toContain('TOOL RESULT (c1):\ncontents of a.js');
    expect(text).toContain('ASSISTANT:\nDone.');
  });

  it('clips oversized tool results but never user or assistant prose', () => {
    const big = 'x'.repeat(TOOL_RESULT_CHARS * 3);
    const text = renderTranscript([user(big), toolResult('c1', big)]);
    // The user turn survives whole; the tool result is clipped with a marker.
    expect(text).toContain(`USER:\n${big}`);
    expect(text).toContain('more chars]');
    expect(text.length).toBeLessThan(big.length * 2);
  });

  it('flattens block-array content (Anthropic tool_result / multimodal turns)', () => {
    expect(contentToText([{ type: 'text', text: 'hello' }, { type: 'image' }, 'raw'])).toBe('hello\n[image]\nraw');
    expect(contentToText(null)).toBe('');
  });

  it('attributes foreign speakers in group chat rather than calling them the user', () => {
    const text = renderTranscript([{ role: 'user', content: 'hi', speaker: { type: 'agent', name: 'Fable' } }]);
    expect(text).toContain('USER (Fable):');
  });
});

describe('extractResponseText', () => {
  it('reads Anthropic block arrays and OpenAI strings alike', () => {
    expect(extractResponseText({ content: [{ type: 'text', text: '## Goal\nship' }] })).toBe('## Goal\nship');
    expect(extractResponseText({ content: '## Goal\nship' })).toBe('## Goal\nship');
  });

  it('strips <think> reasoning and code fences', () => {
    expect(extractResponseText({ content: '<think>hmm</think>\n```markdown\n## Goal\n```' })).toBe('## Goal');
  });
});

describe('usageTotals', () => {
  it('counts Anthropic input as uncached + cache_read + cache_creation', () => {
    const t = usageTotals({ input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 10 });
    expect(t.inputTokens).toBe(1050);
    expect(t.outputTokens).toBe(10);
    expect(t.totalTokens).toBe(1060);
    expect(t.cacheReadTokens).toBe(900);
    expect(t.cacheCreationTokens).toBe(50);
    expect(t.cacheCreation5mTokens).toBe(50);
  });

  it('takes OpenAI prompt_tokens as the full total', () => {
    const t = usageTotals({ prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 300 } });
    expect(t.inputTokens).toBe(1000);
    expect(t.cacheReadTokens).toBe(300);
    expect(t.totalTokens).toBe(1020);
  });

  it('tolerates a missing usage object', () => {
    expect(usageTotals(undefined).totalTokens).toBe(0);
  });
});

describe('chunkMessages', () => {
  it('never separates an assistant tool call from its result', () => {
    // Each unit is ~ 1 assistant + 1 tool result of ~400 chars → ~100 tokens.
    const msgs = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(user(`q${i}`));
      msgs.push(assistant('', [toolCall(`c${i}`, 't', {})]));
      msgs.push(toolResult(`c${i}`, 'r'.repeat(400)));
    }
    const chunks = chunkMessages(msgs, 250);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const m of chunk) {
        if (m.role === 'tool') {
          const owner = chunk.find((x) => x.role === 'assistant' && (x.tool_calls || []).some((tc) => tc.id === m.tool_call_id));
          expect(owner).toBeTruthy();
        }
      }
    }
    // Nothing lost, nothing duplicated.
    expect(chunks.flat().length).toBe(msgs.length);
  });
});

describe('distillConversation', () => {
  it('makes exactly one call when the transcript fits the budget', async () => {
    const calls = [];
    const callModel = async (m) => { calls.push(m); return { text: '## Goal\nship it', usage: { prompt_tokens: 50, completion_tokens: 5 } }; };
    const out = await distillConversation({
      messages: [user('a'), assistant('b')],
      callModel,
      contextBudgetTokens: 100000,
    });
    expect(calls.length).toBe(1);
    expect(out.chunks).toBe(1);
    expect(out.summary).toBe('## Goal\nship it');
    expect(out.usage.inputTokens).toBe(50);
    expect(out.usage.outputTokens).toBe(5);
    expect(out.usage.totalTokens).toBe(55);
  });

  it('chunks, summarises each part, then merges — and sums usage across every call', async () => {
    const prompts = [];
    const callModel = async (m) => {
      prompts.push(m[0].content);
      return { text: `part-${prompts.length}`, usage: { prompt_tokens: 10, completion_tokens: 1 } };
    };
    const msgs = [];
    for (let i = 0; i < 12; i++) { msgs.push(user('u'.repeat(2000))); msgs.push(assistant('a'.repeat(2000))); }
    const out = await distillConversation({ messages: msgs, callModel, contextBudgetTokens: 8000 });
    expect(out.chunks).toBeGreaterThan(1);
    expect(out.calls).toBe(out.chunks + 1);
    // Chunk prompts say which part they are; the merge prompt carries the parts.
    expect(prompts[0]).toMatch(/part 1 of \d+/);
    expect(prompts[prompts.length - 1]).toContain('=== PART 1 of');
    expect(out.usage.inputTokens).toBe(10 * out.calls);
    expect(out.summary).toBe(`part-${out.calls}`);
  });

  it('refuses an empty history and an empty model reply', async () => {
    await expect(distillConversation({ messages: [], callModel: async () => ({}), contextBudgetTokens: 1000 }))
      .rejects.toThrow(/empty/i);
    await expect(distillConversation({
      messages: [user('a')],
      callModel: async () => ({ text: '   ', usage: {} }),
      contextBudgetTokens: 100000,
    })).rejects.toThrow(/empty summary/i);
  });

  it('asks for the structured headings and the target length', () => {
    const p = buildDistillPrompt({ transcript: 'T', targetTokens: 1234 });
    expect(p).toContain('## Goal');
    expect(p).toContain('## Retrievable data refs');
    expect(p).toContain('roughly 1234 tokens');
    expect(p).toContain('=== TRANSCRIPT ===\nT\n=== END TRANSCRIPT ===');
  });
});
