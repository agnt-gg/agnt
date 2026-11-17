import { describe, it, expect, beforeAll } from 'vitest';
import { manageContext, estimateMessagesTokens, updateEstimateCalibration } from '../../utils/contextManager.js';
import { AnthropicAdapter, OpenAIResponsesAdapter, GeminiAdapter } from './llmAdapters.js';
import { BaseAdapter } from './transports/BaseAdapter.js';

/**
 * The eviction watermark at every provider's wire.
 *
 * manageContext is shared by all providers, but what the provider caches is
 * the request after that provider's own transform, and each provider has its
 * own budget and its own ledger shape for a tool round. So this runs one long
 * conversation per provider the adapter factory accepts, sized against that
 * provider's budget, through the loop the orchestrator runs: manage, send,
 * fold the size the provider reports into the calibration for the next
 * request. The reported size is lower for the evicted view than for the full
 * history, which is the case where a watermark released on "it fits" comes
 * and goes.
 */

const anthropicWire = (model) => (messages) => new AnthropicAdapter({ messages: { create: async () => ({}) } }, model)
  ._normalizeHistoryMessages(structuredClone(messages.filter((m) => m.role !== 'system')));
const chatCompletionsWire = () => (messages) => BaseAdapter._sanitizeOutbound(structuredClone(messages), 'openai-like');
const responsesWire = (model, provider) => (messages) => {
  const out = new OpenAIResponsesAdapter({}, model, { provider })._transformMessagesToInput(structuredClone(messages));
  return (Array.isArray(out) ? out : out.input).flat();
};
const geminiWire = (model) => (messages) => new GeminiAdapter({}, model)._transformToGemini(structuredClone(messages)).geminiMessages;

// One tool round in the ledger shape each adapter writes.
const toolRound = {
  anthropic: (n, body) => [
    { role: 'assistant', content: [{ type: 'text', text: `step ${n}` }, { type: 'tool_use', id: `toolu_${n}`, name: 'read_file', input: { n } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: body }] },
  ],
  openai: (n, body) => [
    { role: 'assistant', content: `step ${n}`, tool_calls: [{ id: `call_${n}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ n }) } }] },
    { role: 'tool', tool_call_id: `call_${n}`, name: 'read_file', content: body },
  ],
  gemini: (n, body) => [
    { role: 'assistant', content: `step ${n}`, tool_calls: [{ id: `gemini-tool-${n}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ n }) } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { result: body } } }] },
  ],
};

// [provider, model, ledger shape, wire, budget options]. A row per provider key
// in createLlmAdapter, plus the second transport or ledger shape of the
// providers that have one. The budget is whatever getContextBudget resolves
// for the pair, so a model that leaves the catalog only changes the size of
// its row. Windows here run from 16K to 2M.
const PROVIDERS = [
  ['claude-code', 'claude-opus-5-5', 'anthropic', anthropicWire('claude-opus-5-5')],
  ['anthropic', 'claude-opus-4-6', 'anthropic', anthropicWire('claude-opus-4-6')],
  ['anthropic', 'claude-opus-4-6', 'openai', anthropicWire('claude-opus-4-6')],
  ['gemini', 'gemini-3.1-pro-preview', 'gemini', geminiWire('gemini-3.1-pro-preview')],
  ['antigravity', 'claude-sonnet-4-6', 'gemini', geminiWire('claude-sonnet-4-6')],
  ['openai', 'gpt-5.2', 'openai', responsesWire('gpt-5.2', 'openai')],
  ['openai', 'gpt-4o', 'openai', chatCompletionsWire()],
  ['openai-codex', 'gpt-6-astra', 'openai', responsesWire('gpt-6-astra', 'openai-codex')],
  ['cerebras', 'qwen-3.8-27b', 'openai', chatCompletionsWire()],
  ['deepseek', 'deepseek-chat', 'openai', chatCompletionsWire()],
  ['grokai', 'grok-4-1-fast-reasoning', 'openai', chatCompletionsWire()],
  ['grok-build', 'grok-4.7', 'openai', chatCompletionsWire()],
  ['cursor-cli', 'claude-opus-5-high', 'openai', chatCompletionsWire()],
  ['groq', 'qwen/qwen3.8-27b', 'openai', chatCompletionsWire()],
  ['kimi', 'kimi-k2.7-code', 'openai', chatCompletionsWire()],
  ['kimi-code', 'kimi-for-coding', 'openai', chatCompletionsWire()],
  ['chutes', 'moonshotai/Kimi-K2.6-TEE', 'openai', chatCompletionsWire()],
  ['minimax', 'MiniMax-M2.7-highspeed', 'openai', chatCompletionsWire()],
  ['agnt', 'agnt-flash', 'openai', chatCompletionsWire()],
  ['openrouter', 'meta-llama/llama-3.3-70b-instruct', 'openai', chatCompletionsWire()],
  ['togetherai', 'deepseek-ai/DeepSeek-V4.1-Flash', 'openai', chatCompletionsWire()],
  ['zai', 'glm-5.1', 'openai', chatCompletionsWire()],
  // A loaded local model: the window and the calibration come from the server, per request.
  ['local', 'local-model', 'openai', chatCompletionsWire(), { contextWindow: 16_384, outputBuffer: 1024 }],
  // A custom OpenAI-compatible provider is keyed by its id and has no catalog entry.
  ['3f2b6c1e-8d47-4a0b-9c5e-7a1d2e3f4b5c', 'custom-model', 'openai', chatCompletionsWire()],
];

