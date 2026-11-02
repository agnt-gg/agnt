import { randomUUID } from 'node:crypto';
import { createAssistantMessage, applyStreamEvent } from './orchestrator/chatStreamReducer.mirror.js';

/**
 * @Annie in a teamspace chat.
 *
 * Annie is not a teamspace agent: she is the assistant, so she answers AS THE
 * PERSON WHO TAGGED HER, on their own permissions and connections, exactly as
 * in their own chat (the same executeChatSegment a typed turn runs). The turn
 * is not saved as a conversation of theirs; her answer is posted into the
 * teamspace chat for everyone there.
 *
 * Her reply is the same chat message the main chat renders: the stream is
 * reduced by the server's mirror of the client reducer (text parts, tool
 * calls, images in tool results), kept live while she works so teammates watch
 * it stream, then stored whole.
 */
export const ANNIE_ID = 'annie';
export const isAnnie = (mention) => mention?.kind === 'agent' && mention.id === ANNIE_ID;
const MAX_CONTEXT = 20;
// Earlier messages are context, so each is an excerpt; the request itself is always sent whole.
const MAX_CONTEXT_LINE = 1500;
const clip = (s) => (s.length > MAX_CONTEXT_LINE ? s.slice(0, MAX_CONTEXT_LINE) + ' … (truncated)' : s);
const MAX_BODY_TEXT = 4000; // the plain-text copy (previews, inbox); the full message is kept apart

/** The prompt: the request, with the recent teamspace chat as context. */
export function anniePrompt({ spaceName, message, history = [], names = new Map() }) {
  const who = (author) => (author.kind === 'agent' ? (author.id === ANNIE_ID ? 'Annie' : names.get(author.id) || 'Agent') : names.get(author.id) || 'Teammate');
  const recent = history.slice(-MAX_CONTEXT).map((m) => `${who(m.author)}: ${clip(String(m.body || ''))}`).join('\n');
  return [
    `You were @mentioned in the "${spaceName || 'team'}" teamspace chat. Reply as you would in a chat; everyone in that teamspace will read it. Use your tools when the request needs them.`,
    recent ? `Recent messages in that chat:\n${recent}` : '',
    `The request: ${message.body}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Replies being written right now, per teamspace: id -> { teamId, workspaceId, message, author, startedAt }.
 * Read only through an authorized route (TeamSpaceRoutes GET .../messages/live).
 */
const live = new Map();
export function liveReplies(teamId, workspaceId) {
  return [...live.entries()].filter(([, r]) => r.teamId === teamId && r.workspaceId === workspaceId)
    .map(([id, r]) => ({ id, workspaceId, author: r.author, body: r.message.content, message: r.message, createdAt: r.startedAt, live: true }));
}

/** A transport that reduces the stream into one chat message and reports changes (throttled by the caller). */
export function createReducingTransport({ onChange = () => {} } = {}) {
  const message = createAssistantMessage();
  let error = null;
  let rejected = null;
  return {
    message,
    onClose() { return () => {}; },
    reject(status, err) { rejected = String(err || `Rejected (${status})`); },
    start() {},
    send(eventName, payload) {
      const result = applyStreamEvent(message, eventName, payload || {});
      if (result.error) error = result.error;
      if (result.changed) onChange();
    },
    finish() {},
    outcome() {
      if (rejected) return { ok: false, error: rejected, message };
      const text = (message.content || '').trim();
      if (!text && !message.toolCalls.length) return { ok: false, error: error || 'Annie did not answer.', message };
      return { ok: !error, error, message };
    },
  };
}

/** Run one Annie turn as `userId`, reducing it live into `transport`. */
export async function runAnnieTurn({ userId, authToken, prompt, transport }, execute = null) {
  const run = execute || (async (input) => (await import('./OrchestratorService.js')).executeChatSegment(input, {}));
  const conversationId = randomUUID();
  await run({ userId, authToken, files: [], body: { message: prompt, userMessageId: `msg-team-${Date.now()}`, history: [], conversationId }, chatType: 'orchestrator', originClientId: null, transport });
  return transport.outcome();
}

/**
 * Ask, streaming the reply live to the teamspace, then post it whole as Annie. Never throws.
 * `ask(prompt, transport)` runs the turn; `changed({ live })` tells the space (ids only).
 */
export async function answerInTeamChat({ spaces, teamId, workspaceId, ask, prompt, changed = () => {}, throttleMs = 250 }) {
  const liveId = `live-${randomUUID()}`;
  let timer = null;
  const ping = () => { if (timer) return; timer = setTimeout(() => { timer = null; changed({ live: liveId }); }, throttleMs); };
  const transport = createReducingTransport({ onChange: ping });
  live.set(liveId, { teamId, workspaceId, message: transport.message, author: { kind: 'agent', id: ANNIE_ID }, startedAt: new Date().toISOString() });
  changed({ live: liveId });
  let outcome;
  try { outcome = await ask(prompt, transport); } catch (error) {
    console.warn('[TeamSpaceAnnie] answer failed:', error?.message || error);
    outcome = { ok: false, error: error?.message, message: transport.message };
  }
  if (timer) { clearTimeout(timer); timer = null; }
  const message = outcome?.message || transport.message;
  const hasAnswer = (message.content || '').trim() || message.toolCalls.length;
  try {
    if (hasAnswer) await spaces.postAgentMessage(teamId, workspaceId, ANNIE_ID, String(message.content || '').slice(0, MAX_BODY_TEXT) || 'Done.', null, message);
    else await spaces.postAgentMessage(teamId, workspaceId, ANNIE_ID, 'I could not answer that just now. Ask me again in a moment.');
  } finally {
    live.delete(liveId);
    changed({ live: liveId, done: true });
  }
}
