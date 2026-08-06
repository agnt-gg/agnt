/**
 * OpenAI-compat chat client backed by the Cursor Agent CLI.
 *
 * Mirrors GrokBuildCliClient but drives `cursor-agent -p --output-format json`
 * via CursorCliService. Cursor's CLI does NOT stream token deltas in a simple
 * way and (famously) hangs after emitting its result — CursorCliService handles
 * the parse-then-kill quirk. We therefore expose a non-streaming completion and,
 * for stream requests, emit the full result as a single delta.
 */

import CursorCliService from './CursorCliService.js';

const RESUME_MESSAGE_LIMIT = 12;

// In-memory session map: sessionKey -> cursor session_id (for --resume
// continuity). Bounded LRU: one entry per conversation would otherwise grow
// for the life of the process. Losing an entry only costs session resume —
// the next turn replays the recent transcript as a fresh prompt, which is
// exactly what a backend restart already does. (Grok persists its sessions
// via CodexThreadModel; wiring Cursor into that store is a follow-up.)
const SESSION_STORE_MAX = 500;
const sessionStore = new Map();

function rememberSession(key, sessionId) {
  // Re-insert to refresh recency; Maps iterate in insertion order, so the
  // first key is always the least recently used.
  sessionStore.delete(key);
  sessionStore.set(key, sessionId);
  while (sessionStore.size > SESSION_STORE_MAX) {
    sessionStore.delete(sessionStore.keys().next().value);
  }
}

/**
 * The Cursor CLI reports usage in camelCase — { inputTokens, outputTokens,
 * cacheReadTokens, cacheWriteTokens } (verified live 2026-07-27). Everything
 * downstream (the orchestrator token accumulator, the workflow LLM node)
 * reads the OpenAI/Anthropic snake_case contracts and would record 0 tokens.
 * This client's surface IS the OpenAI contract, so translate at the boundary:
 * prompt_tokens carries the full input (OpenAI semantics: cached is a subset,
 * exposed under prompt_tokens_details.cached_tokens).
 */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  // Already snake_case? Pass through untouched.
  if (usage.prompt_tokens != null || usage.input_tokens != null) return usage;
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const cacheRead = Number(usage.cacheReadTokens) || 0;
  const normalized = {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
  };
  if (cacheRead > 0) {
    normalized.prompt_tokens_details = { cached_tokens: cacheRead };
  }
  return normalized;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter((msg) => msg && typeof msg === 'object');
}

function formatMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function messagesToCursorPrompt(messages) {
  const normalized = normalizeMessages(messages);
  if (normalized.length === 0) {
    return 'You are Cursor. Respond helpfully and concisely.';
  }
  const lines = [];
  lines.push('You are running via the Cursor Agent CLI.');
  lines.push('Follow system instructions carefully. Use repository context when relevant.');
  lines.push('');
  lines.push('Conversation:');
  for (const msg of normalized) {
    const role = typeof msg.role === 'string' ? msg.role.toUpperCase() : 'USER';
    const content = formatMessageContent(msg.content);
    if (!content) continue;
    lines.push(`${role}:`);
    lines.push(content);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function limitMessagesForResume(messages, hasSession) {
  if (!hasSession) return messages;
  if (!Array.isArray(messages)) return [];
  if (messages.length <= RESUME_MESSAGE_LIMIT) return messages;
  return messages.slice(messages.length - RESUME_MESSAGE_LIMIT);
}

/**
 * Bridge CursorCliService's push-based delta callbacks to the pull-based
 * async generator the OpenAI SDK surface expects.
 *
 * The CLI supports `--output-format stream-json --stream-partial-output`, so
 * real token deltas are available; the previous implementation awaited the
 * whole run and emitted a single chunk, which made Cursor the only provider
 * whose replies materialised all at once. Reasoning deltas are forwarded as
 * `reasoning_content`, which OpenAiLikeAdapter already streams to the UI.
 */
function createCursorStreamGenerator(runOptions, sessionKeyForStore) {
  const queue = [];
  let wake = null;
  let finished = false;

  const push = (item) => {
    queue.push(item);
    if (wake) { const w = wake; wake = null; w(); }
  };
  const finish = () => {
    finished = true;
    if (wake) { const w = wake; wake = null; w(); }
  };

  CursorCliService.runExec({
    ...runOptions,
    onDelta: (text) => push({ content: text }),
    onReasoning: (text) => push({ reasoning: text }),
  })
    .then((result) => {
      if (result?.sessionId) rememberSession(sessionKeyForStore, result.sessionId);
      // Same split contract as the non-streaming path: a resolved
      // { success: false } is an error, not an empty answer.
      if (result && result.success === false) {
        push({ __error: new Error(result.error || 'Cursor CLI returned no result') });
      } else {
        push({ __usage: normalizeUsage(result?.usage) });
      }
      finish();
    })
    .catch((err) => {
      push({ __error: err });
      finish();
    });

  return (async function* streamGenerator() {
    for (;;) {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item.__error) throw item.__error;
        if (item.__usage) {
          if (item.__usage) yield { choices: [{ delta: {} }], usage: item.__usage };
          continue;
        }
        if (item.reasoning) {
          yield { choices: [{ delta: { reasoning_content: item.reasoning } }] };
          continue;
        }
        yield { choices: [{ delta: { content: item.content } }] };
      }
      if (finished) return;
      await new Promise((resolve) => { wake = resolve; });
    }
  })();
}

