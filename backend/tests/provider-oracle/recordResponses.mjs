/**
 * THE RESPONSE ORACLE — records what each adapter turns a provider reply INTO.
 *
 * Companion to the wire oracle, and the prerequisite for splitting the
 * transports. The wire oracle proves the REQUEST is unchanged; this proves the
 * RESPONSE handling is: accumulated text, reassembled tool calls, extracted
 * usage, reasoning blocks, replay payloads and stop reasons.
 *
 * Without it, a transport split could silently corrupt tool-call assembly on
 * 14 providers and every existing test would still pass.
 *
 * Run:   node backend/tests/provider-oracle/recordResponses.mjs
 * Check: node backend/tests/provider-oracle/recordResponses.mjs --check
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createLlmAdapter } from '../../src/services/orchestrator/llmAdapters.js';
import {
  streamOf, CHAT_COMPLETIONS, ANTHROPIC, ANTHROPIC_NONSTREAM,
  RESPONSES, RESPONSES_NONSTREAM, GEMINI, GEMINI_NONSTREAM,
} from './responseFixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(__dirname, 'response-goldens.json');
const CHECK = process.argv.includes('--check');

/** Fake clients, one per SDK surface, that replay a canned response. */
const clients = {
  chatCompletions: (chunks) => ({
    chat: { completions: { create: async () => streamOf(chunks) } },
  }),
  chatCompletionsSync: (response) => ({
    chat: { completions: { create: async () => response } },
  }),
  anthropicStream: (events) => ({
    messages: {
      stream: async () => streamOf(events),
      create: async () => ANTHROPIC_NONSTREAM.plainText,
    },
  }),
  anthropicSync: (response) => ({
    messages: { create: async () => response, stream: async () => streamOf([]) },
  }),
  // Keys off `params.stream`, because call() and callStream() share this
  // endpoint and the adapter distinguishes them by that flag. Always returning
  // a stream left `response.output` undefined on the call() path, so its
  // replay-item capture never ran and a control that broke it stayed green.
  responses: (events, scenario) => ({
    responses: {
      create: async (params) => (params?.stream
        ? streamOf(events)
        : (RESPONSES_NONSTREAM[scenario] || RESPONSES_NONSTREAM.plainText)),
    },
  }),
  gemini: (chunks) => ({
    models: {
      generateContentStream: async () => streamOf(chunks),
      generateContent: async () => GEMINI_NONSTREAM.plainText,
    },
  }),
  geminiSync: (response) => ({
    models: {
      generateContent: async () => response,
      generateContentStream: async () => streamOf([]),
    },
  }),
};

/**
 * Every (provider, model, scenario) the oracle drives. One representative
 * provider per transport keeps the matrix readable; the transports are what
 * differ, not the 14 providers that share one.
 */
