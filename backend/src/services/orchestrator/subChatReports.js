/**
 * subChatReports.js — a worker's outcome back to the chat that started it,
 * and from there to the user's phone.
 *
 *   worker finishes -> batch (10 s, per parent) -> parent idle?
 *     -> ONE report turn in the parent (a real chat turn) -> text the answer
 *
 * WHY A REAL CHAT TURN. The report used to be an AutonomousMessageService
 * call: built from the parent's in-memory context, not registered as a run,
 * not written to the saved transcript, silently skipped when that context
 * was gone (a restart, a day idle). Here it is the same executeChatSegment a
 * typed turn runs, on the parent's persisted provider log, the way a texted
 * turn already runs (mobileReceiver). So it is registered (a desktop or texted
 * turn waits for it, and it waits for them), persisted at turn end, and works
 * on a cold conversation.
 *
 * TO THE PHONE. When a phone is linked, the report turn is a text turn (short
 * plain reply, textRegister) and that reply is texted. The idempotency key is
 * derived from the reported sub-chats, so a retry or a re-report after a
 * restart is still one text. If the report turn itself fails, the user is
 * texted a plain fallback rather than nothing.
 *
 * BATCHING. Workers started together tend to finish together. Reports for one
 * parent arriving within REPORT_BATCH_MS become one turn and one text, and
 * deliveries to one parent never overlap.
 *
 * DURABLE. conversation_roles.task_state: running -> done -> reported. A
 * worker the app stopped mid-run, or one that finished but was never
 * reported, is reported at the next boot (recoverSubChatReports), within
 * REPORT_WINDOW_MS; older ones are marked expired rather than surfacing days
 * late.
 */
import { createHash, randomUUID } from 'crypto';
import { createHeadlessTransport } from './headlessTransport.js';

export const REPORT_BATCH_MS = 10_000;
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PARENT_IDLE_POLL_MS = 2000;
// The run is marked ended a moment before its context is stored.
const PARENT_SETTLE_MS = 1500;
// A report never interrupts a turn (starting a run supersedes the one in
// flight). Past this it is left 'done' for the next boot to deliver.
const PARENT_IDLE_MAX_WAIT_MS = 2 * 60 * 60 * 1000;
const REPORT_ATTEMPTS = 3;
// Enough for the parent to summarise from; the full answer is one click away.
const MAX_REPORTED_CHARS = 6000;
const MAX_BATCH_REPORTED_CHARS = 3000;
export const INTERRUPTED_ERROR = 'AGNT stopped while this was running, so it did not finish.';

function clip(text, max) {
  if (typeof text !== 'string') return '';
  return text.length > max ? `${text.slice(0, max)}\n\n[…truncated — the full answer is in the sub-chat]` : text;
}

// The conversation id is what opens the chat; outputId is only its saved row.
function describe({ title, conversationId, outcome }, maxChars) {
  return `Sub-chat: "${title}"${conversationId ? ` (conversation id ${conversationId})` : ''}
Status: ${outcome.ok ? 'completed' : 'failed'}${outcome.error ? `\nError: ${outcome.error}` : ''}

Its final answer:
${clip(outcome.content || '(none)', maxChars)}`;
}

/**
 * Machine-readable tail on a report: which sub-chats it is about, so the app
 * can draw a card that opens each one (the prose names them, but only by title
 * and conversation id, and the app opens chats by their saved row id).
 * base64url JSON in an HTML comment: no title can break out of it. Only the
 * report turn's INPUT carries it; what is texted is the parent's reply.
 */
export const SUB_CHAT_MARKER = 'agnt-subchats';
export function subChatMarker(reports) {
  const items = reports.map((r) => ({ outputId: r.outputId || null, title: r.title || 'Task', ok: !!r.outcome?.ok }));
  return `<!-- ${SUB_CHAT_MARKER}:${Buffer.from(JSON.stringify(items)).toString('base64url')} -->`;
}

/** The message the parent's AI receives when one sub-chat finishes. */
export function buildReport({ title, conversationId, outcome, outputId }) {
  const status = outcome.ok ? 'finished' : 'finished with a problem';
  return {
    role: 'user',
    content: `[System: Sub-chat ${status}]

${describe({ title, conversationId, outcome }, MAX_REPORTED_CHARS)}

INSTRUCTIONS:
You started this sub-chat to do work for the user. Tell the user, briefly and in your own words, what it ${outcome.ok ? 'found or did' : 'ran into'}. Name the sub-chat by its title so they can open it for the full detail. ${outcome.ok ? 'Do not repeat the whole answer.' : 'Do NOT claim success. Suggest a next step.'}

${subChatMarker([{ title, outcome, outputId }])}`,
  };
}

/** One message for several sub-chats that finished together. */
export function buildBatchReport(reports) {
  if (reports.length === 1) return buildReport(reports[0]);
  const failed = reports.filter((r) => !r.outcome.ok).length;
  return {
    role: 'user',
    content: `[System: ${reports.length} sub-chats finished${failed ? `, ${failed} with a problem` : ''}]

${reports.map((r, i) => `--- ${i + 1} of ${reports.length} ---\n${describe(r, MAX_BATCH_REPORTED_CHARS)}`).join('\n\n')}

INSTRUCTIONS:
You started these sub-chats to do work for the user. In ONE reply, tell the user briefly what each one found, did or ran into, naming each by its title so they can open it for the full detail. Do not repeat whole answers. Do NOT claim success for any that failed; suggest a next step for those.

${subChatMarker(reports)}`,
  };
}

