/**
 * subChats.js — start a conversation from a conversation, and report back.
 *
 * This is how the Main chat works as a project manager: it hands a task to a
 * NEW conversation (the worker), keeps talking to the user, and when the
 * worker finishes, the outcome is posted back into the conversation that
 * started it.
 *
 * Nothing here is a second chat engine:
 *
 *   - the worker is an ordinary saved conversation, created up front so the
 *     sidebar shows it immediately and the turn-end transcript writer
 *     (persistTurnTranscript, update-only by design) has a row to fill;
 *   - its turn runs through executeChatSegment, the same function an HTTP
 *     chat request runs, with a transport that has no socket behind it. The
 *     run is still registered and broadcast, so opening the sub-chat while it
 *     works shows it streaming live;
 *   - the report back is AutonomousMessageService, the same path an async
 *     tool's completion already takes: the parent's AI reads the outcome and
 *     tells the user in its own words.
 *
 * Guardrails: a sub-chat cannot start sub-chats (one level of delegation), and
 * a user has at most MAX_RUNNING_SUB_CHATS in flight.
 */
import { randomUUID } from 'crypto';

export const MAX_RUNNING_SUB_CHATS = 5;
const MAX_PROMPT_CHARS = 20000;
const MAX_TITLE_CHARS = 80;
// Enough for the parent to summarise from; the full answer is one click away.
const MAX_REPORTED_CHARS = 6000;

const runningByUser = new Map(); // userId -> Set<conversationId>

export function runningSubChatCount(userId) {
  return runningByUser.get(userId)?.size || 0;
}

/** A title from the caller, else the task's first line, trimmed to fit a sidebar row. */
export function subChatTitle(title, prompt) {
  const source = (typeof title === 'string' && title.trim()) || String(prompt || '').trim().split('\n')[0];
  const clean = source.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_TITLE_CHARS ? `${clean.slice(0, MAX_TITLE_CHARS - 1)}…` : clean || 'Task';
}

/**
 * A chat transport for a turn nobody is watching through this socket.
 * Same contract as chatTransport.js; instead of writing SSE frames it keeps
 * the turn's final answer and whether it failed.
 */
export function createHeadlessTransport() {
  let finalContent = null;
  let lastError = null;
  let rejected = null;
  return {
    onClose() { return () => {}; },
    reject(status, error) { rejected = { status, error }; },
    start() {},
    send(eventName, payload) {
      if (eventName === 'final_content' && typeof payload?.content === 'string') {
        finalContent = payload.content;
        if (payload.recovered_from_error) lastError = lastError || 'The run hit an error before finishing.';
      } else if (eventName === 'error') {
        lastError = payload?.error || 'Unknown error';
      }
    },
    finish() {},
    outcome() {
      if (rejected) return { ok: false, content: null, error: String(rejected.error || `Rejected (${rejected.status})`) };
      if (!finalContent) return { ok: false, content: null, error: lastError || 'The run ended without an answer.' };
      return { ok: !lastError, content: finalContent, error: lastError };
    },
  };
}

function clip(text, max) {
  if (typeof text !== 'string') return '';
  return text.length > max ? `${text.slice(0, max)}\n\n[…truncated — the full answer is in the sub-chat]` : text;
}

/** The message the parent's AI receives when a sub-chat finishes. */
export function buildReport({ title, outputId, outcome }) {
  const status = outcome.ok ? 'finished' : 'finished with a problem';
  return {
    role: 'user',
    content: `[System: Sub-chat ${status}]

Sub-chat: "${title}" (conversation id ${outputId})
Status: ${outcome.ok ? 'completed' : 'failed'}${outcome.error ? `\nError: ${outcome.error}` : ''}

Its final answer:
${clip(outcome.content || '(none)', MAX_REPORTED_CHARS)}

INSTRUCTIONS:
You started this sub-chat to do work for the user. Tell the user, briefly and in your own words, what it ${outcome.ok ? 'found or did' : 'ran into'}. Name the sub-chat by its title so they can open it for the full detail. ${outcome.ok ? 'Do not repeat the whole answer.' : 'Do NOT claim success. Suggest a next step.'}`,
  };
}

