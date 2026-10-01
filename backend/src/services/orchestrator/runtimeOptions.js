/**
 * runtimeOptions.js — what a programmatic chat call actually wants loaded.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every call to /agents/:id/chat(-stream) used to run the full chat-app turn:
 * the ~12K-token platform prompt (rendering rules, chart cheat-sheet, skills
 * catalog, memory digest, the user's own custom instructions), the tool
 * registry, a conversation log, cross-tab broadcasts and an insight-extraction
 * pass. A chat window needs all of that. A script, webhook or game loop needs
 * almost none of it, and paid for all of it on every call.
 *
 * Measured 2026-10-01 against a running backend: a 79-token JSON reply from a
 * game-commander agent cost 12,161 input tokens, and each call appeared in the
 * user's conversation list, because the run:started broadcast made the open
 * app adopt the run and autosave it. Thirteen test calls, thirteen sidebar
 * entries.
 *
 * THE CONTRACT
 * ------------
 * One optional `runtime` object on the request. A `profile` picks a preset;
 * any field can then be overridden. Absent `runtime` resolves to the `ui`
 * profile, whose every field is today's behaviour, so existing callers are
 * byte-for-byte unaffected.
 *
 *   ui          the chat app (default)
 *   api         scripts / webhooks / integrations: lean prompt, agent's tools,
 *               nothing written to conversations, no broadcast
 *   background  cron / batch / delegation: full prompt minus chat-UI blocks,
 *               conversation log kept, no broadcast
 *   realtime    games / voice / classifiers: persona only, no tools, nothing
 *               persisted but the run trace, no failover, minimal SSE + `line`
 *               events, cancelled when the caller disconnects
 *
 * INVARIANTS (enforced here or at the call sites that read the result)
 *   - Narrowing only. `tools` can only select from what the agent is already
 *     allowed; nothing here widens access.
 *   - A non-ui profile never broadcasts and never creates a sidebar entry.
 *   - Every run still writes its execution trace — there is no "off".
 *   - Unknown keys are rejected, so a typo cannot silently fall back to the
 *     expensive default.
 */

export const RUNTIME_PROFILES = Object.freeze(['ui', 'api', 'background', 'realtime']);
export const PROMPT_PLATFORM_LEVELS = Object.freeze(['full', 'lean', 'none']);

/** SSE events a `stream.events: 'minimal'` caller receives. */
export const MINIMAL_STREAM_EVENTS = Object.freeze(new Set([
  'conversation_started',
  'agent_execution_started',
  'content_delta',
  'line',
  'final_content',
  'error',
  'provider_fallback',
  'agent_execution_completed',
  'done',
]));

const MAX_APPEND_CHARS = 20_000;
const MAX_TOOL_NAMES = 200;
const MAX_TIMEOUT_MS = 600_000;
const MAX_INPUT_TOKENS = 2_000_000;
const MAX_TOOL_ROUNDS = 100;

const PERSIST_NONE = { conversationLog: false, transcript: false, conversationState: false, insights: false };