export function createCursorCliClient({
  defaultModel = CursorCliService.getDefaultModel(),
  cwd = CursorCliService.getDefaultWorkdir(),
  sessionKey = null,
  userId = null,
  conversationId = null,
  provider = 'cursor-cli',
  timeoutMs = CursorCliService.getDefaultTimeoutMs?.() ?? 300000,
  // Execution policy, resolved by the caller instead of hardcoded at the spawn
  // site. The defaults reproduce today's behaviour exactly, so nothing changes
  // unless someone opts in: CURSOR_CLI_FORCE=0 turns auto-approval off without
  // a code change, and CURSOR_CLI_MODE=plan makes the provider read-only.
  force = process.env.CURSOR_CLI_FORCE !== '0',
  mode = process.env.CURSOR_CLI_MODE || null,
  sandbox = process.env.CURSOR_CLI_SANDBOX || null,
  // Opt-in observer for file reads/writes/shell commands Cursor performs.
  // Left null by default: the OpenAI delta shape has no slot for "the agent
  // wrote a file", so surfacing these in chat needs a UI channel decision.
  // The capability lands here; the wiring is a separate change.
  onToolCall = null,
} = {}) {
  const resolvedSessionKey =
    sessionKey || `cursor-cli::${userId || 'anon'}::${conversationId || 'default'}`;

  return {
    __provider: 'cursor-cli',
    __cursorBin: CursorCliService.resolveCursorBin(),
    __sessionKey: resolvedSessionKey,
    chat: {
      completions: {
        async create(options = {}) {
          const model = options.model || defaultModel;
          const messages = normalizeMessages(options.messages);
          const existingSessionId = sessionStore.get(resolvedSessionKey) || null;
          const messagesForPrompt = limitMessagesForResume(messages, Boolean(existingSessionId));
          const prompt = messagesToCursorPrompt(messagesForPrompt);

          const runOptions = {
            prompt,
            model,
            cwd,
            force,
            mode,
            sandbox,
            resume: Boolean(existingSessionId),
            sessionId: existingSessionId,
            timeoutMs,
          };

          // Streaming must return the generator BEFORE the run completes,
          // otherwise the deltas are already history by the time anyone reads.
          if (options.stream) {
            return createCursorStreamGenerator(
              onToolCall ? { ...runOptions, onToolCall } : runOptions,
              resolvedSessionKey,
            );
          }

          const result = await CursorCliService.runExec(runOptions);

          if (result?.sessionId) {
            rememberSession(resolvedSessionKey, result.sessionId);
          }

          // runExec has a split contract: it REJECTS on timeout/auth/spawn but
          // RESOLVES { success: false, error } on usage limits and bare CLI
          // exits. Reading .text off that shape rendered a silent empty
          // assistant message — a usage-limit looked like the model said
          // nothing. Surface it as the error it is.
          if (result && result.success === false) {
            throw new Error(result.error || 'Cursor CLI returned no result');
          }

          const content = result.text || '';

          return {
            id: `cursor-cli-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop',
              },
            ],
            usage: normalizeUsage(result.usage),
          };
        },
      },
    },
  };
}

export default createCursorCliClient;
