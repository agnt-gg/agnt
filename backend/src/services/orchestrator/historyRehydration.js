/**
 * historyRehydration.js — send the provider the bytes it already has.
 *
 * WHY THIS EXISTS
 * ---------------
 * The client rebuilds every turn's history from its UI state
 * (frontend chat.js buildChatHistory). That projection is lossy by design —
 * it is a display model, not a wire format:
 *   - Anthropic thinking blocks (and their signatures) are not in the UI;
 *   - tool_use blocks come back as OpenAI tool_calls with re-serialized args;
 *   - tool results are capped at 2,000 characters;
 *   - OpenAI Responses reasoning items (_responsesOutputItems) are not in the UI.
 * Inside a turn the server sends the provider's NATIVE form. So on the next
 * turn the first tool round of the previous turn no longer matches what the
 * provider cached, and the whole cache from that point on is rewritten.
 * Measured (30 days): `history_rewritten` was the single largest source of
 * cache writes — 884 breaks, 95M write tokens, 753 of them at an assistant
 * message on the first request of a turn. 39 of 40 sampled real
 * conversations reproduce it offline.
 *
 * THE RULE
 * --------
 * A tool round is identified by the ids of its tool calls. Ids are minted by
 * the provider, unique, and immutable, so "the client's round with ids S" and
 * "the server's round with ids S" are the same model output. When they agree
 * on every call's name and input, the server's stored span (assistant message
 * + its tool results, exactly as sent) replaces the client's projection.
 * Anything that does not match exactly is left as the client sent it — the
 * fallback is today's behaviour, never a guess.
 *
 * Rehydration only runs when the previous request went to the SAME provider
 * and model as this one. Native blocks belong to the transport that produced
 * them, and when the target changes there is no cached prefix to protect.
 */

import { USER_AFTER_TOOL_RESULT_LABEL } from './turnContinuity.js';

/** Header of the uploaded-files block the server prepends to a user message. */
export const ATTACHED_FILES_HEADER = '[ATTACHED FILES]';

/** JSON with sorted keys, so semantically equal inputs compare equal. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || raw === '') return {};
  try { return JSON.parse(raw); } catch { return { raw }; }
}

/** Tool calls of an assistant message in either shape, as [{id, name, input}]. */
export function assistantToolCalls(message) {
  if (!message || message.role !== 'assistant') return [];
  if (Array.isArray(message.content)) {
    const native = message.content.filter((block) => block?.type === 'tool_use' && block.id);
    if (native.length > 0) return native.map((block) => ({ id: block.id, name: block.name, input: block.input ?? {} }));
  }
  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls.filter((call) => call?.id).map((call) => ({
      id: call.id,
      name: call.function?.name,
      input: parseArguments(call.function?.arguments),
    }));
  }
  return [];
}

/** Visible assistant text in either shape, whitespace-trimmed. */
function assistantText(message) {
  if (typeof message?.content === 'string') return message.content.trim();
  if (!Array.isArray(message?.content)) return '';
  return message.content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('').trim();
}

/** Tool-call ids a message answers, or null when it is not a pure result message. */
function resultIds(message) {
  if (message?.role === 'tool' && message.tool_call_id) return [message.tool_call_id];
  if (message?.role === 'user' && Array.isArray(message.content) && message.content.length > 0
      && message.content.every((block) => block?.type === 'tool_result' && block.tool_use_id)) {
    return message.content.map((block) => block.tool_use_id);
  }
  return null;
}

/**
 * Split a transcript into tool rounds, in order.
 * A round is the assistant message plus the result messages that follow it
 * and answer its calls. Only COMPLETE rounds are returned: every call has a
 * result and no result belongs to another round. `start`/`end` are the
 * round's message positions, so adjacency can be checked.
 */
function indexRounds(messages) {
  const rounds = [];
  for (let i = 0; i < messages.length; i += 1) {
    const calls = assistantToolCalls(messages[i]);
    if (calls.length === 0) continue;
    const pending = new Set(calls.map((call) => call.id));
    const span = [messages[i]];
    let j = i + 1;
    while (j < messages.length && pending.size > 0) {
      const ids = resultIds(messages[j]);
      if (!ids || !ids.every((id) => pending.has(id))) break;
      ids.forEach((id) => pending.delete(id));
      span.push(messages[j]);
      j += 1;
    }
    if (pending.size === 0) rounds.push({ calls, span, text: assistantText(messages[i]), start: i, end: j });
  }
  return rounds;
}

/**
 * The stored rounds that together make up one client round, or null.
 *
 * The client starts a new round only when TEXT follows a tool call
 * (chat.js splitIntoRounds), so stored rounds with no text of their own are
 * merged into the round before them: stored [text, A] + [B] arrives as
 * client [text, A, B]. The match is therefore a run of ADJACENT stored rounds
 * whose ids concatenate to exactly the client's ids, where every round after
 * the first is text-free — the precise condition under which the client merges.
 */
