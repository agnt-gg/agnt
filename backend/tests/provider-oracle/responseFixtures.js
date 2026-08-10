/**
 * CANNED PROVIDER RESPONSES — the input side of the response oracle.
 *
 * The wire oracle records the REQUEST an adapter builds. It is blind to
 * everything on the way back: stream accumulation, tool-call assembly, usage
 * extraction, reasoning blocks, error recovery. Proof it is blind — when the
 * Gemini usage reader was fixed, the wire oracle correctly reported all 20
 * providers byte-identical, because the request never changed.
 *
 * Phase 3 rewrites exactly that response path. So these fixtures reproduce, per
 * transport, what a provider actually sends back, and the oracle asserts the
 * adapter turns them into the same normalized result before and after.
 *
 * Shapes are taken from the event names the adapters already branch on, so a
 * fixture cannot drift into fiction: if the adapter stops recognising an event,
 * the recorded output changes and the oracle fails.
 */

/** An async-iterable stream with the `controller.abort` the adapters expect. */
export function streamOf(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
    controller: { abort() {} },
  };
}

// ── OpenAI-compatible Chat Completions (14 providers) ───────────────────────

const OPENAI_USAGE = {
  prompt_tokens: 1200,
  completion_tokens: 45,
  total_tokens: 1245,
  prompt_tokens_details: { cached_tokens: 1024 },
};

export const CHAT_COMPLETIONS = {
  plainText: [
    { choices: [{ delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] },
    { choices: [{ delta: { content: ', world' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { usage: OPENAI_USAGE },
  ],

  // Tool calls arrive as fragments that must be reassembled by index.
  toolCall: [
    { choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { usage: OPENAI_USAGE },
  ],

  // Two tools in one turn, interleaved — the ordering trap.
  parallelToolCalls: [
    { choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'web_search', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'read_file', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"x"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"path":"b"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { usage: OPENAI_USAGE },
  ],

  // The kimi shape: the usage chunk omits `choices` entirely.
  usageChunkWithoutChoices: [
    { choices: [{ delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { usage: OPENAI_USAGE },
  ],

  // Reasoning models emit a separate reasoning delta.
  withReasoning: [
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'thinking...' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'answer' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { usage: OPENAI_USAGE },
  ],

  // A provider that returns nothing at all — must not produce an unusable turn.
  emptyResponse: [
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { usage: OPENAI_USAGE },
  ],
};

// ── Anthropic Messages ──────────────────────────────────────────────────────

const ANTHROPIC_USAGE = {
  input_tokens: 1200,
  output_tokens: 45,
  cache_read_input_tokens: 1024,
  cache_creation_input_tokens: 176,
};

export const ANTHROPIC = {
  plainText: [
    { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 0, cache_read_input_tokens: 1024, cache_creation_input_tokens: 176 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ', world' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 45 } },
  ],

  toolCall: [
    { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"pa' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'th":"a.txt"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 45 } },
  ],

  // Extended thinking: a thinking block precedes the answer and must survive.
  withThinking: [
    { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me think' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'the answer' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 45 } },
  ],

  // Text and a tool call in the same turn, text first.
  textThenTool: [
    { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me look.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_2', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"x"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 45 } },
  ],
};

export const ANTHROPIC_NONSTREAM = {
  plainText: {
    content: [{ type: 'text', text: 'Hello, world' }],
    usage: ANTHROPIC_USAGE,
    stop_reason: 'end_turn',
  },
  toolCall: {
    content: [
      { type: 'text', text: 'Looking.' },
      { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } },
    ],
    usage: ANTHROPIC_USAGE,
    stop_reason: 'tool_use',
  },
};

// ── OpenAI Responses / Codex ────────────────────────────────────────────────

const RESPONSES_USAGE = {
  input_tokens: 1200,
  output_tokens: 45,
  total_tokens: 1245,
  input_tokens_details: { cached_tokens: 1024 },
};

export const RESPONSES = {
  plainText: [
    { type: 'response.output_text.delta', delta: 'Hello' },
    { type: 'response.output_text.delta', delta: ', world' },
    { type: 'response.completed', response: { usage: RESPONSES_USAGE, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello, world' }] }] } },
  ],

  toolCall: [
    { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"pa' },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: 'th":"a.txt"}' },
    { type: 'response.function_call_arguments.done', item_id: 'fc_1', arguments: '{"path":"a.txt"}' },
    { type: 'response.completed', response: { usage: RESPONSES_USAGE, output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' }] } },
  ],

  // Encrypted reasoning must be captured for replay, or the NEXT turn misses
  // its cache — the documented Responses-API failure mode.
  withReasoning: [
    { type: 'response.output_item.added', item: { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENCRYPTED_BLOB' } },
    { type: 'response.output_text.delta', delta: 'answer' },
    { type: 'response.completed', response: { usage: RESPONSES_USAGE, output: [{ type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENCRYPTED_BLOB' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] }] } },
  ],
};

/**
 * NON-STREAMING Responses payloads.
 *
 * `call()` and `callStream()` hit the same `responses.create`, and the adapter
 * distinguishes them by `stream: true` in the request. A fake client that
 * always returns a stream therefore leaves `response.output` undefined on the
 * call() path, so the replay-item capture never runs — which is exactly how a
 * negative control breaking that capture stayed GREEN. The fake client keys
 * off `params.stream`, and these are what it returns when it is false.
 */
export const RESPONSES_NONSTREAM = {
  plainText: {
    usage: RESPONSES_USAGE,
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello, world' }] }],
  },
  toolCall: {
    usage: RESPONSES_USAGE,
    output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' }],
  },
  withReasoning: {
    usage: RESPONSES_USAGE,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENCRYPTED_BLOB' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
    ],
  },
};

// ── Gemini ───────────────────────────────────────────────────────────────

const GEMINI_USAGE = {
  promptTokenCount: 1200,
  candidatesTokenCount: 45,
  totalTokenCount: 1245,
  cachedContentTokenCount: 1024,
};

export const GEMINI = {
  plainText: [
    { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] },
    { candidates: [{ content: { parts: [{ text: ', world' }] } }], usageMetadata: GEMINI_USAGE },
  ],

  toolCall: [
    { candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'a.txt' } } }] } }] },
    { candidates: [{ content: { parts: [] } }], usageMetadata: GEMINI_USAGE },
  ],

  // The snake_case spelling: same numbers, different field names.
  snakeCaseUsage: [
    { candidates: [{ content: { parts: [{ text: 'OK' }] } }] },
    {
      candidates: [{ content: { parts: [] } }],
      usageMetadata: {
        prompt_token_count: 1200,
        candidates_token_count: 45,
        total_token_count: 1245,
        total_cached_tokens: 1024,
      },
    },
  ],

  // Thought signatures must ride along or Gemini rejects the next turn.
  withThoughtSignature: [
    { candidates: [{ content: { parts: [{ text: 'thinking', thoughtSignature: 'SIG_A' }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: 'web_search', args: { query: 'x' } }, thoughtSignature: 'SIG_B' }] } }] },
    { candidates: [{ content: { parts: [] } }], usageMetadata: GEMINI_USAGE },
  ],
};

export const GEMINI_NONSTREAM = {
  plainText: {
    candidates: [{ content: { parts: [{ text: 'Hello, world' }] } }],
    usageMetadata: GEMINI_USAGE,
  },
};
