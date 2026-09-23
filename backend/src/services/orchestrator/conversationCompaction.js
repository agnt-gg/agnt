/**
 * Conversation compaction — distil a long transcript into one summary the
 * model can carry on from.
 *
 * WHY THIS EXISTS
 * ---------------
 * Long histories can make it harder to retain the relevant working context.
 * The threshold for useful compression depends on the model and task. The context manager's
 * chunked eviction only fires at the wall, and what it leaves behind is a
 * one-line "Tools used / User topics" note. This is the deliberate,
 * user-triggered version: the history goes through the model ONCE, comes back
 * as a structured handoff, and every turn after that re-sends a few thousand
 * tokens instead of a hundred thousand.
 *
 * CACHE COST, STATED HONESTLY
 * ---------------------------
 * Prompt caching depends on the provider and adapter. Compression leaves the
 * system/tool definitions unchanged but replaces the history prefix, which
 * can invalidate cached history. Distillation has its own measured cost;
 * subsequent savings depend on the summary size and provider cache behavior.
 *
 * PURE MODULE. No HTTP, no DB, no provider client — the caller injects
 * `callModel`, which is what makes the chunking and merge logic testable
 * without a provider.
 */

import { estimateTokens, estimateMessagesTokens, groupMessageUnits } from '../../utils/contextManager.js';

/** Tool results are evidence, not prose; a few hundred tokens each is plenty. */
export const TOOL_RESULT_CHARS = 1500;

/** Share of the model's budget one distill request may occupy. */
const CHUNK_BUDGET_FRACTION = 0.6;

/** Default length asked of the summary when the caller has no opinion. */
export const DEFAULT_TARGET_TOKENS = 2500;

const SUMMARY_HEADINGS = [
  'Goal',
  'Decisions & reasons',
  'Current state',
  'Open threads & next step',
  'User preferences & corrections',
  'Retrievable data refs',
];

/**
 * Text of a content value that may be a string, a block array, or nothing.
 * Block arrays are what Anthropic tool_result / multimodal turns carry.
 */
export function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (typeof block === 'string') { parts.push(block); continue; }
    if (typeof block.text === 'string') { parts.push(block.text); continue; }
    if (typeof block.content === 'string') { parts.push(block.content); continue; }
    if (Array.isArray(block.content)) { parts.push(contentToText(block.content)); continue; }
    if (block.type && block.type !== 'text') parts.push(`[${block.type}]`);
  }
  return parts.join('\n');
}

function clip(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}\n[…${s.length - max} more chars]` : s;
}

/**
 * Render wire-format messages as a plain transcript the distiller reads.
 * Roles are labelled, tool calls show their name + arguments, tool results are
 * clipped. System messages are not part of the conversation and are skipped.
 */
export function renderTranscript(messages = []) {
  const lines = [];
  for (const msg of messages) {
    if (!msg || msg.role === 'system') continue;
    if (msg.role === 'user') {
      const label = msg.speaker?.type && msg.speaker.type !== 'human' ? `USER (${msg.speaker.name || msg.speaker.type})` : 'USER';
      lines.push(`${label}:\n${contentToText(msg.content)}`);
      continue;
    }
    if (msg.role === 'assistant') {
      const text = contentToText(msg.content);
      if (text.trim()) lines.push(`ASSISTANT:\n${text}`);
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const tc of calls) {
        const name = tc?.function?.name || tc?.name || 'tool';
        const args = tc?.function?.arguments ?? tc?.args ?? '';
        lines.push(`ASSISTANT → tool ${name}(${clip(typeof args === 'string' ? args : JSON.stringify(args), 600)})`);
      }
      continue;
    }
    if (msg.role === 'tool') {
      lines.push(`TOOL RESULT${msg.tool_call_id ? ` (${msg.tool_call_id})` : ''}:\n${clip(contentToText(msg.content), TOOL_RESULT_CHARS)}`);
    }
  }
  return lines.join('\n\n');
}

/**
 * The distill instruction. One prompt for both the single-shot and the
 * per-chunk case; `part` labels a chunk so the model knows it is seeing a
 * slice and must not pretend the conversation ended there.
 */
export function buildDistillPrompt({ transcript, targetTokens = DEFAULT_TARGET_TOKENS, part = null }) {
  const scope = part
    ? `This is part ${part.index} of ${part.total} of a longer conversation. Summarise ONLY what is in this part; do not guess at what came before or after.`
    : 'This is the whole conversation up to the point where it continues.';
  return [
    'You are compressing a conversation so the SAME assistant can keep working on it inside a much smaller context window. Write the handoff you would want to receive: after reading it, you must be able to continue exactly where things left off without the original transcript.',
    '',
    scope,
    '',
    'Rules:',
    '- Preserve verbatim every file path, identifier, URL, command, number, error message, name and decision that later work could depend on.',
    '- Never invent anything that is not in the transcript. If something is uncertain in the transcript, say it is uncertain.',
    '- Prefer omitting flourish over omitting facts. No preamble, no closing remarks.',
    '- Any {{DATA_REF:...}} ids mentioned are still retrievable with the query_data tool — list them so they are not lost.',
    '',
    'Format: markdown with exactly these headings, in this order. Leave a heading out only if there is genuinely nothing under it.',
    ...SUMMARY_HEADINGS.map((h) => `## ${h}`),
    '',
    `Target length: as short as possible without losing any of the above — roughly ${targetTokens} tokens.`,
    '',
    '=== TRANSCRIPT ===',
    transcript,
    '=== END TRANSCRIPT ===',
  ].join('\n');
}