const CASES = [
  // chatCompletions — the transport 14 providers share
  ['groq', 'openai/gpt-oss-120b', 'plainText', 'chatCompletions', CHAT_COMPLETIONS.plainText],
  ['groq', 'openai/gpt-oss-120b', 'toolCall', 'chatCompletions', CHAT_COMPLETIONS.toolCall],
  ['groq', 'openai/gpt-oss-120b', 'parallelToolCalls', 'chatCompletions', CHAT_COMPLETIONS.parallelToolCalls],
  ['kimi', 'kimi-k2-turbo-preview', 'usageChunkWithoutChoices', 'chatCompletions', CHAT_COMPLETIONS.usageChunkWithoutChoices],
  ['deepseek', 'deepseek-chat', 'withReasoning', 'chatCompletions', CHAT_COMPLETIONS.withReasoning],
  ['openrouter', 'anthropic/claude-haiku-4.5', 'plainText', 'chatCompletions', CHAT_COMPLETIONS.plainText],
  ['grokai', 'grok-4-0709', 'toolCall', 'chatCompletions', CHAT_COMPLETIONS.toolCall],
  ['togetherai', 'openai/gpt-oss-120b', 'emptyResponse', 'chatCompletions', CHAT_COMPLETIONS.emptyResponse],
  ['zai', 'glm-4.5-air', 'plainText', 'chatCompletions', CHAT_COMPLETIONS.plainText],
  ['minimax', 'MiniMax-M2.1', 'plainText', 'chatCompletions', CHAT_COMPLETIONS.plainText],
  ['chutes', 'zai-org/GLM-5-FP8', 'toolCall', 'chatCompletions', CHAT_COMPLETIONS.toolCall],

  // cerebras — its own subclass of the same transport
  ['cerebras', 'gpt-oss-120b', 'plainText', 'chatCompletions', CHAT_COMPLETIONS.plainText],
  ['cerebras', 'gpt-oss-120b', 'toolCall', 'chatCompletions', CHAT_COMPLETIONS.toolCall],
  ['cerebras', 'gpt-oss-120b', 'usageChunkWithoutChoices', 'chatCompletions', CHAT_COMPLETIONS.usageChunkWithoutChoices],

  // anthropicMessages
  ['anthropic', 'claude-opus-4-8', 'plainText', 'anthropicStream', ANTHROPIC.plainText],
  ['anthropic', 'claude-opus-4-8', 'toolCall', 'anthropicStream', ANTHROPIC.toolCall],
  ['anthropic', 'claude-opus-4-8', 'withThinking', 'anthropicStream', ANTHROPIC.withThinking],
  ['anthropic', 'claude-opus-4-8', 'textThenTool', 'anthropicStream', ANTHROPIC.textThenTool],
  ['claude-code', 'claude-opus-4-8', 'plainText', 'anthropicStream', ANTHROPIC.plainText],
  ['claude-code', 'claude-opus-4-8', 'toolCall', 'anthropicStream', ANTHROPIC.toolCall],

  // openaiResponses
  ['openai', 'gpt-5.6', 'plainText', 'responses', RESPONSES.plainText],
  ['openai', 'gpt-5.6', 'toolCall', 'responses', RESPONSES.toolCall],
  ['openai', 'gpt-5.6', 'withReasoning', 'responses', RESPONSES.withReasoning],
  ['openai-codex', 'gpt-5.6-sol', 'plainText', 'responses', RESPONSES.plainText],
  ['openai-codex', 'gpt-5.6-sol', 'toolCall', 'responses', RESPONSES.toolCall],
  ['openai-codex', 'gpt-5.6-sol', 'withReasoning', 'responses', RESPONSES.withReasoning],

  // gemini
  ['gemini', 'gemini-2.5-flash', 'plainText', 'gemini', GEMINI.plainText],
  ['gemini', 'gemini-2.5-flash', 'toolCall', 'gemini', GEMINI.toolCall],
  ['gemini', 'gemini-2.5-flash', 'snakeCaseUsage', 'gemini', GEMINI.snakeCaseUsage],
  ['gemini', 'gemini-2.5-flash', 'withThoughtSignature', 'gemini', GEMINI.withThoughtSignature],
  ['gemini-cli', 'gemini-2.5-flash', 'plainText', 'gemini', GEMINI.plainText],
  ['antigravity', 'gemini-3.6-flash-low', 'plainText', 'gemini', GEMINI.plainText],
];

/**
 * Normalize an adapter result into the shape the oracle compares.
 *
 * Deliberately records the SEMANTICS a caller depends on, not the object
 * identity: content, tool calls with reassembled arguments, usage counters,
 * and the streamed deltas. Anything a transport split must preserve.
 */
function normalize(result, deltas) {
  const msg = result?.responseMessage || {};
  const content = typeof msg.content === 'string'
    ? msg.content
    : Array.isArray(msg.content)
      ? msg.content.map((b) => ({ type: b.type, text: b.text, thinking: b.thinking, name: b.name, id: b.id }))
      : msg.content ?? null;

  return {
    content,
    role: msg.role ?? null,
    toolCalls: (result?.toolCalls || []).map((t) => ({
      // Gemini synthesises ids as `gemini-tool-<Date.now()>-<i>` because its
      // API does not supply one. Recording that verbatim would make every
      // golden differ on every run, and a golden that always differs is
      // indistinguishable from one that never holds. The SHAPE is what
      // matters: a stable, unique id per call.
      id: String(t.id || '').replace(/\d{10,}/g, '<ts>'),
      name: t.function?.name ?? t.name,
      arguments: t.function?.arguments ?? t.arguments,
    })),
    usage: result?.usage
      ? {
        input: result.usage.prompt_tokens ?? result.usage.input_tokens ?? null,
        output: result.usage.completion_tokens ?? result.usage.output_tokens ?? null,
        cachedRead: result.usage.prompt_tokens_details?.cached_tokens
          ?? result.usage.input_tokens_details?.cached_tokens
          ?? result.usage.cache_read_input_tokens ?? null,
      }
      : null,
    recoveredFromError: result?.recoveredFromError ?? false,
    hasReplayItems: Array.isArray(msg._responsesOutputItems) && msg._responsesOutputItems.length > 0,
    thoughtSignatures: (result?.toolCalls || []).filter((t) => t._thoughtSignature).length,
    deltas,
  };
}

