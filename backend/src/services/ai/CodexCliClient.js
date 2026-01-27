import CodexCliService from './CodexCliService.js';

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

export function createCodexCliClient({ defaultModel = 'gpt-5-codex', cwd = process.cwd() } = {}) {
  return {
    __provider: 'openai-codex-cli',
    __codexBin: CodexCliService.getCodexBin(),
    chat: {
      completions: {
        async create(options = {}) {
          const model = options.model || defaultModel;
          const messages = normalizeMessages(options.messages);
          const prompt = messagesToCodexPrompt(messages);

          if (options.stream) {
            const queue = createAsyncQueue();

            const runPromise = CodexCliService.runExecStream(
              { prompt, model, cwd },
              {
                onDelta: (delta) => {
                  queue.push({ content: delta });
                },
              }
            )
              .then(() => {
                queue.push({ __done: true });
              })
              .catch((error) => {
                queue.push({ __error: error });
                queue.push({ __done: true });
              });

            return createStreamGenerator(runPromise, queue);
          }

          const result = await CodexCliService.runExecStream({ prompt, model, cwd });
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

