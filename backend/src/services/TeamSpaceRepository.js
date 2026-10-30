import { randomUUID } from 'node:crypto';

/**
 * TEAMSPACE COLLABORATION: chat, board tasks, task threads, the inbox, and
 * creating a doc inside a teamspace.
 *
 * Lives in teams.db beside shared_workspaces and runs every write through the
 * TeamRepository's serialized transaction queue, so a membership revocation can
 * never interleave with a write. Authority is NOT decided here: `repository.member`
 * is the request-bound adapter TeamRoutes installs, which answers from the cloud
 * for this request only. This module only enforces shape, ownership of what a
 * caller may edit, and that every row belongs to the workspace it is addressed by.
 */

const fail = (status, message, code) => {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
};

export const TASK_STATUSES = Object.freeze(['todo', 'doing', 'review', 'done']);
export const INBOX_KINDS = Object.freeze(['mention', 'assigned', 'approval', 'run', 'shared']);
const WRITERS = ['owner', 'admin', 'member'];
const MANAGERS = ['owner', 'admin'];
const MAX_BODY = 4000;
const MAX_TITLE = 200;
const MAX_DOC_BYTES = 200000;
const PAGE = 200;

function text(value, max, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `Invalid ${label}`);
  return value.trim();
}

/** `{kind:'person'|'agent', id}` or null. Ids are opaque strings, bounded. */
export function parseAssignee(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'object' || !['person', 'agent'].includes(value.kind)) fail(400, 'Invalid assignee');
  if (typeof value.id !== 'string' || !value.id || value.id.length > 200) fail(400, 'Invalid assignee');
  return { kind: value.kind, id: value.id };
}

/** Distinct, bounded mention list. Who may be mentioned is checked by the caller against the team. */
export function parseMentions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) fail(400, 'Invalid mentions');
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const parsed = parseAssignee(item);
    if (!parsed) fail(400, 'Invalid mentions');
    const key = parsed.kind + ':' + parsed.id;
    if (!seen.has(key)) { seen.add(key); out.push(parsed); }
  }
  return out;
}

