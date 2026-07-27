/**
 * OpenAI-compat chat client backed by the Grok Build CLI.
 */

import GrokBuildCliService from './GrokBuildCliService.js';
import GrokBuildCliSessionManager from './GrokBuildCliSessionManager.js';

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

function messagesToGrokPrompt(messages) {
  const normalized = normalizeMessages(messages);
  if (normalized.length === 0) {
    return 'You are Grok Build. Respond helpfully and concisely.';
  }

  const lines = [];
  lines.push('You are Grok Build running via the Grok Build CLI.');
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

function createAsyncQueue() {
  const queue = [];
  let resolveWait = null;

  return {
    push(item) {
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r(item);
      } else {
        queue.push(item);
      }
    },
    shift() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise((resolve) => {
        resolveWait = resolve;
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

export function createGrokBuildCliClient({
  defaultModel = GrokBuildCliService.getDefaultModel(),
  cwd = GrokBuildCliService.getDefaultWorkdir(),
  sessionKey = null,
  userId = null,
  conversationId = null,
  provider = 'grok-build',
  alwaysApprove = true,
  authToken = null,
  maxTurns = 30,
  effort = null,
  readOnly = false,
} = {}) {
  const resolvedSessionKey =
    sessionKey ||
    GrokBuildCliSessionManager.getSessionKey({
      userId,
      conversationId,
      provider,
      scope: conversationId ? 'conversation' : 'user',
    });

  return {
    __provider: 'grok-build',
    __grokBin: GrokBuildCliService.getGrokBin(),
    __sessionKey: resolvedSessionKey,
    chat: {
      completions: {
        async create(options = {}) {
          const model = options.model || defaultModel;
          const messages = normalizeMessages(options.messages);
          const existingSessionId = await GrokBuildCliSessionManager.getThreadId(resolvedSessionKey);
          const messagesForPrompt = limitMessagesForResume(messages, Boolean(existingSessionId));
          const prompt = messagesToGrokPrompt(messagesForPrompt);

          const handleEvent = (event) => {
            if (event?.sessionId || event?.session_id) {
              GrokBuildCliSessionManager.setThreadId(
                resolvedSessionKey,
                event.sessionId || event.session_id
              );
            }
          };

          if (options.stream) {
            const queue = createAsyncQueue();

            const runPromise = GrokBuildCliService.runExecStream(
              {
                prompt,
                model,
                cwd,
                resumeSessionId: existingSessionId,
                alwaysApprove,
                maxTurns,
                effort,
                readOnly,
                userId,
                conversationId,
                authToken,
              },
              {
                onDelta: (delta) => {
                  queue.push({ content: delta });
                },
                onEvent: handleEvent,
              }
            )
              .then((result) => {
                if (result?.sessionId) {
                  GrokBuildCliSessionManager.setThreadId(resolvedSessionKey, result.sessionId);
                }
                queue.push({ __done: true });
              })
              .catch((error) => {
                queue.push({ __error: error });
                queue.push({ __done: true });
              });

            return createStreamGenerator(runPromise, queue);
          }

          const result = await GrokBuildCliService.runExecStream(
            {
              prompt,
              model,
              cwd,
              resumeSessionId: existingSessionId,
              alwaysApprove,
              maxTurns,
              effort,
              readOnly,
              userId,
              conversationId,
              authToken,
            },
            { onEvent: handleEvent }
          );

          if (result?.sessionId) {
            GrokBuildCliSessionManager.setThreadId(resolvedSessionKey, result.sessionId);
          }
          const content = result.text || '';

          return {
            id: `grok-build-cli-${Date.now()}`,
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

export default createGrokBuildCliClient;
