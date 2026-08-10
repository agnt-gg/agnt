/**
 * Canonical scenarios for the provider wire oracle.
 *
 * These are the INPUTS to an adapter — the same shape OrchestratorService
 * passes. Everything here must be deterministic: no Date.now(), no randomness,
 * no environment reads. A golden that changes because the clock moved is not a
 * golden.
 *
 * Eight scenarios chosen to cover the load-bearing behaviour of every
 * transport: message translation, tool schema translation, tool-result
 * round-tripping, multimodal content, reasoning controls in both directions,
 * cache breakpoint placement, and context compression.
 */

const SYSTEM = 'You are AGNT, a helpful assistant. Follow the user\'s instructions exactly.';

/** Deterministic filler — same bytes every run, sized by token-ish characters. */
function filler(chars) {
  const unit = 'The quick brown fox jumps over the lazy dog. ';
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          limit: { type: 'integer', description: 'Max lines' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          num: { type: 'number', default: 5 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nested_schema_tool',
      description: 'Exercises nested/array/enum schema translation.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fast', 'slow'] },
          items: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          },
          meta: { type: 'object', additionalProperties: true },
        },
        required: ['mode'],
      },
    },
  },
];

/** A 1x1 transparent PNG — smallest valid image payload. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const SCENARIOS = {
  plain: {
    label: 'plain chat',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'What is the capital of France?' },
    ],
    tools: [],
    options: {},
  },

  tools: {
    label: 'chat with tool schemas',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Read package.json and tell me the version.' },
    ],
    tools: TOOLS,
    options: {},
  },

  toolResult: {
    label: 'tool-result round trip',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Read package.json and tell me the version.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_oracle_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"package.json"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_oracle_1', content: '{"version":"0.6.6"}' },
      { role: 'user', content: 'Thanks. Now summarise it.' },
    ],
    tools: TOOLS,
    options: {},
  },

  vision: {
    label: 'multimodal input',
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${PIXEL}` } },
        ],
      },
    ],
    tools: [],
    options: {},
  },

  reasoningOn: {
    label: 'reasoning explicitly enabled (high)',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Prove that sqrt(2) is irrational.' },
    ],
    tools: [],
    options: { reasoningEnabled: true, reasoningValue: 'high' },
  },

  reasoningOff: {
    label: 'reasoning explicitly disabled',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Prove that sqrt(2) is irrational.' },
    ],
    tools: [],
    options: { reasoningEnabled: true, reasoningValue: 'off' },
  },

  cacheBreakpoints: {
    label: 'long stable prefix — exercises cache breakpoint placement',
    messages: [
      { role: 'system', content: `${SYSTEM}\n\n${filler(24000)}` },
      { role: 'user', content: 'First question about the document.' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Second question about the document.' },
      { role: 'assistant', content: 'Second answer.' },
      { role: 'user', content: 'Third question about the document.' },
    ],
    tools: TOOLS,
    options: { conversationId: 'oracle-fixed-conversation-id' },
  },

  compression: {
    label: 'oversize history — exercises context compression',
    messages: [
      { role: 'system', content: `${SYSTEM}\n\n${filler(8000)}` },
      ...Array.from({ length: 40 }, (_, i) => [
        { role: 'user', content: `Turn ${i} question. ${filler(4000)}` },
        { role: 'assistant', content: `Turn ${i} answer. ${filler(4000)}` },
      ]).flat(),
      { role: 'user', content: 'Final question after a very long history.' },
    ],
    tools: TOOLS,
    options: { conversationId: 'oracle-fixed-conversation-id' },
  },
};

export const SCENARIO_KEYS = Object.keys(SCENARIOS);
