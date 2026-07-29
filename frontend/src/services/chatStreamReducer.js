/**
 * chatStreamReducer — the single translation from orchestrator SSE events into
 * the message model that MessageItem renders.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every chat surface used to hand-roll this switch (Chat.vue, store/features/
 * chat.js, chatUnified.js, the five *ChatContainer panels, and MobileChat).
 * Each copy drifted from the wire protocol independently:
 *
 *   - The orchestrator sends `{ toolCall: { id, name, args } }`. MobileChat read
 *     `data.name`, which is always undefined, so every tool chip on the phone
 *     read the literal string "tool".
 *   - Only the store built `contentParts`, so interleaved text/tool ordering —
 *     the thing that makes a multi-tool answer readable — existed on desktop
 *     only. Every other surface concatenated text and lost the ordering.
 *
 * A surface that hand-rolls the switch cannot inherit a protocol change. This
 * module owns the semantics; chatStreamReducer.spec.js pins them, and
 * mobileChatRender.spec.js pins that the mobile surface routes through here.
 *
 * The shape produced is exactly what MessageItem consumes:
 *   { id, role, content, contentParts[], toolCalls[], reasoning, timestamp }
 *
 * Mutation is deliberately IN PLACE: callers hold the message inside a Vue ref
 * (deeply reactive) or a Vuex state tree, and both track nested writes. Cloning
 * per delta would allocate once per token.
 */

/** Event names this reducer understands. Anything else is ignored (and reported). */
export const HANDLED_STREAM_EVENTS = Object.freeze([
  'content_delta',
  'reasoning_delta',
  'tool_pending',
  'tool_start',
  'tool_end',
  'final_content',
  'error',
  'done',
]);

/**
 * Create an empty assistant message in the shape MessageItem renders.
 * @param {{ id?: string, timestamp?: number }} [init]
 */