function matchStoredRounds(clientCalls, clientText, rounds, roundIndexByFirstId) {
  const first = roundIndexByFirstId.get(clientCalls[0].id);
  if (first === undefined || rounds[first].text !== clientText) return null;
  const run = [];
  let covered = 0;
  for (let k = first; k < rounds.length && covered < clientCalls.length; k += 1) {
    const round = rounds[k];
    if (run.length > 0 && (round.text !== '' || round.start !== run.at(-1).end)) return null;
    if (!sameCalls(round.calls, clientCalls.slice(covered, covered + round.calls.length))) return null;
    run.push(round);
    covered += round.calls.length;
  }
  return covered === clientCalls.length ? run : null;
}

function sameCalls(a, b) {
  return a.length === b.length && a.every((call, i) => call.id === b[i].id
    && call.name === b[i].name && canonical(call.input) === canonical(b[i].input));
}

/**
 * A stored span is reusable only if it contains nothing the client did not
 * also send. User text folded into a tool result (a mid-run steer) is carried
 * separately by the client, so reusing the span would send that text twice.
 */
function isReusable(span) {
  return !span.some((message) => JSON.stringify(message.content ?? '').includes(USER_AFTER_TOOL_RESULT_LABEL));
}

/**
 * The server prepends an uploaded-files block to the user message it was sent
 * with. The client keeps the user's own words, so the stored message equals
 * `<files block>…<user text>` exactly. That, and only that, is restored.
 */
function isDecorationOf(storedContent, clientContent) {
  return storedContent.startsWith(ATTACHED_FILES_HEADER) && storedContent.endsWith(`\n\n${clientContent}`);
}

/**
 * Pairs client user messages with stored ones IN ORDER, so two identical
 * messages ("continue", "continue") can never both claim one stored version.
 */
function createUserAligner(storedUserMessages) {
  let next = 0;
  return (clientMessage) => {
    if (clientMessage?.role !== 'user' || typeof clientMessage.content !== 'string' || clientMessage.content === '') return null;
    for (let k = next; k < storedUserMessages.length; k += 1) {
      const storedContent = storedUserMessages[k].content;
      if (storedContent === clientMessage.content) { next = k + 1; return null; }
      if (isDecorationOf(storedContent, clientMessage.content)) { next = k + 1; return storedContent; }
    }
    return null;
  };
}

/**
 * Replace the client's projection of already-sent tool rounds with the
 * server's stored native spans.
 *
 * @param {Array<object>} clientMessages history as rebuilt by the client (no system message)
 * @param {Array<object>|null} storedMessages the server's transcript from the previous turn
 * @returns {{ messages: Array<object>, roundsRestored: number, userMessagesRestored: number }}
 *   `messages` is a new array; inputs are not mutated and restored messages are deep copies.
 */
export function rehydrateHistory(clientMessages, storedMessages) {
  const unchanged = { messages: clientMessages, roundsRestored: 0, userMessagesRestored: 0 };
  if (!Array.isArray(clientMessages) || !Array.isArray(storedMessages) || storedMessages.length === 0) return unchanged;

  const stored = storedMessages.filter((message) => message && message.role !== 'system');
  const storedRounds = indexRounds(stored);
  const roundIndexByFirstId = new Map(storedRounds.map((round, k) => [round.calls[0].id, k]));
  const storedUsers = stored.filter((message) => message.role === 'user' && typeof message.content === 'string');
  if (storedRounds.length === 0 && storedUsers.length === 0) return unchanged;

  const alignUser = createUserAligner(storedUsers);
  const out = [];
  let roundsRestored = 0;
  let userMessagesRestored = 0;
  for (let i = 0; i < clientMessages.length; i += 1) {
    const message = clientMessages[i];
    const calls = assistantToolCalls(message);
    if (calls.length > 0) {
      const run = matchStoredRounds(calls, assistantText(message), storedRounds, roundIndexByFirstId);
      if (run && run.every((round) => isReusable(round.span))) {
        // Skip the client's results for this round; the stored spans carry them.
        const ids = new Set(calls.map((call) => call.id));
        let j = i + 1;
        while (j < clientMessages.length && (resultIds(clientMessages[j]) || []).length > 0
          && resultIds(clientMessages[j]).every((id) => ids.has(id))) j += 1;
        for (const round of run) out.push(...structuredClone(round.span));
        roundsRestored += run.length;
        i = j - 1;
        continue;
      }
    }
    const decoratedContent = alignUser(message);
    if (decoratedContent !== null) {
      out.push({ ...message, content: decoratedContent });
      userMessagesRestored += 1;
      continue;
    }
    out.push(message);
  }
  return { messages: out, roundsRestored, userMessagesRestored };
}

/**
 * Whether the stored transcript may be replayed to this request's target.
 * `previous` is the cache tracker's carried state ({provider, model}).
 */
export function canRehydrateFor(previous, provider, model) {
  return !!previous && !!provider && !!model
    && String(previous.provider || '').toLowerCase() === String(provider).toLowerCase()
    && String(previous.model || '') === String(model);
}
