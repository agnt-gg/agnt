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

// In-memory session map: sessionKey -> cursor session_id (for --resume continuity)
const sessionStore = new Map();

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

export function createCursorCliClient({
  defaultModel = CursorCliService.getDefaultModel(),
  cwd = CursorCliService.getDefaultWorkdir(),
  sessionKey = null,
  userId = null,
  conversationId = null,
  provider = 'cursor-cli',
  timeoutMs = 300000,
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

          const result = await CursorCliService.runExec({
            prompt,
            model,
            cwd,
            force: true,
            resume: Boolean(existingSessionId),
            sessionId: existingSessionId,
            timeoutMs,
          });

          if (result?.sessionId) {
            sessionStore.set(resolvedSessionKey, result.sessionId);
          }

          const content = result.text || '';

          if (options.stream) {
            // Emit the whole result as a single chunk (no native token streaming).
            return (async function* streamGenerator() {
              if (content) {
                yield { choices: [{ delta: { content } }] };
              }
            })();
          }

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
            usage: result.usage || null,
          };
        },
      },
    },
  };
}

export default createCursorCliClient;
