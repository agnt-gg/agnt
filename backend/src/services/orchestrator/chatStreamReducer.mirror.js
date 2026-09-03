/**
 * chatStreamReducer.mirror.js — a VERBATIM copy of
 * frontend/src/services/chatStreamReducer.js.
 *
 * WHY A COPY, AND NOT AN IMPORT
 * -----------------------------
 * The backend has to project a provider transcript into UI messages at turn
 * end (see transcriptProjection.js), and that projection MUST agree with the
 * one the client applies when it reconciles a dead stream. Two hand-written
 * implementations of that conversion would drift, and the file being copied
 * documents what drift costs: two user-visible bugs in a row, one rendering
 * "[object Object]" for every tool-using turn, the next shattering every
 * tool-using answer into three bubbles.
 *
 * Importing the original across the tree boundary is not available:
 *   - The backend runtime does not HAVE frontend/src. Docker copies backend/,
 *     scripts/ and frontend/dist; electron-builder ships backend/** and
 *     frontend/dist/**. Neither carries frontend sources.
 *   - The Docker frontend-build stage is the mirror image: WORKDIR /app/frontend
 *     with only frontend/ copied in, so the frontend cannot reach out either.
 * A shared/ directory would therefore have to be threaded through two
 * Dockerfiles and the electron manifest — release plumbing that cannot be
 * verified from a dev machine, for an internal refactor.
 *
 * So the code is duplicated and the AGREEMENT is made executable instead,
 * which is this repo's existing answer to the same problem (see
 * frontend/src/services/chatTranscriptParity.spec.js). Two tests hold it:
 *   - chatStreamReducer.mirror.test.js asserts this file is byte-identical to
 *     its source below the sentinel, so drift is impossible rather than
 *     unlikely;
 *   - transcriptProjection.parity.spec.js asserts the backend projection and
 *     the client's own reconcile produce the same transcript.
 *
 * TO UPDATE: never edit below the sentinel. Re-copy the source file:
 *   cat <header> frontend/src/services/chatStreamReducer.js > this file
 * The mirror test prints this instruction when it fails.
 */
// --- MIRRORED SOURCE BELOW - DO NOT EDIT BY HAND ---------------------------
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
 * PROVIDER CONTENT IS NOT ALWAYS A STRING
 * ---------------------------------------
 * conversation_logs.full_history stores the RAW PROVIDER transcript, not a UI
 * one. The moment a turn calls a tool, `content` stops being a string and
 * becomes a block array:
 *
 *   assistant: [ {type:'thinking'}, {type:'text',text}, {type:'tool_use',id,name,input} ]
 *   user:      [ {type:'tool_result', tool_use_id, content} ]
 *
 * This module used to reach that array and call String() on it, which yields
 * "[object Object],[object Object]" — so a restarted chat rendered every
 * tool-using turn as literal garbage. The words were never lost; they sit in
 * the `text` blocks and were simply never read. A String() cast reads like a
 * defensive guard and is in fact the thing that destroys the content: it turns
 * "I don't know this shape" into "this is definitely junk", silently.
 *
 * Every provider block shape is flattened HERE, at the one seam both chat
 * surfaces load through, so no surface can drift from the wire format again.
 */
const TEXT_BLOCK_TYPES = new Set(['text', 'input_text', 'output_text']);
const THINKING_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking', 'reasoning']);
const TOOL_USE_BLOCK_TYPES = new Set(['tool_use', 'tool_call', 'function_call']);
const TOOL_RESULT_BLOCK_TYPES = new Set(['tool_result', 'function_call_output']);

/**
 * Reduce any provider payload (string | block array | object) to display text.
 * Used for message bodies and for tool_result contents, which are themselves
 * sometimes a nested block array.
 */
function flattenBlockText(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : (b && typeof b.text === 'string' ? b.text : '')))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    try { return JSON.stringify(content); } catch { return ''; }
  }
  return String(content);
}

