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
 *
 * WHEN A SUB-CHAT IS BLOCKED. A worker that needs something only the user can
 * give (a login, a choice, a file) does what it can, then ends its reply with
 * one line, "NEEDS INPUT: <question>". That turns its handback into a question
 * (task_state needs_input -> waiting once delivered): the Main chat asks the
 * user (and texts it, when a phone is linked). The answer goes back into the
 * SAME sub-chat as its next turn — continue_chat from the Main chat, or the
 * user typing in the sub-chat itself — and it reports back again when done.
 */
import { randomUUID } from 'crypto';
import { createHeadlessTransport } from './headlessTransport.js';
import { queueReport, defaultReportDeps, buildReport, lastAnswerOf } from './subChatReports.js';

export { createHeadlessTransport, buildReport };

export const MAX_RUNNING_SUB_CHATS = 5;
const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 8000;

/**
 * The question a worker left on its LAST "NEEDS INPUT:" line, or null. Light
 * markdown around the marker (bold, a quote) is tolerated; the marker must
 * start a line, so prose that merely mentions it does not count.
 */
export function needsInputOf(content) {
  if (typeof content !== 'string') return null;
  let question = null;
  for (const m of content.matchAll(/^[ \t>*_]*NEEDS INPUT:[ \t*_]*(.+?)[ \t*_]*$/gim)) question = m[1].trim();
  if (!question) return null;
  return question.length > MAX_QUESTION_CHARS ? `${question.slice(0, MAX_QUESTION_CHARS - 1)}…` : question;
}

/** A run's outcome, marked when it ended on a question for the user. */
export function classifyOutcome(outcome) {
  const question = outcome?.ok ? needsInputOf(outcome.content) : null;
  return question ? { ...outcome, needsInput: question } : outcome;
}

/** The task state a finished run leaves, before its report is delivered. */
export const stateAfterRun = (outcome, hasParent) => (!hasParent ? 'expired' : outcome?.needsInput ? 'needs_input' : 'done');
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

  const finished = launch(deps, {
    userId, authToken, outputId, conversationId, parentConversationId, title: chatTitle,
    body: { message: task, userMessageId, history: [], conversationId },
  });
  return { success: true, outputId, conversationId, title: chatTitle, parentOutputId: parent?.id || null, finished };
}

/**
 * Run one turn in a sub-chat in the background, then report it to the parent.
 * The one path for the first task (startSubChat) and every continuation
 * (continueSubChat), so both get the same slot, state and report handling.
 */
function launch(deps, { userId, authToken, outputId, conversationId, parentConversationId, title, body }) {
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
  return runSubChat({ deps, userId, authToken, conversationId, body })
    .then(async (raw) => {
      const outcome = classifyOutcome(raw);
      // Recorded before the slot frees, so boot recovery never sees a
      // finished worker as one that was interrupted.
      await deps.ConversationRoleModel.setTaskState(userId, [outputId], stateAfterRun(outcome, !!parentConversationId))
        .catch((error) => console.error(`[SubChat] ${conversationId} state not recorded:`, error?.message || error));
      return outcome;
    })
    .finally(release)
    .then((outcome) => {
      if (!parentConversationId) return null;
      return queueReport(deps, { userId, authToken, parentConversationId, report: { title, outputId, conversationId, outcome } });
    })
    .catch((error) => console.error(`[SubChat] ${conversationId} report failed:`, error?.message || error));
}