/** Plain text for the phone when the report turn itself could not run. */
export function fallbackText(reports) {
  const lines = reports.map((r) => `${r.title}: ${r.outcome.ok ? 'finished' : 'hit a problem'}`);
  return `${lines.join('\n')}\nThe details are in your AGNT app.`;
}

/** One text per set of reported sub-chats, however often it is retried. */
export function reportKey(outputIds) {
  return `subchat-${createHash('sha256').update([...outputIds].sort().join(',')).digest('hex').slice(0, 40)}`;
}

/** The answer a sub-chat left in its saved transcript, or null. */
export function lastAnswerOf(serializedTranscript) {
  try {
    const messages = JSON.parse(serializedTranscript || '{}').messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content;
    }
  } catch { /* unreadable transcript: no answer */ }
  return null;
}

async function waitForParentIdle(deps, conversationId, userId) {
  const deadline = Date.now() + (deps.idleMaxWaitMs ?? PARENT_IDLE_MAX_WAIT_MS);
  let waited = false;
  while (await deps.isConversationBusy(conversationId, userId)) {
    if (Date.now() >= deadline) return false;
    waited = true;
    await deps.sleep(PARENT_IDLE_POLL_MS);
  }
  if (waited) await deps.sleep(PARENT_SETTLE_MS);
  return true;
}

/** One report turn in the parent, on its persisted history. */
async function runReportTurn(deps, { userId, authToken, conversationId, content, textMode }) {
  const history = await deps.loadHistory(conversationId, userId);
  const transport = createHeadlessTransport();
  try {
    await deps.executeChatSegment({
      userId,
      authToken,
      files: [],
      body: {
        messages: [...history, { role: 'user', content }],
        userMessageId: `msg-report-${Date.now()}-${randomUUID().slice(0, 8)}`,
        conversationId,
        routingMode: 'default',
        persistDefault: false,
        textMode,
      },
      chatType: 'orchestrator',
      originClientId: null,
      transport,
    }, {});
  } catch (error) {
    return { ok: false, content: null, error: error?.message || String(error), imageIds: [] };
  }
  return transport.outcome();
}

/**
 * Deliver one batch: report turn in the parent, then the text.
 * @returns {Promise<{delivered:boolean, texted:boolean, reason?:string}>}
 */
export async function deliverReports(deps, parentConversationId, { userId, authToken, reports }) {
  const outputIds = reports.map((r) => r.outputId);
  const texting = await deps.hasLinkedPhone();
  const message = buildBatchReport(reports);
  const token = deps.freshToken?.(userId) || authToken;
  let outcome = null;
  for (let attempt = 1; attempt <= REPORT_ATTEMPTS; attempt++) {
    if (!(await waitForParentIdle(deps, parentConversationId, userId))) {
      console.warn(`[SubChatReports] ${parentConversationId} stayed busy; ${outputIds.length} report(s) left for the next boot`);
      return { delivered: false, texted: false, reason: 'parent_busy' };
    }
    outcome = await runReportTurn(deps, { userId, authToken: token, conversationId: parentConversationId, content: message.content, textMode: texting });
    if (outcome.content) break;
    console.warn(`[SubChatReports] report turn ${attempt}/${REPORT_ATTEMPTS} into ${parentConversationId} produced no answer: ${outcome.error}`);
  }
  const reported = Boolean(outcome?.content);
  let texted = false;
  if (texting) {
    // Text first, then mark reported: a crash between the two re-reports at
    // boot, and the same key makes the second text a no-op.
    const result = await deps.textUser({
      text: reported ? outcome.content : fallbackText(reports),
      imageIds: reported ? outcome.imageIds : [],
      key: reportKey(outputIds),
    });
    texted = result.sent === true;
    if (!texted) console.log(`[SubChatReports] report not texted: ${result.reason}`);
  }
  // A report that never produced an answer stays 'done': the next boot tries again.
  if (reported) await deps.ConversationRoleModel.setTaskState(userId, outputIds, 'reported');
  return { delivered: reported, texted, ...(reported ? {} : { reason: 'report_failed' }) };
}

const batches = new Map(); // parentConversationId -> pending batch
const lanes = new Map(); // parentConversationId -> the delivery in flight

/**
 * Queue a finished sub-chat's report. Resolves with the delivery result of
 * the batch it joined. Never rejects.
 */