/**
 * Normalize one tool call into the shape MessageItem reads
 * ({ id, name, args, status, result?, error? }), accepting the Anthropic block
 * form, the OpenAI `{ id, function: { name, arguments } }` form, and a message
 * already saved by the UI.
 */
function normalizeToolCall(tc) {
  if (!tc || typeof tc !== 'object') return null;
  const id = tc.id || tc.tool_use_id || tc.tool_call_id || tc.toolCallId || tc.call_id;
  if (!id) return null;

  const fn = tc.function || tc.function_call || null;
  let args = tc.args !== undefined ? tc.args : (tc.input !== undefined ? tc.input : fn?.arguments);
  // OpenAI ships arguments as a JSON string; keep the raw text if it is not JSON
  // (a truncated stream) rather than throwing away the only record of the call.
  if (typeof args === 'string' && args) {
    try { args = JSON.parse(args); } catch { /* keep the raw string */ }
  }

  const hasOutcome = tc.result !== undefined || tc.error !== undefined;
  return {
    id,
    name: tc.name || fn?.name || 'tool',
    args,
    status: tc.status || (hasOutcome ? 'completed' : 'pending'),
    ...(tc.result !== undefined ? { result: tc.result } : {}),
    ...(tc.error !== undefined ? { error: tc.error } : {}),
  };
}

/**
 * Split one raw message into its renderable pieces.
 *
 * @returns {{ text: string, reasoning: string, toolCalls: object[],
 *             contentParts: object[], toolResults: object[] }}
 *   `toolResults` are NOT renderable on their own — they belong to a tool call
 *   announced by an EARLIER message, and serverMessagesToUi joins them there.
 */
export function flattenProviderMessage(raw = {}) {
  const contentParts = [];
  const toolCalls = [];
  const toolResults = [];
  let text = '';
  let reasoning = '';

  const addText = (chunk) => {
    if (!chunk) return;
    text = text ? `${text}\n${chunk}` : chunk;
    const last = contentParts[contentParts.length - 1];
    if (last && last.type === 'text') last.text += `\n${chunk}`;
    else contentParts.push({ type: 'text', text: chunk });
  };

  const addToolCall = (candidate) => {
    const tc = normalizeToolCall(candidate);
    if (!tc || toolCalls.some((x) => x.id === tc.id)) return;
    toolCalls.push(tc);
    contentParts.push({ type: 'tool_call', toolCallId: tc.id });
  };

  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      if (typeof block === 'string') { addText(block); continue; }
      if (!block || typeof block !== 'object') continue;

      if (THINKING_BLOCK_TYPES.has(block.type)) {
        const thought = block.thinking || block.text || '';
        if (thought) reasoning = reasoning ? `${reasoning}\n${thought}` : thought;
      } else if (TOOL_USE_BLOCK_TYPES.has(block.type)) {
        addToolCall(block);
      } else if (TOOL_RESULT_BLOCK_TYPES.has(block.type)) {
        const id = block.tool_use_id || block.tool_call_id || block.call_id || block.id;
        if (id) {
          const body = flattenBlockText(block.content !== undefined ? block.content : block.output);
          toolResults.push(block.is_error ? { id, error: body } : { id, result: body });
        }
      } else if (TEXT_BLOCK_TYPES.has(block.type) || typeof block.text === 'string') {
        addText(block.text || '');
      }
    }
  } else {
    addText(flattenBlockText(raw.content));
  }

  // Providers that keep tool calls beside the content rather than inside it.
  const declared = Array.isArray(raw.toolCalls) ? raw.toolCalls
    : (Array.isArray(raw.tool_calls) ? raw.tool_calls : []);
  for (const d of declared) addToolCall(d);

  return { text, reasoning, toolCalls, contentParts, toolResults };
}

/**
 * Normalize a persisted/loaded message into the render shape. Conversations
 * saved before contentParts existed carry only `content`; without a text part
 * MessageItem would render an empty bubble.
 */