async function defaultDeps() {
  const [{ default: ContentOutputModel }, { default: ConversationRoleModel }, { serializeTranscript }, { broadcastToUser, RealtimeEvents }, { default: autonomousMessageService }] = await Promise.all([
    import('../../models/ContentOutputModel.js'),
    import('../../models/ConversationRoleModel.js'),
    import('./transcriptProjection.js'),
    import('../../utils/realtimeSync.js'),
    import('../AutonomousMessageService.js'),
  ]);
  return {
    ContentOutputModel,
    ConversationRoleModel,
    serializeTranscript,
    broadcastToUser,
    RealtimeEvents,
    // Lazy: OrchestratorService imports tools.js, which imports this file.
    executeChatSegment: async (...args) => (await import('../OrchestratorService.js')).executeChatSegment(...args),
    isConversationBusy: async (conversationId, userId) => (await import('./activeRuns.js')).getRunStatus(conversationId, userId).active === true,
    reportToParent: (conversationId, message) => autonomousMessageService.triggerAutonomousMessage(conversationId, message),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

const PARENT_IDLE_POLL_MS = 2000;
const PARENT_IDLE_MAX_WAIT_MS = 10 * 60 * 1000;
const PARENT_SETTLE_MS = 1500;

/**
 * Report only once the parent is between turns.
 *
 * The report is an autonomous turn built from the parent's STORED context,
 * which the parent's own turn rewrites when it ends. Reporting mid-turn would
 * answer from a context missing the current turn, and then be overwritten by
 * it. A quick worker finishing while the Main chat is still replying is the
 * ordinary case, not an edge one. Bounded: a parent that never goes idle
 * still gets its report.
 */
async function waitForParentIdle(deps, conversationId, userId) {
  const deadline = Date.now() + PARENT_IDLE_MAX_WAIT_MS;
  let waited = false;
  while (Date.now() < deadline && (await deps.isConversationBusy(conversationId, userId))) {
    waited = true;
    await deps.sleep(PARENT_IDLE_POLL_MS);
  }
  // The run is marked ended a moment before its context is stored.
  if (waited) await deps.sleep(PARENT_SETTLE_MS);
}

/**
 * Start a sub-chat. Resolves as soon as the conversation exists; the work
 * runs in the background and reports to the parent when it ends.
 *
 * @returns {Promise<object>} { success, outputId, conversationId, title } or { success:false, error }
 */
export async function startSubChat({ userId, authToken, parentConversationId, title, prompt }, injected = null) {
  if (!userId) return { success: false, error: 'An authenticated user is required.' };
  if (typeof prompt !== 'string' || !prompt.trim()) return { success: false, error: 'prompt is required: the full task for the new chat.' };
  if (prompt.length > MAX_PROMPT_CHARS) return { success: false, error: `prompt is too long (max ${MAX_PROMPT_CHARS} characters). Put large material in a file and reference it.` };
  if (runningSubChatCount(userId) >= MAX_RUNNING_SUB_CHATS) {
    return { success: false, error: `${MAX_RUNNING_SUB_CHATS} sub-chats are already running. Wait for one to report back before starting another.` };
  }

  const deps = injected || (await defaultDeps());
  const { ContentOutputModel, ConversationRoleModel } = deps;

  // The parent is the conversation this tool was called from. It may not be
  // saved yet (the first turn of a brand-new chat): the report still reaches
  // it by conversation id, there is just no row to link the sidebar to.
  const parent = parentConversationId ? await ContentOutputModel.findMetaByConversationId(parentConversationId, userId) : null;
  if (parent) {
    const parentRole = await ConversationRoleModel.roleOf(parent.id, userId);
    if (parentRole?.role === 'sub') {
      return { success: false, error: 'This conversation is itself a sub-chat; it cannot start more. Do the work here, and it will be reported back to the chat that started it.' };
    }
  }

  const outputId = randomUUID();
  const conversationId = randomUUID();
  const userMessageId = `msg-user-${Date.now()}-${outputId.slice(0, 8)}`;
  const chatTitle = subChatTitle(title, prompt);
  const task = prompt.trim();

  await ContentOutputModel.createOrUpdate(
    outputId, userId, null, null,
    deps.serializeTranscript({ conversationId, title: chatTitle, messages: [{ id: userMessageId, role: 'user', content: task, timestamp: Date.now() }] }),
    false, 'conversation', conversationId, chatTitle,
    // The report back names this sub-chat by its title so the user can find
    // it; the auto-titler renaming it would break that reference.
    { titleSource: 'system' },
  );
  // Same place as the chat that started it — a delegated task belongs with
  // its project, not loose in the list.
  if (parent?.group_id) await ContentOutputModel.moveToGroup(outputId, userId, parent.group_id);
  await ConversationRoleModel.addSub(userId, outputId, parent?.id || null);

  const output = await ContentOutputModel.findMetaById(outputId);
  deps.broadcastToUser(userId, deps.RealtimeEvents.CONTENT_CREATED, {
    id: outputId, title: chatTitle, contentType: 'conversation', userId, output, subChatOf: parent?.id || null, timestamp: new Date().toISOString(),
  });

  const running = runningByUser.get(userId) || new Set();
  running.add(conversationId);
  runningByUser.set(userId, running);

  // The slot is released when the WORK ends, not when the report lands: a
  // finished worker waiting for its parent to go idle is not using anything.
  const release = () => {
    running.delete(conversationId);
    if (running.size === 0 && runningByUser.get(userId) === running) runningByUser.delete(userId);
  };
  const finished = runSubChat({ deps, userId, authToken, conversationId, userMessageId, task })
    .finally(release)
    .then(async (outcome) => {
      if (!parentConversationId) return;
      await waitForParentIdle(deps, parentConversationId, userId);
      await deps.reportToParent(parentConversationId, buildReport({ title: chatTitle, outputId, outcome }));
    })
    .catch((error) => console.error(`[SubChat] ${conversationId} report failed:`, error?.message || error));

  return { success: true, outputId, conversationId, title: chatTitle, parentOutputId: parent?.id || null, finished };
}

async function runSubChat({ deps, userId, authToken, conversationId, userMessageId, task }) {
  const transport = createHeadlessTransport();
  try {
    await deps.executeChatSegment({
      userId,
      authToken,
      files: [],
      body: { message: task, userMessageId, history: [], conversationId },
      chatType: 'orchestrator',
      originClientId: null,
      transport,
    }, {});
  } catch (error) {
    console.error(`[SubChat] ${conversationId} failed:`, error?.message || error);
    return { ok: false, content: null, error: error?.message || String(error) };
  }
  return transport.outcome();
}

export default startSubChat;
