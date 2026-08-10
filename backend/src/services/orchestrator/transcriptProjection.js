/**
 * transcriptProjection.js — turn a PROVIDER transcript into the transcript the
 * sidebar stores, server-side.
 *
 * WHY THE SERVER NEEDS THIS AT ALL
 * --------------------------------
 * content_outputs — the table the conversation list reads — has exactly one
 * writer: an HTTP handler that a CLIENT must call. So the saved copy of a
 * conversation is only ever as fresh as the last moment a browser was
 * listening. Close the tab on a long task and the run itself carries on
 * perfectly (activeRuns.js keeps generation alive; conversation_logs keeps
 * growing), but the row the user actually looks at stays frozen mid-answer.
 * Measured on a real install: a sidebar row stuck at 5,107 bytes while the
 * backend log for the same conversation went on to 74,471.
 *
 * conversation_logs holds the truth, but it holds it in the PROVIDER's shape —
 * one row per tool round-trip, `content` becoming a block array the moment a
 * tool is called. That is a wire format, not a storage format, and
 * conversationTranscript.js records what happened the two times this codebase
 * treated it as one: every tool-using turn rendered "[object Object]", and
 * then every tool-using answer shattered into three bubbles.
 *
 * So this module does not invent a conversion. It runs the SAME one the client
 * already runs when it reconciles a dead stream (chat.js →
 * recoverInterruptedStream → serverMessagesToUi), from a byte-identical mirror
 * of that module, and serializes the result in the SAME shape
 * conversationTranscript.js writes and parses back.
 *
 * Deliberately PURE — no database, no config, no I/O. That is what lets the
 * parity spec import it from the frontend test suite and hold it against the
 * client's own conversion on every build.
 */

import { serverMessagesToUi, transcriptSubstance } from './chatStreamReducer.mirror.js';

export { transcriptSubstance };

/**
 * Longest title derived from a first message.
 * Mirrors TITLE_MAX in frontend/src/services/conversationTranscript.js.
 */
const TITLE_MAX = 100;

/**
 * One stored message.
 *
 * Mirrors toStoredMessage() in conversationTranscript.js, including the rule
 * that matters most: `contentParts` is NOT optional decoration, it carries the
 * text/tool ORDER. Dropping it re-renders every tool card after all the prose,
 * so a multi-tool answer reads in an order the model never produced.
 */
export function toStoredMessage(msg = {}) {
  const stored = {
    id: msg.id,
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : '',
    timestamp: msg.timestamp || Date.now(),
    metadata: msg.metadata || [],
    toolCalls: msg.toolCalls || [],
    contentParts: msg.contentParts || [],
  };
  // Only carry optional fields when present, so a plain chat's payload stays
  // small and diffable.
  if (msg.reasoning) stored.reasoning = msg.reasoning;
  if (msg.reasoning_content) stored.reasoning_content = msg.reasoning_content;
  if (msg.files?.length) stored.files = msg.files;
  if (msg.agentId) stored.agentId = msg.agentId;
  if (msg.agentName) stored.agentName = msg.agentName;
  if (msg.agentIcon) stored.agentIcon = msg.agentIcon;
  return stored;
}

/**
 * Serialize for the `content` column. Mirrors serializeTranscript().
 *
 * Image refs are stored AS-IS: {{IMAGE_REF:id}} tokens resolve to
 * /api/images/:id, and inlining base64 made image-heavy conversations ~6x
 * larger on every save.
 */
export function serializeTranscript({
  conversationId,
  title,
  messages = [],
  agentId = null,
  agentName = null,
} = {}) {
  return JSON.stringify({
    conversationId,
    title,
    agentId,
    agentName,
    isAgentChat: !!agentId,
    messages: messages.map(toStoredMessage),
    createdAt: messages[0]?.timestamp || Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * A conversation's title is the first thing the user said, trimmed at a word
 * boundary. Mirrors deriveTitle().
 */
export function deriveTitle(messages = [], fallback = 'Untitled Conversation') {
  const firstUser = messages.find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim());
  if (!firstUser) return fallback;
  const text = firstUser.content.trim().replace(/\s+/g, ' ');
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TITLE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Project a provider transcript into the stored form.
 *
 * @param {object} args
 * @param {string} args.conversationId
 * @param {Array}  args.providerMessages  conversation_logs.full_history, parsed
 *                                        — the exact array the client receives
 *                                        from GET /orchestrator/conversations/:id
 * @param {string|null} [args.title]      existing title; a user's rename must
 *                                        survive, so a title is only DERIVED
 *                                        when the row has none
 * @returns {{messages: Array, substance: number, title: string, content: string}|null}
 *          null when there is nothing worth storing — an empty projection must
 *          never be written over a real transcript.
 */
export function projectTranscript({
  conversationId,
  providerMessages,
  title = null,
  agentId = null,
  agentName = null,
} = {}) {
  const messages = serverMessagesToUi(providerMessages);
  if (!messages.length) return null;

  const finalTitle = title || deriveTitle(messages);
  return {
    messages,
    substance: transcriptSubstance(messages),
    title: finalTitle,
    content: serializeTranscript({ conversationId, title: finalTitle, messages, agentId, agentName }),
  };
}

export default { projectTranscript, serializeTranscript, toStoredMessage, deriveTitle, transcriptSubstance };