export function hydrateMessage(raw = {}) {
  const flat = flattenProviderMessage(raw);
  // A message the UI itself saved already knows its interleave order; never
  // rebuild it (and never break identity for consumers that memoize on it).
  const explicitParts = Array.isArray(raw.contentParts) && raw.contentParts.length
    ? raw.contentParts
    : flat.contentParts;

  return {
    id: raw.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role: raw.role === 'user' ? 'user' : 'assistant',
    content: flat.text,
    contentParts: explicitParts,
    toolCalls: flat.toolCalls,
    reasoning: raw.reasoning || flat.reasoning || '',
    timestamp: raw.timestamp || Date.now(),
  };
}

/**
 * A PROVIDER ROW IS NOT A MESSAGE
 * -------------------------------
 * Live, one answer is ONE message: text and tool cards interleave inside a
 * single bubble via contentParts. The provider transcript stores that same
 * answer as a CHAIN of rows — assistant(text + tool_use), user(tool_result),
 * assistant(tool_use), user(tool_result), assistant(text) — because every
 * tool round-trip has to re-enter the model as a new turn.
 *
 * Mapping one row to one bubble therefore shattered every tool-using answer on
 * reload: three bubbles for the turn above, the middle one with no words at
 * all, just orphaned tool cards. The rule is that an assistant TURN runs until
 * the next thing the USER actually said, so the rows are folded back together
 * here.
 *
 * Fold at the read seam, not at the write: full_history must stay the exact
 * provider transcript (it is replayed back to the model on the next turn, and
 * a doctored one would break tool_use/tool_result pairing).
 */
function mergeAssistantTurn(target, next) {
  if (next.text) target.content = target.content ? `${target.content}\n\n${next.text}` : next.text;
  if (next.reasoning) {
    target.reasoning = target.reasoning ? `${target.reasoning}\n${next.reasoning}` : next.reasoning;
  }

  for (const part of next.contentParts) {
    const last = target.contentParts[target.contentParts.length - 1];
    // Prose split across two provider rows is one passage, not two paragraphs
    // of one part and one of another — keep it in a single text part so the
    // markdown pipeline sees whole fences and lists.
    if (part.type === 'text' && last && last.type === 'text') last.text += `\n\n${part.text}`;
    else target.contentParts.push(part);
  }

  for (const tc of next.toolCalls) {
    if (!target.toolCalls.some((x) => x.id === tc.id)) target.toolCalls.push(tc);
  }
}

/**
 * Convert server conversation_logs messages into UI message shapes.
 *
 * Shared by chatUnified's workspace hydration and the main chat's
 * stream-death reconciliation — one conversion, or the two surfaces
 * silently drift on tool-call / content-part handling.
 *
 * Three provider-transcript facts are handled here and nowhere else:
 *   1. A tool's OUTPUT comes back on a synthetic `user` turn carrying only
 *      tool_result blocks. That is protocol bookkeeping, not something the user
 *      said — it is joined onto the tool card that asked for it and then
 *      dropped, so it never renders as an empty user bubble.
 *   2. One assistant turn spans every row up to the next REAL user message —
 *      see mergeAssistantTurn() above.
 *   3. Because of (1) and (2), the provider transcript has MORE rows than the
 *      UI one for the same conversation. Callers must therefore never compare
 *      the two by length — see transcriptSubstance().
 */