/**
 * The tool schemas the fixtures call.
 *
 * These MUST be supplied. The adapters run every assembled tool call through
 * validateToolCalls, which rejects a call naming a tool that was not offered —
 * correctly, since a hallucinated tool must not reach the executor. Recording
 * with an empty tool list therefore captured `toolCalls: []` and
 * `recoveredFromError: true` for every tool scenario: the oracle would have
 * been pinning the rejection path rather than tool-call assembly, and a
 * transport split could have broken assembly entirely without moving a golden.
 */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
];

export async function recordCase([provider, model, scenario, surface, fixture]) {
  const client = clients[surface](fixture, scenario);
  const deltas = [];
  const onChunk = (c) => {
    if (c?.type === 'content' || c?.type === 'text') deltas.push('text');
    else if (c?.type === 'tool_call_delta') deltas.push('tool');
    else if (c?.type === 'thinking') deltas.push('thinking');
  };

  const out = {};

  // callStream — the chat/orchestrator path.
  try {
    const adapter = await createLlmAdapter(provider, client, model, {});
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], TOOLS, onChunk, {});
    out.stream = { ok: true, ...normalize(result, deltas.join(',')) };
  } catch (err) {
    out.stream = { ok: false, error: `${err.name}: ${String(err.message).slice(0, 160)}` };
  }

  // call() — a SEPARATE code path, and one this oracle originally missed. A
  // negative control that broke the non-streaming Codex replay capture left
  // the oracle green, which is precisely the blind spot the wire oracle had
  // before it learned to record both entry points. Eight background services
  // use call(): goal evaluation, insight extraction, plugin generation, eval
  // datasets, experiments, trace analysis, skill evolution and
  // LlmExecutionService — plus, now, every StreamEngine generator.
  try {
    const adapter = await createLlmAdapter(provider, client, model, {});
    const result = await adapter.call([{ role: 'user', content: 'hi' }], TOOLS, {});
    out.nonStream = { ok: true, ...normalize(result, '') };
  } catch (err) {
    out.nonStream = { ok: false, error: `${err.name}: ${String(err.message).slice(0, 160)}` };
  }

  return out;
}

async function main() {
  const out = {};
  for (const c of CASES) {
    const [provider, model, scenario] = c;
    const key = `${provider}/${scenario}`;
    out[key] = await recordCase(c);
    out[key].model = model;
  }

  const ok = Object.values(out).filter((r) => r.stream?.ok).length;
  const okNon = Object.values(out).filter((r) => r.nonStream?.ok).length;
  console.log(`recorded ${ok}/${CASES.length} streaming and ${okNon}/${CASES.length} non-streaming response cases`);

  if (CHECK) {
    const prev = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const diffs = [];
    for (const key of new Set([...Object.keys(prev), ...Object.keys(out)])) {
      const a = JSON.stringify(prev[key]);
      const b = JSON.stringify(out[key]);
      if (a !== b) diffs.push(`  ${key}\n    was: ${a}\n    now: ${b}`);
    }
    console.log(diffs.length ? `RESPONSE DIFFS:\n${diffs.join('\n')}` : 'all response goldens identical');
    process.exit(diffs.length ? 1 : 0);
  }

  fs.writeFileSync(GOLDEN, JSON.stringify(out, null, 2));
  console.log(`goldens written to ${GOLDEN}`);
  for (const [k, v] of Object.entries(out)) {
    if (!v.stream?.ok) console.log(`  stream FAILED ${k}: ${v.stream?.error}`);
    if (!v.nonStream?.ok) console.log(`  call   FAILED ${k}: ${v.nonStream?.error}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('recordResponses.mjs')) await main();

export { CASES };