async function runSubChat({ deps, userId, authToken, conversationId, body }) {
  const transport = createHeadlessTransport();
  try {
    await deps.executeChatSegment({
      userId,
      authToken,
      files: [],
      body,
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

/** One of the Main chat's sub-chats, by saved row id: { output, mainRow } or { error }. */
async function ownedSubChat(deps, { userId, mainConversationId, outputId }) {
  const { ContentOutputModel, ConversationRoleModel } = deps;
  const main = mainConversationId ? await ContentOutputModel.findMetaByConversationId(mainConversationId, userId) : null;
  if (!main || (await ConversationRoleModel.roleOf(main.id, userId))?.role !== 'main') {
    return { error: 'Only the Main chat can continue its chats.' };
  }
  const role = outputId ? await ConversationRoleModel.roleOf(outputId, userId) : null;
  if (role?.role !== 'sub' || role.parent_output_id !== main.id) {
    return { error: 'That is not one of this chat\'s sub-chats. Use the chat id from its report.' };
  }
  const output = await ContentOutputModel.findMetaById(outputId);
  if (!output?.conversation_id) return { error: 'That chat no longer exists.' };
  return { output, main };
}

/**
 * Send the user's answer (or a follow-up) into one of the Main chat's own
 * sub-chats as its next turn. It continues on its own history and reports
 * back again when that turn ends.
 *
 * @returns {Promise<object>} { success, outputId, conversationId, title } or { success:false, error }
 */
export async function continueSubChat({ userId, authToken, mainConversationId, outputId, message }, injected = null) {
  if (!userId) return { success: false, error: 'An authenticated user is required.' };
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return { success: false, error: 'message is required: the user\'s answer, in full.' };
  if (text.length > MAX_ANSWER_CHARS) return { success: false, error: `message is too long (max ${MAX_ANSWER_CHARS} characters). Put large material in a file and reference it.` };
  if (isSubChatRunning(outputId)) return { success: false, error: 'That chat is still working. Wait for it to report back.' };
  if (runningSubChatCount(userId) >= MAX_RUNNING_SUB_CHATS) {
    return { success: false, error: `${MAX_RUNNING_SUB_CHATS} sub-chats are already running. Wait for one to report back first.` };
  }

  const deps = injected || (await defaultDeps());
  const owned = await ownedSubChat(deps, { userId, mainConversationId, outputId });
  if (owned.error) return { success: false, error: owned.error };
  const { output } = owned;
  const conversationId = output.conversation_id;
  const title = output.title || 'Task';

  await deps.ConversationRoleModel.setTaskState(userId, [outputId], 'running');
  const history = await deps.loadHistory(conversationId, userId);
  const finished = launch(deps, {
    userId, authToken, outputId, conversationId, parentConversationId: mainConversationId, title,
    body: {
      messages: [...history, { role: 'user', content: `[The user's answer, relayed by the Main chat]\n\n${text}` }],
      userMessageId: `msg-user-${Date.now()}-${outputId.slice(0, 8)}`,
      conversationId,
      routingMode: 'default',
      persistDefault: false,
    },
  });
  return { success: true, outputId, conversationId, title, finished };
}

/**
 * A sub-chat that asked a question and is waiting for the answer:
 * { outputId, title, parentConversationId, answerBefore } or null. Called
 * before a typed turn, so an answer typed in the sub-chat itself also goes
 * back to the Main chat (reportDirectAnswer).
 */
export async function waitingSubChat(userId, conversationId, injected = null) {
  if (!userId || !conversationId) return null;
  const deps = injected || (await defaultDeps());
  const row = await deps.ContentOutputModel.findMetaByConversationId(conversationId, userId);
  if (!row) return null;
  const role = await deps.ConversationRoleModel.roleOf(row.id, userId);
  if (role?.role !== 'sub' || role.task_state !== 'waiting' || !role.parent_output_id) return null;
  if (isSubChatRunning(row.id)) return null;
  const parent = await deps.ContentOutputModel.findMetaById(role.parent_output_id);
  if (!parent?.conversation_id) return null;
  const full = await deps.ContentOutputModel.findOne(row.id).catch(() => null);
  return { outputId: row.id, conversationId, title: row.title || 'Task', parentConversationId: parent.conversation_id, answerBefore: lastAnswerOf(full?.content) };
}

/**
 * After the user answered a waiting sub-chat directly in it: report that
 * turn's answer to the Main chat, exactly as continue_chat's would be.
 * Waits briefly for the turn's transcript to be saved; a turn that produced
 * no new answer is not reported. Never throws.
 */
export async function reportDirectAnswer(waiting, { userId, authToken }, injected = null) {
  try {
    const deps = injected || (await defaultDeps());
    let answer = null;
    for (let i = 0; i < 10; i++) {
      const full = await deps.ContentOutputModel.findOne(waiting.outputId).catch(() => null);
      answer = lastAnswerOf(full?.content);
      if (answer && answer !== waiting.answerBefore) break;
      answer = null;
      await deps.sleep(1000);
    }
    if (!answer) return null;
    const outcome = classifyOutcome({ ok: true, content: answer, error: null });
    await deps.ConversationRoleModel.setTaskState(userId, [waiting.outputId], stateAfterRun(outcome, true));
    return queueReport(deps, { userId, authToken, parentConversationId: waiting.parentConversationId, report: { title: waiting.title, outputId: waiting.outputId, conversationId: waiting.conversationId, outcome } });
  } catch (error) {
    console.error(`[SubChat] direct answer in ${waiting?.conversationId} not reported:`, error?.message || error);
    return null;
  }
}

export default startSubChat;
