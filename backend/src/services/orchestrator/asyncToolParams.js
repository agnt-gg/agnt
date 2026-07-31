/**
 * Async execution parameters grafted onto EVERY tool schema in the surface.
 *
 * THIS BLOCK'S COST IS MULTIPLIED BY THE TOOL COUNT. The prose that actually
 * teaches the semantics ("Async & Periodic Tool Execution" in the unified
 * system prompt) is emitted exactly ONCE per request. Measured live
 * 2026-07-31 against the 325-tool registry: long-form descriptions here cost
 * 193.4 tokens PER TOOL = 62,849 tokens — 47% of the entire serialized tool
 * surface — to redescribe six optional flags 325 times, while the prompt
 * carried a further 1,258-token prose copy of the same six flags.
 *
 * The schema's only job is to make the parameters EXIST, so the model may emit
 * them and strict validators (`additionalProperties: false`) accept them.
 * Semantics belong in the prompt, where lengthening them costs O(1) instead of
 * O(tools).
 *
 * Lives in its own module so the cost guard (asyncToolParams.test.js) can
 * measure it without importing tools.js, which boots the plugin manager, the
 * MCP servers and the email poller as a side effect.
 */
export const ASYNC_TOOL_PARAMS = {
  _executeAsync: {
    type: 'boolean',
    description: 'Run in background; returns an execution ID. See "Async & Periodic Tool Execution" in the system prompt.',
  },
  _estimatedMinutes: {
    type: 'number',
    description: 'UI-only duration hint, minutes.',
  },
  _interval: {
    type: 'number',
    description: 'Seconds between repeat runs. Requires _executeAsync.',
  },
  _stopAfter: {
    type: 'integer',
    description: 'Stop after N iterations. Requires _interval.',
  },
  _duration: {
    type: 'number',
    description: 'Stop after N minutes. Requires _interval.',
  },
  _delayFirst: {
    type: 'boolean',
    description: 'Skip the immediate first run. Requires _interval.',
  },
};

/**
 * Budget for the serialized block, in characters.
 *
 * Chars rather than tokens so the guard needs no tokenizer and cannot drift
 * with one. The block currently serializes to ~610 chars (~132 tokens by
 * o200k); 750 leaves room for a genuinely necessary clarification while still
 * failing loudly on a paragraph. If you need more room than this, the right
 * move is almost always to extend the prompt section instead — one copy, not
 * one per tool.
 */
export const ASYNC_TOOL_PARAMS_MAX_CHARS = 750;
