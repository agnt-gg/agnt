/**
 * Provider Test Suite Configuration
 *
 * Defines test targets, credentials sources, and runtime options.
 * Credentials are resolved at runtime from the same auth managers
 * the production code uses — no hardcoded keys.
 */

// Provider definitions with default test models and capability category
export const PROVIDERS = {
  // ── API providers (remote auth via AuthManager) ──────────────────────
  openai:      { model: 'gpt-4.1',                    category: 'api', adapter: 'openai-like' },
  anthropic:   { model: 'claude-sonnet-4-5-20250929',  category: 'api', adapter: 'anthropic' },
  gemini:      { model: 'gemini-3-pro-preview',        category: 'api', adapter: 'gemini' },
  cerebras:    { model: 'llama-3.3-70b',               category: 'api', adapter: 'cerebras' },
  groq:        { model: 'llama-3.3-70b-versatile',     category: 'api', adapter: 'openai-like' },
  deepseek:    { model: 'deepseek-chat',               category: 'api', adapter: 'openai-like' },
  grokai:      { model: 'grok-4-1-fast-reasoning',     category: 'api', adapter: 'openai-like' },
  openrouter:  { model: 'openai/gpt-4-turbo',          category: 'api', adapter: 'openai-like' },
  togetherai:  { model: 'meta-llama/llama-3.1-70b-instruct', category: 'api', adapter: 'openai-like' },
  kimi:        { model: 'kimi-k2.5',                   category: 'api', adapter: 'openai-like' },
  minimax:     { model: 'MiniMax-M2.1',                category: 'api', adapter: 'openai-like' },
  zai:         { model: 'GLM-4.7',                     category: 'api', adapter: 'openai-like' },

  // ── CLI / hybrid providers (local auth) ──────────────────────────────
  'claude-code':       { model: 'claude-sonnet-4-5-20250929', category: 'cli', adapter: 'anthropic' },
  'openai-codex':      { model: 'gpt-4.1',                   category: 'cli', adapter: 'openai-like' },
  'openai-codex-cli':  { model: 'gpt-5-codex',               category: 'cli', adapter: 'responses' },
  // kimi-code is detected dynamically from custom_openai_providers table
};

// Default runtime options (overridable via CLI flags)
export const DEFAULTS = {
  timeoutMs: 60_000,       // Per-test timeout
  maxToolRounds: 3,        // Max rounds in multi-round tool tests
  verbose: false,          // Extra logging
  retries: 0,              // Test-level retries (not LLM retries)
  concurrency: 1,          // Providers tested sequentially by default
};

// Suite names in execution order
export const SUITE_ORDER = [
  'connection',
  'models',
  'response',
  'streaming',
  'tool-calls',
  'tool-streaming',
  'mcp',
  'vision',
  'image-gen',
  'context',
  'error-handling',
];

// Simple prompts used across suites
export const TEST_PROMPTS = {
  basic: 'What is 2+2? Reply with ONLY the number, nothing else.',
  toolTrigger: 'What is the current weather in Tokyo? Use the get_weather tool.',
  multiTool: 'What is the weather in Tokyo and London? Use the get_weather tool for each city.',
  vision: 'Describe what you see in this image in one sentence.',
  contextWindow: 'Summarize the following long text:',
};