/** Second pass when the history had to be chunked: fold N partials into one. */
export function buildMergePrompt({ partials, targetTokens = DEFAULT_TARGET_TOKENS }) {
  return [
    'Below are sequential partial summaries of ONE conversation, in order. Merge them into a single handoff summary for the same assistant to continue from.',
    '',
    'Rules:',
    '- Keep every path, identifier, URL, command, number, error message, name and decision verbatim. Later parts supersede earlier ones where they conflict — say so when a decision was reversed.',
    '- Never invent. No preamble, no closing remarks.',
    '',
    'Format: markdown with exactly these headings, in this order. Leave a heading out only if there is genuinely nothing under it.',
    ...SUMMARY_HEADINGS.map((h) => `## ${h}`),
    '',
    `Target length: roughly ${targetTokens} tokens.`,
    '',
    ...partials.map((p, i) => `=== PART ${i + 1} of ${partials.length} ===\n${p}`),
    '=== END PARTS ===',
  ].join('\n');
}

/**
 * Provider-agnostic text of a completion. Anthropic returns content blocks,
 * OpenAI-likes a string; DeepSeek wraps reasoning in <think> tags.
 */
export function extractResponseText(responseMessage) {
  let text = contentToText(responseMessage?.content);
  if (typeof text !== 'string') text = String(text || '');
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  }
  return text;
}

/**
 * Total token counts from a provider usage object, in the accumulator shape
 * the ledger and the executions table expect.
 *
 * Anthropic reports input_tokens as the UNCACHED portion only, so the true
 * total is input + cache_read + cache_creation. OpenAI-likes report
 * prompt_tokens as the full total with cached tokens as a subset. Same rule as
 * accumulateUsage() in OrchestratorService; kept here so a one-shot call
 * cannot count differently from a streamed turn.
 */
export function usageTotals(usage) {
  const u = usage || {};
  const outputTokens = Number(u.completion_tokens ?? u.output_tokens ?? u.outputTokens ?? 0) || 0;
  const cacheRead = Number(u.cache_read_input_tokens ?? u.cacheReadTokens ?? u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0) || 0;
  const cacheWrite = Number(u.cache_creation_input_tokens ?? u.cacheCreationTokens ?? 0) || 0;
  const write5m = Number(u.cache_creation_5m_input_tokens ?? u.cache_creation?.ephemeral_5m_input_tokens ?? 0) || 0;
  const write1h = Number(u.cache_creation_1h_input_tokens ?? u.cache_creation?.ephemeral_1h_input_tokens ?? 0) || 0;

  let inputTokens;
  if (u.cache_read_input_tokens != null || u.cache_creation_input_tokens != null) {
    inputTokens = (Number(u.input_tokens) || 0) + cacheRead + cacheWrite;
  } else {
    inputTokens = Number(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens ?? 0) || 0;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheWrite,
    cacheCreation5mTokens: write5m + write1h > 0 ? write5m : cacheWrite,
    cacheCreation1hTokens: write1h,
  };
}

function addUsage(into, usage) {
  const t = usageTotals(usage);
  for (const k of Object.keys(t)) into[k] = (into[k] || 0) + t[k];
  return into;
}

/**
 * Pack message units into chunks that each fit the distiller's budget.
 * Units (assistant + its tool results) are never split — a tool result without
 * its call is noise to the summariser.
 */
export function chunkMessages(messages, maxTokensPerChunk) {
  const units = groupMessageUnits(messages.filter((m) => m && m.role !== 'system'));
  const chunks = [];
  let current = [];
  let currentTokens = 0;
  for (const unit of units) {
    const unitTokens = estimateMessagesTokens(unit);
    if (current.length > 0 && currentTokens + unitTokens > maxTokensPerChunk) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(...unit);
    currentTokens += unitTokens;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Distil `messages` into one summary.
 *
 * @param {object} p
 * @param {Array}  p.messages          wire-format history (user/assistant/tool)
 * @param {Function} p.callModel       async (llmMessages) => { text, usage }
 * @param {number} p.contextBudgetTokens the model's available input budget
 * @param {number} [p.targetTokens]
 * @returns {Promise<{summary:string, usage:object, calls:number, chunks:number}>}
 */
export async function distillConversation({ messages, callModel, contextBudgetTokens, targetTokens = DEFAULT_TARGET_TOKENS }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Nothing to compress: the history is empty.');
  }
  if (typeof callModel !== 'function') throw new Error('callModel is required');

  const budget = Math.max(4000, Math.floor((Number(contextBudgetTokens) || 0) * CHUNK_BUDGET_FRACTION));
  const usage = {};
  let calls = 0;

  const ask = async (prompt) => {
    calls += 1;
    const { text, usage: callUsage } = await callModel([{ role: 'user', content: prompt }]);
    addUsage(usage, callUsage);
    const trimmed = (text || '').trim();
    if (!trimmed) throw new Error('The model returned an empty summary.');
    return trimmed;
  };

  const transcript = renderTranscript(messages);
  const promptOverhead = estimateTokens(buildDistillPrompt({ transcript: '', targetTokens }));
  const fits = estimateTokens(transcript) + promptOverhead <= budget;

  if (fits) {
    const summary = await ask(buildDistillPrompt({ transcript, targetTokens }));
    return { summary, usage, calls, chunks: 1 };
  }

  const chunks = chunkMessages(messages, Math.max(1000, budget - promptOverhead));
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    // A single unit larger than the budget cannot be split further; clip its
    // rendering so the request is still valid rather than failing outright.
    const rendered = clip(renderTranscript(chunks[i]), (budget - promptOverhead) * 4);
    partials.push(await ask(buildDistillPrompt({
      transcript: rendered,
      targetTokens,
      part: { index: i + 1, total: chunks.length },
    })));
  }
  const summary = partials.length === 1
    ? partials[0]
    : await ask(buildMergePrompt({ partials, targetTokens }));
  return { summary, usage, calls, chunks: chunks.length };
}