export function queueReport(deps, { userId, authToken, parentConversationId, report }) {
  let batch = batches.get(parentConversationId);
  if (!batch) {
    batch = { userId, authToken, reports: [] };
    batch.done = new Promise((resolve) => { batch.resolve = resolve; });
    batches.set(parentConversationId, batch);
    const timer = setTimeout(() => {
      batches.delete(parentConversationId);
      const lane = (lanes.get(parentConversationId) || Promise.resolve())
        .then(() => deliverReports(deps, parentConversationId, batch))
        .catch((error) => {
          console.error(`[SubChatReports] delivery to ${parentConversationId} failed:`, error?.message || error);
          return { delivered: false, texted: false, reason: 'error' };
        })
        .then((result) => {
          if (lanes.get(parentConversationId) === lane) lanes.delete(parentConversationId);
          batch.resolve(result);
        });
      lanes.set(parentConversationId, lane);
    }, deps.batchMs ?? REPORT_BATCH_MS);
    timer.unref?.();
  }
  if (authToken) batch.authToken = authToken;
  batch.reports.push(report);
  return batch.done;
}

const sqliteTime = (value) => Date.parse(String(value || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value || '')) ? '' : 'Z'));

/**
 * Boot: report every sub-chat whose work never reached its parent. Runs once,
 * after startup. A user with no session yet is left for the next boot.
 * @returns {Promise<{queued:number, expired:number, skipped:number, deliveries:Promise[]}>}
 */
export async function recoverSubChatReports(deps, { now = Date.now() } = {}) {
  const summary = { queued: 0, expired: 0, skipped: 0, deliveries: [] };
  const rows = await deps.ConversationRoleModel.listUnreported();
  for (const row of rows) {
    if (deps.isSubChatRunning?.(row.outputId)) { summary.skipped++; continue; }
    const age = now - sqliteTime(row.createdAt);
    if (!row.parentConversationId || !(age <= REPORT_WINDOW_MS)) {
      await deps.ConversationRoleModel.setTaskState(row.userId, [row.outputId], 'expired');
      summary.expired++;
      continue;
    }
    const authToken = deps.freshToken?.(row.userId);
    if (!authToken) { summary.skipped++; continue; }
    const answer = row.taskState === 'done' ? lastAnswerOf(row.content) : null;
    const outcome = row.taskState === 'done' && answer
      ? { ok: true, content: answer, error: null }
      : { ok: false, content: null, error: row.taskState === 'done' ? 'It finished, but its answer could not be read back.' : INTERRUPTED_ERROR };
    summary.deliveries.push(queueReport(deps, { userId: row.userId, authToken, parentConversationId: row.parentConversationId, report: { title: row.title || 'Task', outputId: row.outputId, conversationId: row.conversationId, outcome } }));
    summary.queued++;
  }
  return summary;
}

/** Production collaborators, lazily imported (OrchestratorService imports tools.js, which reaches here). */
export async function defaultReportDeps() {
  const [{ default: ConversationRoleModel }, { default: ConversationLogModel }, { getRunStatus }, mobileOutbound, { getSessionToken }] = await Promise.all([
    import('../../models/ConversationRoleModel.js'),
    import('../../models/ConversationLogModel.js'),
    import('./activeRuns.js'),
    import('../mobileOutbound.js'),
    import('../auth/sessionTokenCache.js'),
  ]);
  return {
    ConversationRoleModel,
    executeChatSegment: async (...args) => (await import('../OrchestratorService.js')).executeChatSegment(...args),
    isConversationBusy: async (conversationId, userId) => getRunStatus(conversationId, userId).active === true,
    // The parent's provider log, exactly what its next typed turn would see.
    loadHistory: async (conversationId, userId) => {
      const log = await ConversationLogModel.getByConversationId(conversationId, userId);
      return (Array.isArray(log?.messages) ? log.messages : []).filter((m) => m && m.role !== 'system');
    },
    hasLinkedPhone: () => mobileOutbound.hasLinkedPhone(),
    textUser: (input) => mobileOutbound.textUser(input),
    // A worker can run for hours; the session's current token outlives the
    // one captured when it started.
    freshToken: (userId) => { const token = getSessionToken(userId); return token ? `Bearer ${token}` : null; },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

const SESSION_POLL_MS = 15_000;
const SESSION_MAX_WAIT_MS = 15 * 60 * 1000;

/**
 * Boot hook: once a signed-in session exists (a desktop caches it only after
 * the window signs in), report what the last run left unreported. Bounded;
 * with no session in that time, the next boot tries again.
 */
export async function startSubChatRecovery({ deps: injected = null, pollMs = SESSION_POLL_MS, maxWaitMs = SESSION_MAX_WAIT_MS } = {}) {
  const [{ getSessionUserId }, { isSubChatRunning }] = await Promise.all([
    import('../auth/sessionTokenCache.js'),
    import('./subChats.js'),
  ]);
  const deadline = Date.now() + maxWaitMs;
  while (!getSessionUserId()) {
    if (Date.now() >= deadline) return { queued: 0, expired: 0, skipped: 0, waitedOut: true };
    await new Promise((resolve) => setTimeout(resolve, pollMs).unref?.());
  }
  const deps = injected || { ...(await defaultReportDeps()), isSubChatRunning };
  const summary = await recoverSubChatReports(deps);
  if (summary.queued || summary.expired) console.log(`[SubChatReports] boot: ${summary.queued} report(s) queued, ${summary.expired} expired`);
  return summary;
}

export function _resetReportsForTests() {
  batches.clear();
  lanes.clear();
}
