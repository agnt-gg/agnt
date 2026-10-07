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
 *   - the report back is a real chat turn in the parent (subChatReports.js):
 *     the parent's AI reads the outcome and tells the user in its own words,
 *     and when a phone is linked that answer is texted to them.
 *
 * Guardrails: a sub-chat cannot start sub-chats (one level of delegation), and
 * a user has at most MAX_RUNNING_SUB_CHATS in flight.
 */
import { randomUUID } from 'crypto';
import { createHeadlessTransport } from './headlessTransport.js';
import { queueReport, defaultReportDeps, buildReport } from './subChatReports.js';

export { createHeadlessTransport, buildReport };

export const MAX_RUNNING_SUB_CHATS = 5;
const MAX_PROMPT_CHARS = 20000;
const MAX_TITLE_CHARS = 80;

const runningByUser = new Map(); // userId -> Set<conversationId>
const runningOutputIds = new Set(); // sub-chat rows whose work is live in THIS process

export function runningSubChatCount(userId) {
  return runningByUser.get(userId)?.size || 0;
}

/** Is this sub-chat's work running in this process right now? (Boot recovery must not report it.) */
export function isSubChatRunning(outputId) {
  return runningOutputIds.has(outputId);
}

/** A title from the caller, else the task's first line, trimmed to fit a sidebar row. */
export function subChatTitle(title, prompt) {
  const source = (typeof title === 'string' && title.trim()) || String(prompt || '').trim().split('\n')[0];
  const clean = source.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_TITLE_CHARS ? `${clean.slice(0, MAX_TITLE_CHARS - 1)}…` : clean || 'Task';
}

async function defaultDeps() {
  const [{ default: ContentOutputModel }, { serializeTranscript }, { broadcastToUser, RealtimeEvents }, reportDeps] = await Promise.all([
    import('../../models/ContentOutputModel.js'),
    import('./transcriptProjection.js'),
    import('../../utils/realtimeSync.js'),
    defaultReportDeps(),
  ]);
  return {
    // executeChatSegment, ConversationRoleModel, isConversationBusy, sleep and
    // the report/phone collaborators.
    ...reportDeps,
    ContentOutputModel,
    serializeTranscript,
    broadcastToUser,
    RealtimeEvents,
  };
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

  // Only the Main chat delegates. Every other conversation was offered
  // start_chat too and spawned "sub-chats" of its own (reported 2026-10-07).
  // The Main chat is always a saved row with the 'main' role, so an unsaved,
  // ordinary or sub conversation is refused before anything is created.
  const parent = parentConversationId ? await ContentOutputModel.findMetaByConversationId(parentConversationId, userId) : null;
  const parentRole = parent ? (await ConversationRoleModel.roleOf(parent.id, userId))?.role : null;
  if (parentRole !== 'main') {
    return {
      success: false,
      error: parentRole === 'sub'
        ? 'This conversation is itself a sub-chat; it cannot start more. Do the work here, and it will be reported back to the chat that started it.'
        : 'Only the Main chat can start new chats. Do the work here in this conversation.',
    };
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
  runningOutputIds.add(outputId);

  // The slot is released when the WORK ends, not when the report lands: a
  // finished worker waiting for its parent to go idle is not using anything.
  const release = () => {
    running.delete(conversationId);
    runningOutputIds.delete(outputId);
    if (running.size === 0 && runningByUser.get(userId) === running) runningByUser.delete(userId);
  };
  const finished = runSubChat({ deps, userId, authToken, conversationId, userMessageId, task })
    .then(async (outcome) => {
      // 'done' before the slot frees, so boot recovery never sees a finished
      // worker as one that was interrupted.
      await deps.ConversationRoleModel.setTaskState(userId, [outputId], parentConversationId ? 'done' : 'expired')
        .catch((error) => console.error(`[SubChat] ${conversationId} state not recorded:`, error?.message || error));
      return outcome;
    })
    .finally(release)
    .then((outcome) => {
      if (!parentConversationId) return null;
      return queueReport(deps, { userId, authToken, parentConversationId, report: { title: chatTitle, outputId, conversationId, outcome } });
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
