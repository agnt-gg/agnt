import { randomUUID } from 'node:crypto';
import { createHeadlessTransport } from './orchestrator/headlessTransport.js';

/**
 * @Annie in a teamspace chat.
 *
 * Annie is not a teamspace agent: she is the assistant, so she answers AS THE
 * PERSON WHO TAGGED HER, on their own permissions and connections, exactly as
 * in their own chat (the same executeChatSegment a typed turn runs, with a
 * transport nobody watches). The turn is not saved as a conversation of
 * theirs; her answer is posted into the teamspace chat for everyone there.
 */
export const ANNIE_ID = 'annie';
export const isAnnie = (mention) => mention?.kind === 'agent' && mention.id === ANNIE_ID;
const MAX_CONTEXT = 20;
const MAX_ANSWER = 4000;

/** The prompt: the request, with the recent teamspace chat as context. */
export function anniePrompt({ spaceName, message, history = [], names = new Map() }) {
  const who = (author) => (author.kind === 'agent' ? (author.id === ANNIE_ID ? 'Annie' : names.get(author.id) || 'Agent') : names.get(author.id) || 'Teammate');
  const recent = history.slice(-MAX_CONTEXT).map((m) => `${who(m.author)}: ${m.body}`).join('\n');
  return [
    `You were @mentioned in the "${spaceName || 'team'}" teamspace chat. Reply to the request as a chat message everyone there will read: plain, short, no headings.`,
    recent ? `Recent messages in that chat:\n${recent}` : '',
    `The request: ${message.body}`,
  ].filter(Boolean).join('\n\n');
}

/** Run one headless Annie turn as `userId`; resolves to her answer text. */
export async function runAnnieTurn({ userId, authToken, prompt }, execute = null) {
  const run = execute || (async (input) => (await import('./OrchestratorService.js')).executeChatSegment(input, {}));
  const transport = createHeadlessTransport();
  const conversationId = randomUUID();
  await run({ userId, authToken, files: [], body: { message: prompt, userMessageId: `msg-team-${Date.now()}`, history: [], conversationId }, chatType: 'orchestrator', originClientId: null, transport });
  const outcome = transport.outcome();
  if (!outcome.content) throw new Error(outcome.error || 'Annie did not answer.');
  return outcome.content;
}

/** Ask, then post her answer (or a plain failure) into the chat as Annie. Never throws. */
export async function answerInTeamChat({ spaces, teamId, workspaceId, ask, prompt, changed = () => {} }) {
  let text;
  try { text = String(await ask(prompt)).slice(0, MAX_ANSWER); } catch (error) {
    console.warn('[TeamSpaceAnnie] answer failed:', error?.message || error);
    text = 'I could not answer that just now. Ask me again in a moment.';
  }
  await spaces.postAgentMessage(teamId, workspaceId, ANNIE_ID, text);
  changed();
}
