import CodexCliService from './CodexCliService.js';
import CodexCliSessionManager from './CodexCliSessionManager.js';

const RESUME_MESSAGE_LIMIT = 12;

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

function messagesToCodexPrompt(messages) {
  const normalized = normalizeMessages(messages);
  if (normalized.length === 0) {
    return 'You are Codex. Respond helpfully and concisely.';
  }

  const lines = [];
  lines.push('You are Codex running via the Codex CLI.');
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

function limitMessagesForResume(messages, hasThread) {
  if (!hasThread) return messages;
  if (!Array.isArray(messages)) return [];
  if (messages.length <= RESUME_MESSAGE_LIMIT) return messages;
  return messages.slice(messages.length - RESUME_MESSAGE_LIMIT);
}

function createAsyncQueue() {
  const queue = [];
  let resolver = null;

  return {
    push(item) {
      if (resolver) {
        const resolve = resolver;
        resolver = null;
        resolve(item);
        return;
      }
      queue.push(item);
    },
    async shift() {
      if (queue.length > 0) {
        return queue.shift();
      }
      return new Promise((resolve) => {
        resolver = resolve;
      });
    },
  };
}

function createStreamGenerator(runPromise, queue) {
  return (async function* streamGenerator() {
    try {
      while (true) {
        const item = await queue.shift();
        if (item?.__done) break;
        if (item?.__error) throw item.__error;

        const content = typeof item?.content === 'string' ? item.content : '';
        if (!content) continue;

        yield {
          choices: [
            {
              delta: {
                content,
              },
            },
          ],
        };
      }

      await runPromise;
    } catch (error) {
      throw error;
    }
  })();
}

export function createCodexCliClient({
  defaultModel = 'gpt-5-codex',
  cwd = process.cwd(),
  sessionKey = null,
  userId = null,
  conversationId = null,
  provider = 'openai-codex-cli',
  fullAuto = true,
  authToken = null,
} = {}) {
  const resolvedSessionKey =
    sessionKey ||
    CodexCliSessionManager.getSessionKey({
      userId,
      conversationId,
      provider,
      scope: conversationId ? 'conversation' : 'user',
    });

  return {
    __provider: 'openai-codex-cli',
    __codexBin: CodexCliService.getCodexBin(),
    __sessionKey: resolvedSessionKey,
    chat: {
      completions: {
        async create(options = {}) {
          const model = options.model || defaultModel;
          const messages = normalizeMessages(options.messages);
          const existingThreadId = await CodexCliSessionManager.getThreadId(resolvedSessionKey);
          const messagesForPrompt = limitMessagesForResume(messages, Boolean(existingThreadId));
          const prompt = messagesToCodexPrompt(messagesForPrompt);

          const handleEvent = (event) => {
            if (event?.type === 'thread.started' && event.thread_id) {
              CodexCliSessionManager.setThreadId(resolvedSessionKey, event.thread_id);
            }
          };

          if (options.stream) {
            const queue = createAsyncQueue();

            const runPromise = CodexCliService.runExecStream(
              {
                prompt,
                model,
                cwd,
                resumeThreadId: existingThreadId,
                fullAuto,
                userId,
                conversationId,
                authToken,
                provider,
              },
              {
                onDelta: (delta) => {
                  queue.push({ content: delta });
                },
                onEvent: handleEvent,
              }
            )
              .then((result) => {
                if (result?.threadId) {
                  CodexCliSessionManager.setThreadId(resolvedSessionKey, result.threadId);
                }
                queue.push({ __done: true });
              })
              .catch((error) => {
                queue.push({ __error: error });
                queue.push({ __done: true });
              });

            return createStreamGenerator(runPromise, queue);
          }

          const result = await CodexCliService.runExecStream({
            prompt,
            model,
            cwd,
            resumeThreadId: existingThreadId,
            fullAuto,
            userId,
            conversationId,
            authToken,
            provider,
          }, { onEvent: handleEvent });

          if (result?.threadId) {
            CodexCliSessionManager.setThreadId(resolvedSessionKey, result.threadId);
          }
          const content = result.text || '';

          return {
            id: `codex-cli-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content,
                },
                finish_reason: 'stop',
              },
            ],
            usage: result.usage || null,
          };
        },
      },
    },
  };
}

export default createCodexCliClient;
