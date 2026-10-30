import { randomUUID } from 'node:crypto';

/**
 * TASKS IN CHAT.
 *
 * When Annie does real work for someone (anything that sends, posts, pays or
 * changes something), she shows it before she does it: a CHECKPOINT card in
 * the conversation (the plan, the exact draft, this routine run, the final
 * review), and her turn ends there. Nothing happens until the person decides.
 * Approving sends a reply into the same chat, so she carries on from it;
 * asking for changes is just typing.
 *
 * A checkpoint belongs to the person whose conversation it is, exactly like
 * the conversation (private inside a team too). One conversation has at most
 * ONE pending checkpoint: a newer card supersedes the older one, so "what
 * needs me" never shows a draft that was already replaced.
 *
 * On a team instance the work can also be a card on a teamspace board. That
 * card is created and moved through the team routes WITH THE PERSON'S OWN
 * TOKEN (`board` below), so every team guard still applies; if it cannot be
 * linked, the checkpoint still works and says so.
 */

export const CHECKPOINT_KINDS = Object.freeze(['plan', 'review', 'run', 'final', 'routine']);
export const DECISIONS = Object.freeze(['approved', 'changes', 'skipped']);
const MAX_CONTENT = 60000;

const fail = (status, message, code) => {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
};
const now = () => new Date().toISOString();

function text(value, max, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `Invalid ${label}`);
  return value.trim();
}

export function toCheckpoint(row) {
  if (!row) return null;
  return {
    id: row.id, conversationId: row.conversation_id, outputId: row.output_id || null,
    kind: row.kind, title: row.title, content: row.content, taskTitle: row.task_title || null,
    state: row.state, note: row.note || null,
    task: row.task_id ? { teamId: row.team_id, workspaceId: row.workspace_id, id: row.task_id } : null,
    createdAt: row.created_at, decidedAt: row.decided_at || null,
  };
}

/** The board status a task should show for a checkpoint's state. */
export function boardStatusFor(kind, state) {
  if (state === 'pending') return 'review';
  if (state === 'approved' && (kind === 'final' || kind === 'routine')) return 'done';
  return 'doing';
}

export class TaskCheckpoints {
  /**
   * @param {{run,get,all}} db  main database repository (ScopeRepository.databaseRepository)
   * @param {object} [board]    { create({authToken,teamId,workspaceId,title}) -> {id}, move({authToken,teamId,workspaceId,taskId,status}) }
   */
  constructor(db, board = null) {
    this.db = db;
    this.board = board;
  }

  async own(userId, id) {
    const row = await this.db.get('SELECT * FROM chat_checkpoints WHERE id=? AND user_id=?', [id, userId]);
    if (!row) fail(404, 'Checkpoint not found');
    return row;
  }