export function serverMessagesToUi(messages) {
  if (!Array.isArray(messages)) return [];

  const out = [];
  const callsById = new Map();
  const stamp = Date.now().toString(36);
  let openTurn = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;

    // OpenAI-shaped transcripts (and several proxy providers) store tool
    // results as their own role:'tool' rows. These rows have no utterance and
    // must not render as bubbles; they exist only to complete earlier tool
    // calls.
    if (m.role === 'tool') {
      const id = m.tool_call_id || m.tool_use_id || m.call_id || m.id;
      if (id) {
        const tc = callsById.get(id);
        if (tc) {
          // The tool row's `content` is already flattened plaintext/json.
          // Treat its absence as an explicit empty string, not as "still open".
          const body = m.content !== undefined && m.content !== null ? String(m.content) : '';
          const isError = Boolean(m.is_error || m.error);
          if (isError) { tc.error = body; tc.status = 'error'; }
          else { tc.result = body; tc.status = 'completed'; }
        }
      }
      continue;
    }

    if (m.role !== 'user' && m.role !== 'assistant') continue;

    const flat = flattenProviderMessage(m);

    for (const r of flat.toolResults) {
      const tc = callsById.get(r.id);
      if (!tc) continue;
      if (r.error !== undefined) { tc.error = r.error; tc.status = 'error'; }
      else { tc.result = r.result; tc.status = 'completed'; }
    }

    // Nothing but tool plumbing — the results above were its entire payload.
    // It carries no utterance, so it must NOT close the open assistant turn.
    if (flat.toolResults.length > 0 && !flat.text && flat.toolCalls.length === 0) continue;

    if (m.role === 'user') {
      openTurn = null;
      out.push(hydrateMessage({ ...m, id: m.id || `srv-${i}-${stamp}` }));
      continue;
    }

    // An assistant row with neither words nor tool calls has nothing to show.
    if (!flat.text && flat.toolCalls.length === 0) continue;

    if (openTurn) {
      mergeAssistantTurn(openTurn, flat);
    } else {
      openTurn = hydrateMessage({ ...m, id: m.id || `srv-${i}-${stamp}` });
      // Own every array and part this turn will grow into: hydrateMessage may
      // hand back the CALLER's contentParts when the message already had them,
      // and merging appends to (and rewrites the text of) these objects.
      openTurn.contentParts = openTurn.contentParts.map((p) => ({ ...p }));
      openTurn.toolCalls = [...openTurn.toolCalls];
      out.push(openTurn);
    }

    for (const tc of openTurn.toolCalls) callsById.set(tc.id, tc);
  }

  return out;
}

/**
 * The fingerprint of a failed object→string coercion. `[object Object]` is not
 * a thing a user types or a model writes; wherever it appears, some conversion
 * upstream gave up and stringified a structure it did not understand. Counted
 * as zero content — see transcriptSubstance().
 */
const COERCION_ARTIFACT = /\[object \w+\]/g;

/**
 * How much a transcript actually SAYS.
 *
 * Row count is not fidelity: a provider transcript legitimately has more rows
 * than the UI's (every tool round-trip adds two), so `remote.length >=
 * local.length` handed the win to whichever side had more PLUMBING — which is
 * how a transcript that had lost its text to a coercion bug came to overwrite
 * good local history.
 *
 * Character count alone is not fidelity either, and the test that pins this
 * caught me assuming it was: "[object Object],[object Object],[object Object]"
 * is 44 characters and would have beaten 40 characters of real writing. A
 * proxy for meaning has to exclude the one string we KNOW carries none.
 */
export function transcriptSubstance(messages) {
  if (!Array.isArray(messages)) return 0;
  let substance = 0;
  for (const m of messages) {
    if (!m) continue;
    if (typeof m.content === 'string') {
      substance += m.content.replace(COERCION_ARTIFACT, '').length;
    }
    // A turn can be pure tool work with no prose; that is still substance.
    // But a pending card (no result) is not as substantive as a completed one.
    if (Array.isArray(m.toolCalls)) {
      for (const tc of m.toolCalls) {
        const hasResult = tc?.result !== undefined && tc?.result !== null;
        substance += hasResult ? 64 : 32;
      }
    }
  }
  return substance;
}

export default {
  HANDLED_STREAM_EVENTS,
  createAssistantMessage,
  applyStreamEvent,
  flattenProviderMessage,
  hydrateMessage,
  serverMessagesToUi,
  transcriptSubstance,
};