const PROFILE_DEFAULTS = Object.freeze({
  ui: {
    prompt: { platform: 'full', memory: true, skills: true, customInstructions: true, workspace: true, append: null },
    tools: 'agent',
    persist: { conversationLog: true, transcript: true, conversationState: true, insights: true },
    broadcast: true,
    model: { provider: null, model: null, override: false, fallback: 'chain' },
    stream: { events: 'all', lines: false },
    limits: { maxInputTokens: null, timeoutMs: null, maxToolRounds: null, cancelOnDisconnect: false },
  },
  api: {
    prompt: { platform: 'lean', memory: false, skills: false, customInstructions: false, workspace: true, append: null },
    tools: 'agent',
    persist: PERSIST_NONE,
    broadcast: false,
    model: { provider: null, model: null, override: false, fallback: 'chain' },
    stream: { events: 'all', lines: false },
    limits: { maxInputTokens: null, timeoutMs: null, maxToolRounds: null, cancelOnDisconnect: false },
  },
  background: {
    prompt: { platform: 'lean', memory: true, skills: true, customInstructions: true, workspace: true, append: null },
    tools: 'agent',
    persist: { conversationLog: true, transcript: false, conversationState: true, insights: true },
    broadcast: false,
    model: { provider: null, model: null, override: false, fallback: 'chain' },
    stream: { events: 'all', lines: false },
    limits: { maxInputTokens: null, timeoutMs: null, maxToolRounds: null, cancelOnDisconnect: false },
  },
  realtime: {
    prompt: { platform: 'none', memory: false, skills: false, customInstructions: false, workspace: false, append: null },
    tools: 'none',
    persist: PERSIST_NONE,
    broadcast: false,
    model: { provider: null, model: null, override: false, fallback: 'none' },
    stream: { events: 'minimal', lines: true },
    limits: { maxInputTokens: null, timeoutMs: null, maxToolRounds: 0, cancelOnDisconnect: true },
  },
});

const ALLOWED_KEYS = Object.freeze({
  root: ['profile', 'prompt', 'tools', 'persist', 'broadcast', 'model', 'stream', 'limits'],
  prompt: ['platform', 'memory', 'skills', 'customInstructions', 'workspace', 'append'],
  persist: ['conversationLog', 'transcript', 'conversationState', 'insights'],
  model: ['provider', 'model', 'override', 'fallback'],
  stream: ['events', 'lines'],
  limits: ['maxInputTokens', 'timeoutMs', 'maxToolRounds', 'cancelOnDisconnect'],
});

/** A 400-class error: the caller sent a runtime object we will not guess about. */
export class RuntimeOptionsError extends Error {
  constructor(message) {
    super(`Invalid runtime option: ${message}`);
    this.name = 'RuntimeOptionsError';
    this.status = 400;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJsonIfString(raw) {
  // Multipart (file-upload) bodies deliver every field as a string.
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { throw new RuntimeOptionsError('runtime must be a JSON object'); }
}

function rejectUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new RuntimeOptionsError(`unknown key "${path}${key}"`);
  }
}

function readBoolean(value, path) {
  if (typeof value !== 'boolean') throw new RuntimeOptionsError(`${path} must be true or false`);
  return value;
}

function readEnum(value, allowed, path) {
  if (!allowed.includes(value)) throw new RuntimeOptionsError(`${path} must be one of ${allowed.join(', ')}`);
  return value;
}

function readLimit(value, max, path, { allowZero = false } = {}) {
  if (value === null) return null;
  const min = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RuntimeOptionsError(`${path} must be an integer from ${min} to ${max}, or null`);
  }
  return value;
}

function readShortString(value, path) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new RuntimeOptionsError(`${path} must be a non-empty string of at most 200 characters`);
  }
  return value.trim();
}

function mergeSection(base, overrides, section, readers) {
  if (overrides === undefined) return { ...base };
  if (!isPlainObject(overrides)) throw new RuntimeOptionsError(`${section} must be an object`);
  rejectUnknownKeys(overrides, ALLOWED_KEYS[section], `${section}.`);
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) merged[key] = readers[key](value, `${section}.${key}`);
  return merged;
}

function readTools(value) {
  if (value === 'agent' || value === 'none') return value;
  if (!Array.isArray(value) || value.length > MAX_TOOL_NAMES
    || value.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new RuntimeOptionsError(`tools must be "agent", "none", or an array of at most ${MAX_TOOL_NAMES} tool names`);
  }
  // An empty list is a real answer ("zero tools"), same as "none".
  return value.length === 0 ? 'none' : [...new Set(value.map((name) => name.trim()))];
}

/**
 * Resolve a request's `runtime` field into a complete, frozen option set.
 * Absent / null resolves to the `ui` profile (today's behaviour).
 *
 * @param {unknown} raw  requestBody.runtime
 * @returns {Readonly<object>} resolved options; `explicit` is false when the caller sent nothing
 * @throws {RuntimeOptionsError}
 */