  /**
   * Post a checkpoint. Supersedes this conversation's pending one. Reuses the
   * conversation's board card when it already has one.
   */
  async create(userId, conversationId, input, { authToken, team } = {}) {
    if (!userId) fail(401, 'Sign in required');
    if (typeof conversationId !== 'string' || !conversationId) fail(400, 'A checkpoint belongs to a conversation');
    const kind = input?.kind;
    if (!CHECKPOINT_KINDS.includes(kind)) fail(400, `kind must be one of ${CHECKPOINT_KINDS.join(', ')}`);
    const title = text(input.title, 200, 'title');
    const content = text(input.content, MAX_CONTENT, 'content');
    const taskTitle = text(input.task_title ?? input.taskTitle, 200, 'task title', { optional: true });

    const earlier = await this.db.get('SELECT task_id,team_id,workspace_id,task_title FROM chat_checkpoints WHERE user_id=? AND conversation_id=? AND task_id IS NOT NULL ORDER BY created_at DESC LIMIT 1', [userId, conversationId]);
    let link = earlier ? { teamId: earlier.team_id, workspaceId: earlier.workspace_id, taskId: earlier.task_id } : null;
    let linkError = null;
    if (!link && team?.teamId && team?.workspaceId && this.board) {
      try {
        const card = await this.board.create({ authToken, teamId: team.teamId, workspaceId: team.workspaceId, title: taskTitle || title });
        link = { teamId: team.teamId, workspaceId: team.workspaceId, taskId: card.id };
      } catch (error) {
        linkError = error.message;
      }
    }

    await this.db.run("UPDATE chat_checkpoints SET state='superseded',decided_at=? WHERE user_id=? AND conversation_id=? AND state='pending'", [now(), userId, conversationId]);
    const id = randomUUID();
    await this.db.run('INSERT INTO chat_checkpoints(id,user_id,conversation_id,kind,title,content,task_title,state,team_id,workspace_id,task_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, userId, conversationId, kind, title, content, taskTitle || earlier?.task_title || null, 'pending', link?.teamId || null, link?.workspaceId || null, link?.taskId || null, now()]);
    const created = toCheckpoint(await this.db.get('SELECT * FROM chat_checkpoints WHERE id=?', [id]));
    if (link) await this.mirror(created, authToken).catch((error) => { linkError = linkError || error.message; });
    return { checkpoint: created, linkError };
  }

  /** Keep the board card in step with the chat. Never fails the checkpoint itself. */
  async mirror(checkpoint, authToken) {
    if (!checkpoint?.task || !this.board) return;
    await this.board.move({ authToken, teamId: checkpoint.task.teamId, workspaceId: checkpoint.task.workspaceId, taskId: checkpoint.task.id, status: boardStatusFor(checkpoint.kind, checkpoint.state) });
  }

  pending(userId) {
    return this.db.all("SELECT * FROM chat_checkpoints WHERE user_id=? AND state='pending' ORDER BY created_at DESC LIMIT 100", [userId]).then((rows) => rows.map(toCheckpoint));
  }

  forConversation(userId, conversationId) {
    return this.db.all('SELECT * FROM chat_checkpoints WHERE user_id=? AND conversation_id=? ORDER BY created_at LIMIT 500', [userId, conversationId]).then((rows) => rows.map(toCheckpoint));
  }

  async get(userId, id) {
    return toCheckpoint(await this.own(userId, id));
  }

  /** Remember which saved chat a checkpoint lives in, so "Review" can reopen it. */
  async locate(userId, id, outputId) {
    const value = text(outputId, 200, 'chat id');
    await this.own(userId, id);
    await this.db.run('UPDATE chat_checkpoints SET output_id=COALESCE(output_id,?) WHERE id=? AND user_id=?', [value, id, userId]);
    return this.get(userId, id);
  }

  /**
   * The person's decision. Only a pending checkpoint can be decided, once.
   * "skipped" is for a routine run. The chat reply that resumes Annie is sent
   * by the client after this succeeds, in the person's own words.
   */
  async decide(userId, id, { decision, note } = {}, { authToken } = {}) {
    if (!DECISIONS.includes(decision)) fail(400, `decision must be one of ${DECISIONS.join(', ')}`);
    const row = await this.own(userId, id);
    if (row.state !== 'pending') fail(409, row.state === 'superseded' ? 'A newer version of this card replaced it.' : 'This card was already decided.', 'not_pending');
    if (decision === 'skipped' && row.kind !== 'run') fail(400, 'Only a routine run can be skipped');
    const remark = text(note, 2000, 'note', { optional: true });
    const result = await this.db.run("UPDATE chat_checkpoints SET state=?,note=?,decided_at=? WHERE id=? AND user_id=? AND state='pending'", [decision, remark, now(), id, userId]);
    if (!result.changes) fail(409, 'This card was already decided.', 'not_pending');
    const decided = await this.get(userId, id);
    let linkError = null;
    await this.mirror(decided, authToken).catch((error) => { linkError = error.message; });
    return { checkpoint: decided, linkError };
  }
}

/**
 * The team board, reached through this instance's own team routes with the
 * person's token: the cloud's team and per-teamspace checks run as for any
 * request they make. Moves are revision-guarded; one retry covers a
 * teammate's concurrent edit.
 */
export function createBoardClient({ fetchImpl = fetch, base = () => `http://localhost:${process.env.PORT || 3333}/api` } = {}) {
  async function call(authToken, path, options = {}) {
    const response = await fetchImpl(base() + path, { ...options, headers: { Authorization: authToken?.startsWith('Bearer ') ? authToken : 'Bearer ' + authToken, 'Content-Type': 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `Board request failed (${response.status})`), { status: response.status, code: body.code });
    return body;
  }
  const taskPath = (teamId, workspaceId, suffix = '') => `/teams/${encodeURIComponent(teamId)}/workspaces/${encodeURIComponent(workspaceId)}/tasks${suffix}`;
  return {
    create: ({ authToken, teamId, workspaceId, title }) => call(authToken, taskPath(teamId, workspaceId), { method: 'POST', body: JSON.stringify({ title, status: 'review' }) }),
    async move({ authToken, teamId, workspaceId, taskId, status }) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const task = await call(authToken, taskPath(teamId, workspaceId, '/' + encodeURIComponent(taskId)));
        if (task.status === status) return task;
        try {
          return await call(authToken, taskPath(teamId, workspaceId, '/' + encodeURIComponent(taskId)), { method: 'PATCH', body: JSON.stringify({ status, expectedRevision: task.revision }) });
        } catch (error) {
          if (error.code !== 'revision_conflict' || attempt === 1) throw error;
        }
      }
      return null;
    },
  };
}
