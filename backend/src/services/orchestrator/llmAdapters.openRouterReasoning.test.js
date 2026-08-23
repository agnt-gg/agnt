/**
 * Regression gate: OpenRouter spells thinking deltas `reasoning`, not
 * `reasoning_content`.
 *
 * WHAT HAPPENED (measured 2026-08-23, execution afe13d78-492a-4bc6-be83-a74af515d7eb)
 * -----------------------------------------------------------------------------------
 * Nathan sent "keep going pls" on `openrouter / stealth/ox-alpha`. The run
 * burned 50 seconds, reported status `completed`, and delivered
 * `final_response: ""` with zero tool calls. Re-sent on Claude it answered
 * immediately, so it read as "the model is broken".
 *
 * The model was fine. A live capture of the raw SSE for that model shows:
 *
 *   delta = {"content":"","role":"assistant","reasoning":"17",
 *            "reasoning_details":[{"type":"reasoning.text","text":"17",...}]}
 *
 * `reasoning` — never `reasoning_content`. OpenRouter normalises EVERY
 * reasoning model it routes onto that spelling, whoever built the model.
 * `reasoning_content` is DeepSeek's spelling, which Z.AI, Kimi/Moonshot and
 * Chutes copied. The stream handler read only the DeepSeek spelling, so for
 * the entire OpenRouter reasoning surface:
 *
 *  1. `accumulatedReasoningContent` stayed '' no matter how long a model
 *     thought — no `reasoning` chunk ever reached the frontend, so the UI sat
 *     silent through minute-long thinking phases and looked hung. Measured on
 *     the live orchestrator: 150s, 118 SSE events, ZERO reasoning_delta.
 *  2. The "no content, but we do have reasoning" fallback further down
 *     inspects that same buffer, so it could never fire. A model that answered
 *     entirely in its reasoning channel reached the user as an EMPTY assistant
 *     message — exactly what afe13d78 recorded.
 *
 * stealth/ox-alpha made it unmissable rather than causing it: its OpenRouter
 * card carries `reasoning.mandatory: true` with `default_effort: "max"`, so
 * reasoning cannot be switched off and every single turn took the broken path.
 *
 * Both spellings are pinned below, plus the empty-content case that produced
 * the silent failure.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAiLikeAdapter } from './llmAdapters.js';

function streamOf(chunks) {
  return {
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
    abort() {},
  };
}

/** Build an OpenAI-shaped stream chunk carrying one delta. */
const chunk = (delta, finish_reason = null) => ({
  choices: [{ index: 0, delta, finish_reason }],
});

function adapterFor(chunks, model = 'stealth/ox-alpha') {
  const client = {
    chat: { completions: { create: vi.fn(async () => streamOf(chunks)) } },
  };
  return new OpenAiLikeAdapter(client, model, { provider: 'openrouter' });
}

const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
};

async function runStream(adapter, tools = []) {
  const seen = [];
  const result = await adapter.callStream([{ role: 'user', content: 'hi' }], tools, (c) => seen.push(c));
  return { result, seen };
}

describe('OpenRouter reasoning deltas', () => {
  // The exact wire shape captured from stealth/ox-alpha: `reasoning` alongside
  // an empty-string `content` on every thinking chunk.
  const OX_ALPHA_THINKING = [
    chunk({ role: 'assistant', content: '', reasoning: '17' }),
    chunk({ content: '', reasoning: ' * 23 = 39' }),
    chunk({ content: '', reasoning: '1' }),
    chunk({ content: '391' }),
    chunk({}, 'stop'),
  ];

  it('streams `delta.reasoning` to the frontend as a reasoning chunk', async () => {
    const { seen } = await runStream(adapterFor(OX_ALPHA_THINKING));

    const reasoning = seen.filter((c) => c.type === 'reasoning');
    expect(
      reasoning.length,
      'OpenRouter thinking must reach the UI; zero chunks is the silent-stall bug',
    ).toBe(3);
    expect(reasoning.map((c) => c.delta).join('')).toBe('17 * 23 = 391');
    expect(reasoning.at(-1).accumulated).toBe('17 * 23 = 391');
  });

  it('still streams the DeepSeek/Z.AI `delta.reasoning_content` spelling', async () => {
    const { seen } = await runStream(adapterFor([
      chunk({ role: 'assistant', reasoning_content: 'think' }),
      chunk({ reasoning_content: 'ing' }),
      chunk({ content: 'done' }),
      chunk({}, 'stop'),
    ], 'z-ai/glm-5.2'));

    const reasoning = seen.filter((c) => c.type === 'reasoning');
    expect(reasoning.map((c) => c.delta).join('')).toBe('thinking');
  });

  it('carries reasoning through to the assistant message', async () => {
    const { result } = await runStream(adapterFor(OX_ALPHA_THINKING));
    expect(result.responseMessage.content).toBe('391');
    expect(result.responseMessage.reasoning_content).toBe('17 * 23 = 391');
  });

  it('an empty-string content delta never counts as content', async () => {
    // ox-alpha sends `content: ''` on EVERY thinking chunk. If that were
    // treated as content the reasoning fallback would be suppressed.
    const { result } = await runStream(adapterFor(OX_ALPHA_THINKING));
    expect(result.responseMessage.content).toBe('391');
  });

  it('falls back to reasoning when the model answers with reasoning only', async () => {
    // THE afe13d78 SHAPE: reasoning arrives, content never does, finish_reason
    // is a clean 'stop'. Before the fix this returned '' and the user saw a
    // blank reply after 50 seconds of waiting.
    const { result } = await runStream(adapterFor([
      chunk({ role: 'assistant', content: '', reasoning: 'The answer is 391.' }),
      chunk({}, 'stop'),
    ]));

    expect(
      result.responseMessage.content,
      'reasoning-only response must not reach the user as an empty message',
    ).toBe('The answer is 391.');
  });

  it('does not mistake reasoning for content when tool calls are present', async () => {
    // finish_reason 'tool_calls' with empty content is CORRECT — the model
    // called a tool. The fallback must not overwrite that with its thinking.
    // The tool MUST be declared here — an undeclared call fails AJV validation
    // and the adapter retries with schema guidance, which is a different code
    // path than the one under test.
    const { result } = await runStream(adapterFor([
      chunk({ role: 'assistant', content: '', reasoning: 'I should search.' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"btc"}' } }] }),
      chunk({}, 'tool_calls'),
    ]), [WEB_SEARCH_TOOL]);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('web_search');
    expect(result.responseMessage.content ?? '').not.toBe('I should search.');
  });
});