const FULL_HISTORY_RATIO = 1.1;
const EVICTED_VIEW_RATIO = 0.9;
// Each tool round is 2% of the budget, whatever its size, so the history
// spends several requests between the tighter budget and the looser one.
const UNITS_TO_FILL = 50;
const START_SHARE = 0.92; // of the tighter budget: the conversation starts just under it
const ROUNDS = 40;
// Wire items are serialized once per request and compared as strings.
const isPrefix = (previous, next) => previous.length <= next.length && previous.every((item, k) => item === next[k]);
const startsWithToolResult = (message) => message.role === 'tool'
  || (Array.isArray(message.content) && message.content.some((block) => block?.type === 'tool_result'));

function runConversation(provider, model, shape, wireOf, budgetOptions = {}) {
  const manage = (messages, options) => manageContext(messages, model, [], provider, { ...budgetOptions, ...options });
  const budget = manage([{ role: 'user', content: 'x' }], {}).tokenLimit;
  // Estimates are chars / 3.5 * 1.12, so this many characters is one unit's share of the budget.
  const unitChars = Math.max(40, Math.round((budget / UNITS_TO_FILL) * 3.5 / 1.12));
  const messages = [
    { role: 'system', content: 'You are Annie. '.repeat(Math.max(1, Math.round(unitChars / 30))) },
    { role: 'user', content: 'Work through the task.' },
  ];
  let watermark = 0;
  let calibration = FULL_HISTORY_RATIO;
  let previousWire = null;
  const seen = { budget, firstRequestEvicted: null, cuts: 0, movedBack: 0, overBudget: 0, wirePrefixBreaks: 0, orphanedResults: 0, evictedRequests: 0 };

  let unit = 0;
  const appendToolRound = () => {
    unit += 1;
    messages.push(...toolRound[shape](unit, `result ${unit} ${'r'.repeat(unitChars)}`));
  };
  // Measured, not counted: per-message overhead is a real share of a small window.
  while (estimateMessagesTokens(messages) < (budget / FULL_HISTORY_RATIO) * START_SHARE) appendToolRound();
  messages.splice(-2); // the round that crossed the starting size

  for (let round = 1; round <= ROUNDS; round++) {
    appendToolRound();
    const result = manage(messages, { calibration: Math.max(1, calibration), evictedUnits: watermark });
    if (round === 1) seen.firstRequestEvicted = result.evictedUnits > 0;
    if (result.evictedUnits < watermark) seen.movedBack += 1;
    const cutThisRound = result.evictedUnits > watermark;
    if (cutThisRound) seen.cuts += 1;
    if (result.evictedUnits > 0) seen.evictedRequests += 1;
    if (estimateMessagesTokens(result.messages) > result.tokenLimit) seen.overBudget += 1;
    const firstKept = result.messages.find((m) => m.role !== 'system');
    if (startsWithToolResult(firstKept)) seen.orphanedResults += 1;

    const wire = wireOf(result.messages).map((item) => JSON.stringify(item));
    if (previousWire && !isPrefix(previousWire, wire)) seen.wirePrefixBreaks += 1;
    previousWire = wire;

    watermark = result.evictedUnits;
    const ratio = watermark > 0 ? EVICTED_VIEW_RATIO : FULL_HISTORY_RATIO;
    // A local server measures the calibration afresh for each request; every
    // other provider's is folded in from the usage it reports.
    calibration = budgetOptions.contextWindow
      ? ratio
      : updateEstimateCalibration(calibration, { input_tokens: Math.round(result.totalRequestTokens * ratio) }, result.totalRequestTokens);
  }
  return seen;
}

describe.each(PROVIDERS)('eviction watermark at the wire: %s / %s (%s ledger)', (provider, model, shape, wireOf, budgetOptions) => {
  let seen;
  beforeAll(() => {
    seen = runConversation(provider, model, shape, wireOf, budgetOptions);
  });

  it('starts under the budget and crosses it more than once', () => {
    expect(seen.budget).toBeGreaterThan(0);
    expect(seen.firstRequestEvicted).toBe(false);
    expect(seen.cuts).toBeGreaterThan(1);
  });

  it('never moves the cut back, and stays evicted once cut', () => {
    expect(seen.movedBack).toBe(0);
    expect(seen.evictedRequests).toBeGreaterThan(ROUNDS / 2);
  });

  it('changes the wire prefix at a cut and nowhere else', () => {
    expect(seen.wirePrefixBreaks).toBe(seen.cuts);
  });

  it('never sends more than the budget', () => {
    expect(seen.overBudget).toBe(0);
  });

  // Only for the two shapes groupMessageUnits pairs. A Gemini tool result is
  // a user message with `parts`, which it treats as a unit of its own.
  if (shape !== 'gemini') {
    it('never starts the kept history with a tool result whose call was evicted', () => {
      expect(seen.orphanedResults).toBe(0);
    });
  }
});