export function resolveRuntimeOptions(raw) {
  const parsed = raw === undefined || raw === null ? null : parseJsonIfString(raw);
  if (parsed !== null && !isPlainObject(parsed)) throw new RuntimeOptionsError('runtime must be an object');
  const input = parsed || {};
  rejectUnknownKeys(input, ALLOWED_KEYS.root, '');

  const profile = input.profile === undefined ? 'ui' : readEnum(input.profile, RUNTIME_PROFILES, 'profile');
  const defaults = PROFILE_DEFAULTS[profile];

  const prompt = mergeSection(defaults.prompt, input.prompt, 'prompt', {
    platform: (v, p) => readEnum(v, PROMPT_PLATFORM_LEVELS, p),
    memory: readBoolean,
    skills: readBoolean,
    customInstructions: readBoolean,
    workspace: readBoolean,
    append: (v, p) => {
      if (v === null) return null;
      if (typeof v !== 'string' || v.length > MAX_APPEND_CHARS) {
        throw new RuntimeOptionsError(`${p} must be a string of at most ${MAX_APPEND_CHARS} characters, or null`);
      }
      return v.trim() || null;
    },
  });
  const persist = mergeSection(defaults.persist, input.persist, 'persist', {
    conversationLog: readBoolean, transcript: readBoolean, conversationState: readBoolean, insights: readBoolean,
  });
  const model = mergeSection(defaults.model, input.model, 'model', {
    provider: readShortString,
    model: readShortString,
    override: readBoolean,
    fallback: (v, p) => readEnum(v, ['chain', 'none'], p),
  });
  if (model.override && (!model.provider || !model.model)) {
    throw new RuntimeOptionsError('model.override requires both model.provider and model.model');
  }
  const stream = mergeSection(defaults.stream, input.stream, 'stream', {
    events: (v, p) => readEnum(v, ['all', 'minimal'], p),
    lines: readBoolean,
  });
  const limits = mergeSection(defaults.limits, input.limits, 'limits', {
    maxInputTokens: (v, p) => readLimit(v, MAX_INPUT_TOKENS, p),
    timeoutMs: (v, p) => readLimit(v, MAX_TIMEOUT_MS, p),
    maxToolRounds: (v, p) => readLimit(v, MAX_TOOL_ROUNDS, p, { allowZero: true }),
    cancelOnDisconnect: readBoolean,
  });
  const tools = input.tools === undefined ? defaults.tools : readTools(input.tools);
  // A ui-profile run is the chat app's own turn; every other profile is a
  // caller that does not own a sidebar entry, so broadcasting is ui-only.
  const broadcast = input.broadcast === undefined
    ? defaults.broadcast
    : readBoolean(input.broadcast, 'broadcast') && profile === 'ui';

  return Object.freeze({
    explicit: parsed !== null,
    profile,
    prompt: Object.freeze(prompt),
    tools: Array.isArray(tools) ? Object.freeze(tools) : tools,
    persist: Object.freeze(persist),
    broadcast,
    model: Object.freeze(model),
    stream: Object.freeze(stream),
    limits: Object.freeze(limits),
  });
}

/**
 * Splits streamed text into complete lines as they arrive, so a caller acting
 * on structured output (JSON Lines) can act on line 1 while line 2 is still
 * being generated. Blank lines are skipped; a trailing partial line is held
 * until flush().
 *
 * @param {(line: string) => void} emit
 */
export function createLineFramer(emit) {
  let buffer = '';
  let index = 0;
  const emitLine = (raw) => {
    const line = raw.replace(/\r$/, '');
    if (line.trim()) emit(line, index++);
  };
  return {
    push(delta) {
      if (typeof delta !== 'string' || !delta) return;
      buffer += delta;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        emitLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    },
    flush() {
      const rest = buffer;
      buffer = '';
      emitLine(rest);
    },
  };
}