export async function initializeTeamSpaces(repository) {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS space_messages(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES shared_workspaces(id),author_kind TEXT NOT NULL CHECK(author_kind IN ('person','agent')),author_id TEXT NOT NULL,body TEXT NOT NULL,mentions_json TEXT NOT NULL DEFAULT '[]',task_id TEXT,created_at TEXT NOT NULL,deleted_at TEXT)`,
    'CREATE INDEX IF NOT EXISTS space_messages_ws ON space_messages(workspace_id,created_at)',
    `CREATE TABLE IF NOT EXISTS space_tasks(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES shared_workspaces(id),title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('todo','doing','review','done')),assignee_kind TEXT CHECK(assignee_kind IN ('person','agent')),assignee_id TEXT,due TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,source_message_id TEXT,agent_state TEXT,result_text TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT)`,
    'CREATE INDEX IF NOT EXISTS space_tasks_ws ON space_tasks(workspace_id,deleted_at,updated_at)',
    `CREATE TABLE IF NOT EXISTS space_task_comments(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES space_tasks(id),author_kind TEXT NOT NULL CHECK(author_kind IN ('person','agent','system')),author_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS space_task_comments_task ON space_task_comments(task_id,created_at)',
    `CREATE TABLE IF NOT EXISTS inbox_items(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,actor_kind TEXT NOT NULL,actor_id TEXT NOT NULL,summary TEXT NOT NULL,workspace_id TEXT,target_kind TEXT,target_id TEXT,state TEXT,read_at TEXT,created_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS inbox_items_user ON inbox_items(team_id,user_id,created_at)',
  ]) await repository.run(sql);
}

const now = () => new Date().toISOString();

function messageRow(row) {
  return { id: row.id, workspaceId: row.workspace_id, author: { kind: row.author_kind, id: row.author_id }, body: row.body, mentions: JSON.parse(row.mentions_json || '[]'), taskId: row.task_id || null, createdAt: row.created_at };
}
export function taskRow(row) {
  return {
    id: row.id, workspaceId: row.workspace_id, title: row.title, status: row.status,
    assignee: row.assignee_kind ? { kind: row.assignee_kind, id: row.assignee_id } : null,
    due: row.due, createdBy: row.created_by, sourceMessageId: row.source_message_id || null,
    agentState: row.agent_state || null, result: row.result_text || null,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    commentCount: row.comment_count ?? undefined,
  };
}
function commentRow(row) {
  return { id: row.id, taskId: row.task_id, author: { kind: row.author_kind, id: row.author_id }, body: row.body, createdAt: row.created_at };
}
function inboxRow(row) {
  return { id: row.id, kind: row.kind, actor: { kind: row.actor_kind, id: row.actor_id }, summary: row.summary, workspaceId: row.workspace_id, target: row.target_kind ? { kind: row.target_kind, id: row.target_id } : null, state: row.state || null, read: Boolean(row.read_at), createdAt: row.created_at };
}

export class TeamSpaceRepository {
  constructor(repository) {
    this.repository = repository;
  }

  /** The workspace, live and inside this team; 404 otherwise (never reveals another team's ids). */
  async workspace(teamId, workspaceId) {
    const row = await this.repository.get('SELECT id FROM shared_workspaces WHERE id=? AND team_id=? AND archived_at IS NULL', [workspaceId, teamId]);
    if (!row) fail(404, 'Workspace not found');
    return row;
  }

  async taskIn(teamId, workspaceId, taskId) {
    const row = await this.repository.get('SELECT * FROM space_tasks WHERE id=? AND team_id=? AND workspace_id=? AND deleted_at IS NULL', [taskId, teamId, workspaceId]);
    if (!row) fail(404, 'Task not found');
    return row;
  }

  async notify(teamId, items) {
    for (const item of items) {
      if (!INBOX_KINDS.includes(item.kind)) fail(500, 'Unknown inbox kind');
      await this.repository.run('INSERT INTO inbox_items(id,team_id,user_id,kind,actor_kind,actor_id,summary,workspace_id,target_kind,target_id,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [randomUUID(), teamId, item.userId, item.kind, item.actor.kind, item.actor.id, String(item.summary).slice(0, 300), item.workspaceId || null, item.target?.kind || null, item.target?.id || null, item.state || null, now()]);
    }
  }

  // ── Chat ────────────────────────────────────────────────────────────────

  messages(teamId, user, workspaceId, { before } = {}) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      const rows = before
        ? await r.all('SELECT * FROM space_messages WHERE workspace_id=? AND team_id=? AND deleted_at IS NULL AND created_at<? ORDER BY created_at DESC LIMIT ?', [workspaceId, teamId, String(before), PAGE])
        : await r.all('SELECT * FROM space_messages WHERE workspace_id=? AND team_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?', [workspaceId, teamId, PAGE]);
      return rows.reverse().map(messageRow);
    });
  }

  /**
   * Post as a person. `mentions` must already be validated against the team
   * (people) and the workspace (agents) by the caller. Each mentioned person
   * other than the author gets an inbox item.
   */
  postMessage(teamId, user, workspaceId, { body, mentions = [] }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const content = text(body, MAX_BODY, 'message');
      const list = parseMentions(mentions);
      const id = randomUUID();
      const createdAt = now();
      await r.run('INSERT INTO space_messages(id,team_id,workspace_id,author_kind,author_id,body,mentions_json,created_at) VALUES(?,?,?,?,?,?,?,?)', [id, teamId, workspaceId, 'person', user, content, JSON.stringify(list), createdAt]);
      await this.notify(teamId, list.filter((m) => m.kind === 'person' && m.id !== user).map((m) => ({ userId: m.id, kind: 'mention', actor: { kind: 'person', id: user }, summary: content, workspaceId, target: { kind: 'message', id } })));
      await r.event(teamId, user, 'message.posted', workspaceId);
      return messageRow({ id, workspace_id: workspaceId, author_kind: 'person', author_id: user, body: content, mentions_json: JSON.stringify(list), created_at: createdAt });
    });
  }

  /** An agent's message (its reply in chat). Called by the server only, never from a request body. */
  postAgentMessage(teamId, workspaceId, agentId, body, taskId = null) {
    const r = this.repository;
    return r.transaction(async () => {
      await this.workspace(teamId, workspaceId);
      const id = randomUUID();
      const createdAt = now();
      const content = String(body).slice(0, MAX_BODY);
      await r.run('INSERT INTO space_messages(id,team_id,workspace_id,author_kind,author_id,body,task_id,created_at) VALUES(?,?,?,?,?,?,?,?)', [id, teamId, workspaceId, 'agent', agentId, content, taskId, createdAt]);
      return messageRow({ id, workspace_id: workspaceId, author_kind: 'agent', author_id: agentId, body: content, task_id: taskId, created_at: createdAt });
    });
  }

  /** Authors delete their own messages; owners and admins may delete any. */
  deleteMessage(teamId, user, workspaceId, messageId) {
    const r = this.repository;
    return r.transaction(async () => {
      const member = await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await r.get('SELECT * FROM space_messages WHERE id=? AND workspace_id=? AND team_id=? AND deleted_at IS NULL', [messageId, workspaceId, teamId]);
      if (!row) fail(404, 'Message not found');
      const ownMessage = row.author_kind === 'person' && row.author_id === user;
      if (!ownMessage && !MANAGERS.includes(member.role)) fail(403, 'You can only delete your own messages');
      await r.run('UPDATE space_messages SET deleted_at=? WHERE id=?', [now(), messageId]);
      return { success: true };
    });
  }

  // ── Board ───────────────────────────────────────────────────────────────

  tasks(teamId, user, workspaceId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      const rows = await r.all(`SELECT t.*,(SELECT COUNT(*) FROM space_task_comments c WHERE c.task_id=t.id) AS comment_count
        FROM space_tasks t WHERE t.workspace_id=? AND t.team_id=? AND t.deleted_at IS NULL ORDER BY t.updated_at DESC LIMIT 500`, [workspaceId, teamId]);
      return rows.map(taskRow);
    });
  }

  task(teamId, user, workspaceId, taskId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId);
      const comments = await r.all('SELECT * FROM space_task_comments WHERE task_id=? ORDER BY created_at LIMIT 500', [taskId]);
      return { ...taskRow(row), comments: comments.map(commentRow) };
    });
  }

  createTask(teamId, user, workspaceId, input = {}) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const title = text(input.title, MAX_TITLE, 'task title');
      const status = input.status === undefined ? 'todo' : input.status;
      if (!TASK_STATUSES.includes(status)) fail(400, 'Invalid status');
      const assignee = parseAssignee(input.assignee);
      const due = text(input.due, 60, 'due date', { optional: true });
      let sourceMessageId = null;
      if (input.sourceMessageId) {
        const message = await r.get('SELECT id FROM space_messages WHERE id=? AND workspace_id=? AND team_id=? AND deleted_at IS NULL', [input.sourceMessageId, workspaceId, teamId]);
        if (!message) fail(404, 'Message not found');
        sourceMessageId = message.id;
      }
      const id = randomUUID();
      const at = now();
      await r.run('INSERT INTO space_tasks(id,team_id,workspace_id,title,status,assignee_kind,assignee_id,due,created_by,source_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, teamId, workspaceId, title, status, assignee?.kind || null, assignee?.id || null, due, user, sourceMessageId, at, at]);
      if (sourceMessageId) await r.run('UPDATE space_messages SET task_id=? WHERE id=? AND task_id IS NULL', [id, sourceMessageId]);
      if (assignee?.kind === 'person' && assignee.id !== user) {
        await this.notify(teamId, [{ userId: assignee.id, kind: 'assigned', actor: { kind: 'person', id: user }, summary: title, workspaceId, target: { kind: 'task', id } }]);
      }
      await r.event(teamId, user, 'task.created', id);
      return taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [id]));
    });
  }

  /**
   * Partial update guarded by revision: two people moving one card never
   * silently overwrite each other. Returns { task, assigneeChanged }.
   */
  updateTask(teamId, user, workspaceId, taskId, input = {}) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== row.revision) fail(409, 'This card changed. Reload it before saving.', 'revision_conflict');
      const title = input.title === undefined ? row.title : text(input.title, MAX_TITLE, 'task title');
      const status = input.status === undefined ? row.status : input.status;
      if (!TASK_STATUSES.includes(status)) fail(400, 'Invalid status');
      const due = input.due === undefined ? row.due : text(input.due, 60, 'due date', { optional: true });
      const assignee = input.assignee === undefined ? (row.assignee_kind ? { kind: row.assignee_kind, id: row.assignee_id } : null) : parseAssignee(input.assignee);
      const assigneeChanged = input.assignee !== undefined && (assignee?.kind !== (row.assignee_kind || undefined) || assignee?.id !== (row.assignee_id || undefined));
      // A new assignee, or a card moved off "done", clears an agent's stale run state.
      const agentState = assigneeChanged ? null : status === 'done' ? null : row.agent_state;
      await r.run('UPDATE space_tasks SET title=?,status=?,due=?,assignee_kind=?,assignee_id=?,agent_state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
        [title, status, due, assignee?.kind || null, assignee?.id || null, agentState, now(), taskId, row.revision]);
      if (assigneeChanged) {
        await this.comment(taskId, 'system', user, assignee ? `Assigned to ${assignee.kind === 'agent' ? 'an agent' : 'a teammate'}.` : 'Unassigned.');
        if (assignee?.kind === 'person' && assignee.id !== user) await this.notify(teamId, [{ userId: assignee.id, kind: 'assigned', actor: { kind: 'person', id: user }, summary: title, workspaceId, target: { kind: 'task', id: taskId } }]);
      }
      if (status !== row.status) await r.event(teamId, user, 'task.moved', taskId);
      return { task: taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId])), assigneeChanged };
    });
  }

  deleteTask(teamId, user, workspaceId, taskId) {
    const r = this.repository;
    return r.transaction(async () => {
      const member = await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId);
      if (row.created_by !== user && !MANAGERS.includes(member.role)) fail(403, 'Only the person who made this card, or an admin, can delete it');
      await r.run('UPDATE space_tasks SET deleted_at=?,revision=revision+1 WHERE id=?', [now(), taskId]);
      await r.event(teamId, user, 'task.deleted', taskId);
      return { success: true };
    });
  }

  async comment(taskId, kind, authorId, body) {
    const id = randomUUID();
    const createdAt = now();
    await this.repository.run('INSERT INTO space_task_comments(id,task_id,author_kind,author_id,body,created_at) VALUES(?,?,?,?,?,?)', [id, taskId, kind, authorId, String(body).slice(0, MAX_BODY), createdAt]);
    return commentRow({ id, task_id: taskId, author_kind: kind, author_id: authorId, body: String(body).slice(0, MAX_BODY), created_at: createdAt });
  }

  addComment(teamId, user, workspaceId, taskId, { body, mentions = [] }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId);
      const content = text(body, MAX_BODY, 'comment');
      const list = parseMentions(mentions);
      const created = await this.comment(taskId, 'person', user, content);
      await r.run('UPDATE space_tasks SET updated_at=? WHERE id=?', [now(), taskId]);
      const watchers = new Set(list.filter((m) => m.kind === 'person').map((m) => m.id));
      if (row.assignee_kind === 'person') watchers.add(row.assignee_id);
      watchers.add(row.created_by);
      watchers.delete(user);
      await this.notify(teamId, [...watchers].map((id) => ({ userId: id, kind: 'mention', actor: { kind: 'person', id: user }, summary: `${row.title}: ${content}`, workspaceId, target: { kind: 'task', id: taskId } })));
      return created;
    });
  }

  /** The agent run lifecycle, written by the server (TeamSpaceAgents), never by a request body. */
  setAgentState(teamId, workspaceId, taskId, { state, status, result, comment, agentId }) {
    const r = this.repository;
    return r.transaction(async () => {
      const row = await this.taskIn(teamId, workspaceId, taskId);
      await r.run('UPDATE space_tasks SET agent_state=?,status=?,result_text=COALESCE(?,result_text),revision=revision+1,updated_at=? WHERE id=?',
        [state, status || row.status, result === undefined ? null : String(result).slice(0, 100000), now(), taskId]);
      if (comment) await this.comment(taskId, 'agent', agentId, comment);
      return taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId]));
    });
  }

  /** Ask the person who made (or last assigned) the card to approve an agent's result. */
  requestApproval(teamId, workspaceId, taskId, agentId) {
    const r = this.repository;
    return r.transaction(async () => {
      const row = await this.taskIn(teamId, workspaceId, taskId);
      await r.run("UPDATE inbox_items SET state='superseded' WHERE team_id=? AND kind='approval' AND target_id=? AND state='pending'", [teamId, taskId]);
      await this.notify(teamId, [{ userId: row.created_by, kind: 'approval', actor: { kind: 'agent', id: agentId }, summary: row.title, workspaceId, target: { kind: 'task', id: taskId }, state: 'pending' }]);
      return { userId: row.created_by };
    });
  }

  /**
   * Approve or send back an agent's result. Anyone who can write in the
   * workspace may decide; the decision is recorded with their name.
   */
  decide(teamId, user, workspaceId, taskId, { approve, note }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId);
      if (row.agent_state !== 'waiting') fail(409, 'Nothing is waiting for approval on this card', 'not_waiting');
      const remark = text(note, 1000, 'note', { optional: true });
      await r.run('UPDATE space_tasks SET agent_state=?,status=?,revision=revision+1,updated_at=? WHERE id=?', [approve ? null : 'sent_back', approve ? 'done' : 'doing', now(), taskId]);
      await this.comment(taskId, 'person', user, approve ? (remark ? `Approved. ${remark}` : 'Approved.') : `Sent back${remark ? ': ' + remark : '.'}`);
      await r.run("UPDATE inbox_items SET state=?,read_at=COALESCE(read_at,?) WHERE team_id=? AND kind='approval' AND target_id=? AND state='pending'", [approve ? 'approved' : 'sent_back', now(), teamId, taskId]);
      await r.event(teamId, user, approve ? 'task.approved' : 'task.sent_back', taskId);
      return taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId]));
    });
  }

  // ── Inbox ───────────────────────────────────────────────────────────────

  inbox(teamId, user) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      const rows = await r.all('SELECT * FROM inbox_items WHERE team_id=? AND user_id=? ORDER BY created_at DESC LIMIT 200', [teamId, user]);
      return rows.map(inboxRow);
    });
  }

  markRead(teamId, user, itemId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      const result = await r.run('UPDATE inbox_items SET read_at=COALESCE(read_at,?) WHERE id=? AND team_id=? AND user_id=?', [now(), itemId, teamId, user]);
      if (!result.changes) fail(404, 'Inbox item not found');
      return { success: true };
    });
  }

  markAllRead(teamId, user) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await r.run('UPDATE inbox_items SET read_at=? WHERE team_id=? AND user_id=? AND read_at IS NULL', [now(), teamId, user]);
      return { success: true };
    });
  }

  // ── Docs ────────────────────────────────────────────────────────────────
  //
  // A teamspace doc is a versioned team asset linked to exactly one teamspace
  // in `space_docs`. It is read and saved ONLY through that teamspace's routes,
  // which the cloud gates per workspace. The team library endpoints (/assets)
  // exclude these rows (TeamRepository), so someone without access to a
  // teamspace cannot list or read its docs through the library.

  async docIn(teamId, workspaceId, docId) {
    const row = await this.repository.get('SELECT a.* FROM team_assets a JOIN space_docs d ON d.asset_id=a.id WHERE a.id=? AND a.team_id=? AND d.workspace_id=?', [docId, teamId, workspaceId]);
    if (!row) fail(404, 'Doc not found');
    return row;
  }

  /** Created with its teamspace link in one transaction: the asset can never exist unlinked. */
  createDoc(teamId, user, workspaceId, { name, content = '' }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const title = text(name, 180, 'doc name');
      if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_DOC_BYTES) fail(400, 'Doc content must be text (maximum 200 KB)');
      const id = randomUUID();
      const at = now();
      await r.run('INSERT INTO team_assets VALUES(?,?,?,?,?,?,?)', [id, teamId, title, 'markdown', 1, user, at]);
      await r.run('INSERT INTO team_asset_versions VALUES(?,?,?,?,?)', [id, 1, content, user, at]);
      await r.run('INSERT INTO space_docs(asset_id,workspace_id,created_by,created_at) VALUES(?,?,?,?)', [id, workspaceId, user, at]);
      await r.event(teamId, user, 'doc.created', id);
      return { id, name: title, revision: 1, updatedBy: user, updatedAt: at };
    });
  }

  /** This teamspace's docs, newest first, without bodies. */
  docs(teamId, user, workspaceId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      const rows = await r.all('SELECT a.id,a.name,a.revision,a.updated_by,a.updated_at,d.created_by FROM team_assets a JOIN space_docs d ON d.asset_id=a.id WHERE d.workspace_id=? AND a.team_id=? ORDER BY a.updated_at DESC LIMIT 500', [workspaceId, teamId]);
      return rows.map((row) => ({ id: row.id, name: row.name, revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at, createdBy: row.created_by }));
    });
  }

  doc(teamId, user, workspaceId, docId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      const row = await this.docIn(teamId, workspaceId, docId);
      const version = await r.get('SELECT content FROM team_asset_versions WHERE asset_id=? AND revision=?', [docId, row.revision]);
      return { id: row.id, name: row.name, revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at, content: version?.content ?? '' };
    });
  }

  /** Save a new immutable revision. A stale expectedRevision is refused: nobody's edit is silently lost. */
  saveDoc(teamId, user, workspaceId, docId, { name, content, expectedRevision }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.docIn(teamId, workspaceId, docId);
      if (!Number.isInteger(expectedRevision) || expectedRevision !== row.revision) fail(409, 'Someone else changed this doc. Reload to see their version; your edit has not been applied.', 'revision_conflict');
      const title = name === undefined ? row.name : text(name, 180, 'doc name');
      const current = await r.get('SELECT content FROM team_asset_versions WHERE asset_id=? AND revision=?', [docId, row.revision]);
      const body = content === undefined ? current?.content ?? '' : content;
      if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_DOC_BYTES) fail(400, 'Doc content must be text (maximum 200 KB)');
      const revision = row.revision + 1;
      const at = now();
      await r.run('UPDATE team_assets SET name=?,revision=?,updated_by=?,updated_at=? WHERE id=? AND revision=?', [title, revision, user, at, docId, row.revision]);
      await r.run('INSERT INTO team_asset_versions VALUES(?,?,?,?,?)', [docId, revision, body, user, at]);
      await r.event(teamId, user, 'doc.revised', docId);
      return { id: docId, name: title, revision, updatedBy: user, updatedAt: at };
    });
  }

  deleteDoc(teamId, user, workspaceId, docId) {
    const r = this.repository;
    return r.transaction(async () => {
      const member = await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      await this.docIn(teamId, workspaceId, docId);
      const link = await r.get('SELECT created_by FROM space_docs WHERE asset_id=?', [docId]);
      if (link.created_by !== user && !MANAGERS.includes(member.role)) fail(403, 'Only the person who made this doc, or an admin, can delete it');
      // Unlinked, never destroyed: revisions stay for the audit trail, and the row stays hidden from the library.
      await r.run('UPDATE space_docs SET workspace_id=? WHERE asset_id=?', ['deleted:' + workspaceId, docId]);
      await r.event(teamId, user, 'doc.deleted', docId);
      return { success: true };
    });
  }
}