export function createAssistantMessage(init = {}) {
  return {
    id: init.id || `msg-asst-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role: 'assistant',
    content: '',
    contentParts: [],
    toolCalls: [],
    reasoning: '',
    timestamp: init.timestamp || Date.now(),
  };
}

function ensureParts(message) {
  if (!Array.isArray(message.contentParts)) message.contentParts = [];
  return message.contentParts;
}

function ensureToolCalls(message) {
  if (!Array.isArray(message.toolCalls)) message.toolCalls = [];
  return message.toolCalls;
}

/**
 * Append streamed text. Consecutive deltas coalesce into the trailing text part
 * so a paragraph split across 400 tokens stays ONE part — otherwise every token
 * becomes its own <div> and the markdown pipeline can never see a whole fence.
 */
function appendText(message, delta) {
  if (typeof delta !== 'string' || delta === '') return false;
  message.content = (message.content || '') + delta;
  const parts = ensureParts(message);
  const last = parts[parts.length - 1];
  if (last && last.type === 'text') last.text += delta;
  else parts.push({ type: 'text', text: delta });
  return true;
}

/**
 * Register a tool call and record its position in the interleave.
 * Idempotent by id: `tool_pending` announces the call as soon as the model has
 * named it, `tool_start` follows with the parsed arguments. Both events arrive
 * for the same id, and only the first may push a content part.
 */
function upsertToolCall(message, incoming, defaultStatus) {
  const id = incoming?.id;
  if (!id) return false;
  const toolCalls = ensureToolCalls(message);
  const existing = toolCalls.find((tc) => tc.id === id);

  if (existing) {
    if (incoming.name !== undefined) existing.name = incoming.name;
    if (incoming.args !== undefined) existing.args = incoming.args;
    if (defaultStatus) existing.status = defaultStatus;
    return true;
  }

  toolCalls.push({
    id,
    name: incoming.name || 'tool',
    args: incoming.args,
    status: defaultStatus || 'pending',
  });
  ensureParts(message).push({ type: 'tool_call', toolCallId: id });
  return true;
}

function completeToolCall(message, incoming) {
  const id = incoming?.id;
  if (!id) return false;
  const toolCalls = ensureToolCalls(message);
  const index = toolCalls.findIndex((tc) => tc.id === id);
  if (index === -1) {
    // A tool that failed argument parsing emits tool_end with no preceding
    // tool_start. Surface it rather than dropping the error on the floor.
    upsertToolCall(message, { id, name: incoming.name }, 'pending');
    return completeToolCall(message, incoming);
  }
  // Replace rather than mutate so identity changes for consumers that memoize
  // on the tool-call object (MessageItem keys its expansion rows by index but
  // recomputes its render signature from these fields).
  toolCalls.splice(index, 1, {
    ...toolCalls[index],
    ...(incoming.name !== undefined ? { name: incoming.name } : {}),
    result: incoming.result,
    error: incoming.error,
    status: incoming.error ? 'error' : 'completed',
  });
  return true;
}

/**
 * Apply one SSE event to a message.
 *
 * @param {object} message  message object created by createAssistantMessage()
 * @param {string} eventName
 * @param {object} [data]   the event payload as sent by OrchestratorService
 * @returns {{ handled: boolean, changed: boolean, status: string|null, done: boolean, error: string|null }}
 *   `status` is a human status line for the composer ('' clears it, null leaves
 *   the current one alone).
 */
export function applyStreamEvent(message, eventName, data = {}) {
  const out = { handled: true, changed: false, status: null, done: false, error: null };
  if (!message) return { ...out, handled: false };

  switch (eventName) {
    case 'content_delta':
      out.changed = appendText(message, data?.delta);
      // Text is the answer arriving — any "using tool…" line is now stale.
      if (out.changed) out.status = '';
      break;

    case 'reasoning_delta':
      if (typeof data?.delta === 'string' && data.delta) {
        message.reasoning = (message.reasoning || '') + data.delta;
        out.changed = true;
      }
      out.status = 'Reasoning…';
      break;

    case 'tool_pending':
      out.changed = upsertToolCall(message, data?.toolCall, 'pending');
      if (out.changed) out.status = `Using ${data.toolCall.name || 'tool'}…`;
      break;

    case 'tool_start':
      out.changed = upsertToolCall(message, data?.toolCall, 'running');
      if (out.changed) out.status = `Using ${data.toolCall.name || 'tool'}…`;
      break;

    case 'tool_end':
      out.changed = completeToolCall(message, data?.toolCall);
      if (out.changed) out.status = 'Working…';
      break;

    case 'final_content':
      // The accumulated deltas ARE the answer; final_content is a duplicate of
      // the same text for logging. Only adopt it when nothing streamed at all
      // (non-streaming providers, or a run recovered from an error).
      if (!message.content && typeof data?.content === 'string' && data.content) {
        out.changed = appendText(message, data.content);
      }
      out.status = '';
      break;

    case 'error':
      out.error = data?.error || data?.message || 'Stream error';
      out.status = '';
      break;

    case 'done':
      out.done = true;
      out.status = '';
      break;

    default:
      out.handled = false;
      break;
  }

  return out;
}

/**
 * Normalize a persisted/loaded message into the render shape. Conversations
 * saved before contentParts existed carry only `content`; without a text part
 * MessageItem would render an empty bubble.
 */
export function hydrateMessage(raw = {}) {
  const content = typeof raw.content === 'string' ? raw.content : String(raw.content ?? '');
  const toolCalls = Array.isArray(raw.toolCalls) ? raw.toolCalls : [];
  let contentParts = Array.isArray(raw.contentParts) && raw.contentParts.length ? raw.contentParts : null;

  if (!contentParts) {
    contentParts = [];
    if (content) contentParts.push({ type: 'text', text: content });
    for (const tc of toolCalls) {
      if (tc?.id) contentParts.push({ type: 'tool_call', toolCallId: tc.id });
    }
  }

  return {
    id: raw.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role: raw.role === 'user' ? 'user' : 'assistant',
    content,
    contentParts,
    toolCalls,
    reasoning: raw.reasoning || '',
    timestamp: raw.timestamp || Date.now(),
  };
}

export default { HANDLED_STREAM_EVENTS, createAssistantMessage, applyStreamEvent, hydrateMessage };
