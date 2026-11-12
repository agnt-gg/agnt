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
// Columns that can carry a work limit, and how the board names them.
export const LIMITED_STATUSES = Object.freeze(['doing', 'review']);
const COLUMN_NAMES = Object.freeze({ doing: 'In progress', review: 'Review' });
const MAX_COLUMN_LIMIT = 99;

/**
 * The column whose work limit keeps an agent from starting a card, or null when it may start.
 * In progress fills the moment a card starts; Review fills when its result arrives, so a full
 * Review holds new starts too: unreviewed work never piles up behind the person reviewing it.
 */
export function columnBlockingStart(counts, limits) {
  for (const status of LIMITED_STATUSES) {
    if (limits[status] && counts[status] >= limits[status]) return COLUMN_NAMES[status];
  }
  return null;
}
export const INBOX_KINDS = Object.freeze(['mention', 'assigned', 'approval', 'run', 'shared']);
const WRITERS = ['owner', 'admin', 'member'];
const MANAGERS = ['owner', 'admin'];
const MAX_BODY = 4000; // comments, and the plain-text copy of an agent's reply
// A person's chat message: room to paste a list, a CSV or a document for Annie to work on.
export const MAX_MESSAGE = 100000;
// What an inbox notification shows of a message.
const MAX_SUMMARY = 280;
const excerpt = (value, max) => (value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value);
const MAX_TITLE = 200;
const MAX_DOC_BYTES = 200000;
const PAGE = 200;

function text(value, max, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value === 'string' && value.length > max) fail(400, `This ${label} is too long: ${value.length.toLocaleString('en-US')} characters, and the limit is ${max.toLocaleString('en-US')}.`);
  if (typeof value !== 'string' || !value.trim()) fail(400, `Invalid ${label}`);
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
  const taskColumns = new Set((await repository.all('PRAGMA table_info(space_tasks)')).map((c) => c.name));
  const addTaskColumn = async (name, definition) => {
    if (taskColumns.has(name)) return false;
    await repository.run(`ALTER TABLE space_tasks ADD COLUMN ${name} ${definition}`);
    return true;
  };
  // My Space tasks: a card only its owner sees. Added after the table shipped, so added in place.
  await addTaskColumn('private_to', 'TEXT');
  // Flow on the board: when a card entered its column, when its agent state last changed, why an
  // agent stopped or is waiting, the input a waiting card will start with, and its review history.
  if (await addTaskColumn('status_changed_at', 'TEXT')) await repository.run('UPDATE space_tasks SET status_changed_at=updated_at');
  await addTaskColumn('agent_state_at', 'TEXT');
  await addTaskColumn('stop_reason', 'TEXT');
  await addTaskColumn('queued_input', 'TEXT');
  await addTaskColumn('send_back_count', 'INTEGER NOT NULL DEFAULT 0');
  await addTaskColumn('approved_at', 'TEXT');
  // Stopping for a decision: the reason and choices, the checks an agent reports with its result,
  // the agent a team lead is deciding for, and the card this one waits on.
  await addTaskColumn('decision_json', 'TEXT');
  await addTaskColumn('checks_json', 'TEXT');
  await addTaskColumn('escalated_from', 'TEXT');
  await addTaskColumn('waits_on', 'TEXT');
  await repository.run('CREATE TABLE IF NOT EXISTS space_settings(workspace_id TEXT PRIMARY KEY REFERENCES shared_workspaces(id),lead_agent_id TEXT,lead_rules TEXT NOT NULL DEFAULT \'\',updated_by TEXT NOT NULL,updated_at TEXT NOT NULL)');
  await repository.run(`CREATE TABLE IF NOT EXISTS space_column_limits(workspace_id TEXT NOT NULL REFERENCES shared_workspaces(id),status TEXT NOT NULL CHECK(status IN ('doing','review')),max_cards INTEGER NOT NULL CHECK(max_cards BETWEEN 1 AND ${MAX_COLUMN_LIMIT}),updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(workspace_id,status))`);
  // A reply's full chat message (text parts, tool calls, images), so the teamspace chat renders
  // exactly what the main chat does. `body` stays the plain text for search, inbox and previews.
  const messageColumns = await repository.all('PRAGMA table_info(space_messages)');
  if (!messageColumns.some((c) => c.name === 'message_json')) await repository.run('ALTER TABLE space_messages ADD COLUMN message_json TEXT');
}

/** The largest stored chat message (tool results included); bigger ones keep their text only. */
const MAX_MESSAGE_JSON = 512 * 1024;
function messageJson(message) {
  if (!message || typeof message !== 'object') return null;
  const { content = '', contentParts = [], toolCalls = [], reasoning = '' } = message;
  const json = JSON.stringify({ content, contentParts, toolCalls, reasoning });
  return json.length <= MAX_MESSAGE_JSON ? json : JSON.stringify({ content, contentParts: [{ type: 'text', text: content }], toolCalls: [], reasoning: '' });
}
function parseMessageJson(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}
const parseJson = parseMessageJson;
const brief = (row) => ({ id: row.id, title: row.title, status: row.status, workspaceId: row.workspace_id });

const now = () => new Date().toISOString();

function messageRow(row) {
  return { id: row.id, workspaceId: row.workspace_id, author: { kind: row.author_kind, id: row.author_id }, body: row.body, mentions: JSON.parse(row.mentions_json || '[]'), taskId: row.task_id || null, createdAt: row.created_at, message: parseMessageJson(row.message_json) };
}
export function taskRow(row) {
  return {
    id: row.id, workspaceId: row.workspace_id, title: row.title, status: row.status,
    assignee: row.assignee_kind ? { kind: row.assignee_kind, id: row.assignee_id } : null,
    due: row.due, createdBy: row.created_by, sourceMessageId: row.source_message_id || null,
    agentState: row.agent_state || null, result: row.result_text || null,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    commentCount: row.comment_count ?? undefined,
    private: Boolean(row.private_to),
    statusChangedAt: row.status_changed_at || row.updated_at,
    agentStateAt: row.agent_state_at || null,
    stopReason: row.stop_reason || null,
    sendBackCount: row.send_back_count || 0,
    approvedAt: row.approved_at || null,
    decision: parseJson(row.decision_json),
    checks: parseJson(row.checks_json) || [],
    escalatedFrom: row.escalated_from || null,
    waitsOn: row.waits_on || null,
    holdingUp: row.holding_up ?? undefined,
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

  /**
   * The card, live and in this workspace. With `user`, someone else's private
   * card is "not found" exactly like a missing one, so its existence never leaks.
   * Server-side paths (agent runs) pass no user.
   */
  async taskIn(teamId, workspaceId, taskId, user = null) {
    const row = await this.repository.get('SELECT * FROM space_tasks WHERE id=? AND team_id=? AND workspace_id=? AND deleted_at IS NULL', [taskId, teamId, workspaceId]);
    if (!row || (user !== null && row.private_to && row.private_to !== user)) fail(404, 'Task not found');
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
      const content = text(body, MAX_MESSAGE, 'message');
      const list = parseMentions(mentions);
      const id = randomUUID();
      const createdAt = now();
      await r.run('INSERT INTO space_messages(id,team_id,workspace_id,author_kind,author_id,body,mentions_json,created_at) VALUES(?,?,?,?,?,?,?,?)', [id, teamId, workspaceId, 'person', user, content, JSON.stringify(list), createdAt]);
      await this.notify(teamId, list.filter((m) => m.kind === 'person' && m.id !== user).map((m) => ({ userId: m.id, kind: 'mention', actor: { kind: 'person', id: user }, summary: excerpt(content, MAX_SUMMARY), workspaceId, target: { kind: 'message', id } })));
      await r.event(teamId, user, 'message.posted', workspaceId);
      return messageRow({ id, workspace_id: workspaceId, author_kind: 'person', author_id: user, body: content, mentions_json: JSON.stringify(list), created_at: createdAt });
    });
  }

  /**
   * An agent's message (its reply in chat). Called by the server only, never from a request body.
   * `message` is the full chat message (contentParts, toolCalls) when the reply came from a chat turn.
   */
  postAgentMessage(teamId, workspaceId, agentId, body, taskId = null, message = null) {
    const r = this.repository;
    return r.transaction(async () => {
      await this.workspace(teamId, workspaceId);
      const id = randomUUID();
      const createdAt = now();
      const content = String(body).slice(0, MAX_BODY);
      const json = messageJson(message);
      await r.run('INSERT INTO space_messages(id,team_id,workspace_id,author_kind,author_id,body,task_id,created_at,message_json) VALUES(?,?,?,?,?,?,?,?,?)', [id, teamId, workspaceId, 'agent', agentId, content, taskId, createdAt, json]);
      return messageRow({ id, workspace_id: workspaceId, author_kind: 'agent', author_id: agentId, body: content, task_id: taskId, created_at: createdAt, message_json: json });
    });
  }

  /** May this person read this teamspace's chat? Throws exactly as reading the messages would. */
  canRead(teamId, user, workspaceId) {
    const r = this.repository;
    return r.transaction(async () => { await r.member(teamId, user); await this.workspace(teamId, workspaceId); return true; });
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

  /** The teamspace board (never anyone's private cards), or with `private`, only the caller's own private cards. */
  tasks(teamId, user, workspaceId, { private: own = false } = {}) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      const rows = await r.all(`SELECT t.*,(SELECT COUNT(*) FROM space_task_comments c WHERE c.task_id=t.id) AS comment_count,
        (SELECT COUNT(*) FROM space_tasks w WHERE w.waits_on=t.id AND w.deleted_at IS NULL AND w.status<>'done') AS holding_up
        FROM space_tasks t WHERE t.workspace_id=? AND t.team_id=? AND t.deleted_at IS NULL AND ${own ? 't.private_to=?' : 't.private_to IS NULL'} ORDER BY t.updated_at DESC LIMIT 500`,
      own ? [workspaceId, teamId, user] : [workspaceId, teamId]);
      return rows.map(taskRow);
    });
  }

  task(teamId, user, workspaceId, taskId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
      const comments = await r.all('SELECT * FROM space_task_comments WHERE task_id=? ORDER BY created_at LIMIT 500', [taskId]);
      // What waits on this card, and what this card waits on.
      const heldUp = await r.all("SELECT id,title,status,workspace_id FROM space_tasks WHERE waits_on=? AND team_id=? AND deleted_at IS NULL AND private_to IS NULL AND status<>'done' ORDER BY created_at LIMIT 50", [taskId, teamId]);
      const waitsOn = row.waits_on ? await r.get('SELECT id,title,status,workspace_id FROM space_tasks WHERE id=? AND team_id=? AND deleted_at IS NULL', [row.waits_on, teamId]) : null;
      return { ...taskRow(row), comments: comments.map(commentRow), heldUp: heldUp.map(brief), waitsOnTask: waitsOn ? brief(waitsOn) : null };
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
      const own = input.private === true;
      if (own && (input.sourceMessageId || (assignee && !(assignee.kind === 'person' && assignee.id === user)))) fail(400, 'A private task can only be assigned to you');
      let sourceMessageId = null;
      if (input.sourceMessageId) {
        const message = await r.get('SELECT id FROM space_messages WHERE id=? AND workspace_id=? AND team_id=? AND deleted_at IS NULL', [input.sourceMessageId, workspaceId, teamId]);
        if (!message) fail(404, 'Message not found');
        sourceMessageId = message.id;
      }
      const id = randomUUID();
      const at = now();
      await r.run('INSERT INTO space_tasks(id,team_id,workspace_id,title,status,assignee_kind,assignee_id,due,created_by,source_message_id,created_at,updated_at,private_to,status_changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, teamId, workspaceId, title, status, assignee?.kind || null, assignee?.id || null, due, user, sourceMessageId, at, at, own ? user : null, at]);
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
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== row.revision) fail(409, 'This card changed. Reload it before saving.', 'revision_conflict');
      const title = input.title === undefined ? row.title : text(input.title, MAX_TITLE, 'task title');
      const status = input.status === undefined ? row.status : input.status;
      if (!TASK_STATUSES.includes(status)) fail(400, 'Invalid status');
      const due = input.due === undefined ? row.due : text(input.due, 60, 'due date', { optional: true });
      const assignee = input.assignee === undefined ? (row.assignee_kind ? { kind: row.assignee_kind, id: row.assignee_id } : null) : parseAssignee(input.assignee);
      const waitsOn = input.waitsOn === undefined ? row.waits_on : await this.dependency(teamId, workspaceId, taskId, input.waitsOn);
      if (row.private_to && assignee && !(assignee.kind === 'person' && assignee.id === user)) fail(400, 'A private task can only be assigned to you');
      const assigneeChanged = input.assignee !== undefined && (assignee?.kind !== (row.assignee_kind || undefined) || assignee?.id !== (row.assignee_id || undefined));
      const statusChanged = status !== row.status;
      // A new assignee, a card moved to "done", or a waiting card someone moves by hand clears the
      // agent's run state: the person has taken the card over.
      const clearAgent = assigneeChanged || status === 'done' || (row.agent_state === 'queued' && statusChanged);
      const at = now();
      await r.run('UPDATE space_tasks SET title=?,status=?,due=?,assignee_kind=?,assignee_id=?,agent_state=?,agent_state_at=?,stop_reason=?,queued_input=?,decision_json=?,escalated_from=?,status_changed_at=?,waits_on=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
        [title, status, due, assignee?.kind || null, assignee?.id || null,
          clearAgent ? null : row.agent_state, clearAgent && row.agent_state ? at : row.agent_state_at,
          clearAgent ? null : row.stop_reason, clearAgent ? null : row.queued_input,
          clearAgent ? null : row.decision_json, clearAgent ? null : row.escalated_from,
          statusChanged ? at : row.status_changed_at, waitsOn, at, taskId, row.revision]);
      if (assigneeChanged) {
        await this.comment(taskId, 'system', user, assignee ? `Assigned to ${assignee.kind === 'agent' ? 'an agent' : 'a teammate'}.` : 'Unassigned.');
        if (assignee?.kind === 'person' && assignee.id !== user) await this.notify(teamId, [{ userId: assignee.id, kind: 'assigned', actor: { kind: 'person', id: user }, summary: title, workspaceId, target: { kind: 'task', id: taskId } }]);
      }
      if (status !== row.status) await r.event(teamId, user, 'task.moved', taskId);
      return { task: taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId])), assigneeChanged };
    });
  }

  /**
   * Change where a card shows: another teamspace, or private to its maker (My Space).
   * `to` must already be authorized for the caller by the route (the cloud checks only
   * the workspace in the URL). `personStays` is the ROUTE's answer to "is the assignee in
   * the target teamspace": a server-only option, never read from the request body.
   * Agents belong to one teamspace, so an agent assignee never travels; a card an
   * agent is running on cannot move until the run ends.
   */
  moveTask(teamId, user, workspaceId, taskId, input = {}, { personStays = false } = {}) {
    const r = this.repository;
    return r.transaction(async () => {
      const member = await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== row.revision) fail(409, 'This card changed. Reload it before saving.', 'revision_conflict');
      if (row.created_by !== user && !MANAGERS.includes(member.role)) fail(403, 'Only the person who made this card, or an admin, can move it');
      if (typeof input.to !== 'string' || !input.to) fail(400, 'Pick where the card shows');
      await this.workspace(teamId, input.to);
      const toPrivate = input.private === true;
      if (input.to === workspaceId && toPrivate === Boolean(row.private_to)) return { task: taskRow(row), moved: false, wasPrivate: Boolean(row.private_to) };
      // Making a card private hides it from everyone else, so only its maker may.
      if (toPrivate && row.created_by !== user) fail(403, 'Only the person who made this card can make it private');
      if (row.agent_state === 'running') fail(409, 'An agent is working on this card. Move it when it finishes.', 'agent_running');
      const keepPerson = row.assignee_kind === 'person' && personStays && (!toPrivate || row.assignee_id === user);
      const at = now();
      await r.run('UPDATE space_tasks SET workspace_id=?,private_to=?,assignee_kind=?,assignee_id=?,agent_state=NULL,agent_state_at=?,stop_reason=NULL,queued_input=NULL,decision_json=NULL,escalated_from=NULL,waits_on=NULL,source_message_id=NULL,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
        [input.to, toPrivate ? user : null, keepPerson ? 'person' : null, keepPerson ? row.assignee_id : null, row.agent_state ? at : row.agent_state_at, at, taskId, row.revision]);
      // The chat message it came from stays where it was said; it no longer points at the card.
      if (row.source_message_id) await r.run('UPDATE space_messages SET task_id=NULL WHERE id=? AND task_id=?', [row.source_message_id, taskId]);
      // Inbox rows about the card open it where it now lives.
      await r.run("UPDATE inbox_items SET workspace_id=? WHERE team_id=? AND target_kind='task' AND target_id=?", [input.to, teamId, taskId]);
      const unassigned = Boolean(row.assignee_kind) && !keepPerson;
      await this.comment(taskId, 'system', user, toPrivate ? 'Made private.' : unassigned ? 'Moved here. Unassigned: the assignee is not in this teamspace.' : 'Moved here.');
      await r.event(teamId, user, 'task.relocated', taskId);
      return { task: taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId])), moved: true, wasPrivate: Boolean(row.private_to) };
    });
  }

  deleteTask(teamId, user, workspaceId, taskId) {
    const r = this.repository;
    return r.transaction(async () => {
      const member = await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
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
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
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

  /**
   * The agent run lifecycle (TeamSpaceAgents).
   * `reason` says why an agent stopped, in words the board shows as "Stopped: <reason>".
   */
  setAgentState(teamId, workspaceId, taskId, { state, status, result, comment, agentId, reason = null, decision = null, checks }) {
    const r = this.repository;
    return r.transaction(async () => {
      const row = await this.taskIn(teamId, workspaceId, taskId);
      const nextStatus = status || row.status;
      const at = now();
      await r.run('UPDATE space_tasks SET agent_state=?,agent_state_at=?,stop_reason=?,queued_input=NULL,decision_json=?,checks_json=COALESCE(?,checks_json),status=?,status_changed_at=?,result_text=COALESCE(?,result_text),revision=revision+1,updated_at=? WHERE id=?',
        [state, at, reason ? String(reason).slice(0, 300) : null, decision ? JSON.stringify(decision) : null,
          checks === undefined ? null : JSON.stringify(checks), nextStatus, nextStatus !== row.status ? at : row.status_changed_at,
          result === undefined ? null : String(result).slice(0, 100000), at, taskId]);
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
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
      if (row.agent_state !== 'waiting') fail(409, 'Nothing is waiting for approval on this card', 'not_waiting');
      const remark = text(note, 1000, 'note', { optional: true });
      const at = now();
      if (approve) {
        await r.run("UPDATE space_tasks SET agent_state=NULL,agent_state_at=?,stop_reason=NULL,status='done',status_changed_at=?,approved_at=?,revision=revision+1,updated_at=? WHERE id=?", [at, at, at, at, taskId]);
      } else {
        await r.run("UPDATE space_tasks SET agent_state='sent_back',agent_state_at=?,stop_reason=NULL,status='doing',status_changed_at=?,send_back_count=send_back_count+1,revision=revision+1,updated_at=? WHERE id=?", [at, at, at, taskId]);
      }
      await this.comment(taskId, 'person', user, approve ? (remark ? `Approved. ${remark}` : 'Approved.') : `Sent back${remark ? ': ' + remark : '.'}`);
      await r.run("UPDATE inbox_items SET state=?,read_at=COALESCE(read_at,?) WHERE team_id=? AND kind='approval' AND target_id=? AND state='pending'", [approve ? 'approved' : 'sent_back', now(), teamId, taskId]);
      await r.event(teamId, user, approve ? 'task.approved' : 'task.sent_back', taskId);
      return taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId]));
    });
  }

  // ── Flow: work limits, and agents starting only when there is room ──────

  /** Work limits on In progress and Review: { doing, review }, null where none is set. */
  async readLimits(workspaceId) {
    const rows = await this.repository.all('SELECT status,max_cards FROM space_column_limits WHERE workspace_id=?', [workspaceId]);
    const limits = { doing: null, review: null };
    for (const row of rows) limits[row.status] = row.max_cards;
    return limits;
  }

  limits(teamId, user, workspaceId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      return this.readLimits(workspaceId);
    });
  }

  /** Set (1 to 99) or remove (null) one column's work limit. */
  setLimit(teamId, user, workspaceId, { status, max }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      if (!LIMITED_STATUSES.includes(status)) fail(400, 'Only In progress and Review can have a work limit');
      if (max === null || max === undefined) {
        await r.run('DELETE FROM space_column_limits WHERE workspace_id=? AND status=?', [workspaceId, status]);
      } else {
        if (!Number.isInteger(max) || max < 1 || max > MAX_COLUMN_LIMIT) fail(400, `A work limit is a whole number from 1 to ${MAX_COLUMN_LIMIT}`);
        await r.run('INSERT INTO space_column_limits(workspace_id,status,max_cards,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,status) DO UPDATE SET max_cards=excluded.max_cards,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
          [workspaceId, status, max, user, now()]);
      }
      await r.event(teamId, user, 'board.limit_changed', workspaceId);
      return this.readLimits(workspaceId);
    });
  }

  /** Cards per column on the shared board, leaving out `exceptTaskId` (the card about to start). */
  async columnCounts(teamId, workspaceId, exceptTaskId) {
    const rows = await this.repository.all('SELECT status,COUNT(*) AS n FROM space_tasks WHERE team_id=? AND workspace_id=? AND deleted_at IS NULL AND private_to IS NULL AND id<>? GROUP BY status', [teamId, workspaceId, exceptTaskId]);
    const counts = { todo: 0, doing: 0, review: 0, done: 0 };
    for (const row of rows) counts[row.status] = row.n;
    return counts;
  }

  /**
   * An agent starts a card unless a column with a work limit is full; then the card waits in To do
   * with the reason and the input it will start with. Decided and written in one transaction, so
   * two starts can never both take the last slot.
   */
  startAgentRun(teamId, workspaceId, taskId, { agentId, input }) {
    const r = this.repository;
    return r.transaction(async () => {
      const row = await this.taskIn(teamId, workspaceId, taskId);
      const fullColumn = columnBlockingStart(await this.columnCounts(teamId, workspaceId, taskId), await this.readLimits(workspaceId));
      const at = now();
      if (fullColumn) {
        const reason = `${fullColumn} is full`;
        const alreadyWaiting = row.agent_state === 'queued';
        // A card that was already waiting keeps its place in the queue.
        await r.run("UPDATE space_tasks SET agent_state='queued',agent_state_at=?,stop_reason=?,queued_input=?,status='todo',status_changed_at=?,revision=revision+1,updated_at=? WHERE id=?",
          [alreadyWaiting ? row.agent_state_at : at, reason, String(input ?? '').slice(0, 100000), row.status === 'todo' ? row.status_changed_at : at, at, taskId]);
        if (!alreadyWaiting) await this.comment(taskId, 'agent', agentId, `Waiting to start: ${reason}.`);
        return { started: false, task: taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId])) };
      }
      // A team lead deciding for another agent keeps the question it is answering.
      await r.run("UPDATE space_tasks SET agent_state='running',agent_state_at=?,stop_reason=NULL,queued_input=NULL,decision_json=CASE WHEN escalated_from IS NULL THEN NULL ELSE decision_json END,checks_json=NULL,status='doing',status_changed_at=?,revision=revision+1,updated_at=? WHERE id=?",
        [at, row.status === 'doing' ? row.status_changed_at : at, at, taskId]);
      await this.comment(taskId, 'agent', agentId, 'On it.');
      return { started: true, task: taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId])) };
    });
  }

  // ── Stops: the team lead decides first, then a person ──────────────────────────

  /** A card this one may wait on: on the same board, live, not itself, and never in a loop. */
  async dependency(teamId, workspaceId, taskId, value) {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 100) fail(400, 'Pick a card to wait on');
    if (value === taskId) fail(400, 'A card cannot wait on itself');
    const target = await this.repository.get('SELECT id,waits_on FROM space_tasks WHERE id=? AND team_id=? AND workspace_id=? AND deleted_at IS NULL AND private_to IS NULL', [value, teamId, workspaceId]);
    if (!target) fail(404, 'That card is not on this board');
    let next = target.waits_on;
    for (let hops = 0; next && hops < 50; hops++) {
      if (next === taskId) fail(400, 'That would make these cards wait on each other');
      next = (await this.repository.get('SELECT waits_on FROM space_tasks WHERE id=?', [next]))?.waits_on;
    }
    return target.id;
  }

  /** The teamspace's team lead (an agent that answers stops first) and its standing rules. */
  async readSettings(workspaceId) {
    const row = await this.repository.get('SELECT lead_agent_id,lead_rules FROM space_settings WHERE workspace_id=?', [workspaceId]);
    return { leadAgentId: row?.lead_agent_id || null, leadRules: row?.lead_rules || '' };
  }

  lead(teamId, user, workspaceId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user);
      await this.workspace(teamId, workspaceId);
      return this.readSettings(workspaceId);
    });
  }

  /** Set the team lead and its rules; leaving `rules` out keeps them. */
  setLead(teamId, user, workspaceId, { agentId, rules }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, MANAGERS);
      await this.workspace(teamId, workspaceId);
      if (agentId !== null && (typeof agentId !== 'string' || !agentId || agentId.length > 200)) fail(400, 'Pick an agent to lead the team');
      const written = rules === undefined ? (await this.readSettings(workspaceId)).leadRules : text(rules, 1000, 'rules', { optional: true });
      await r.run('INSERT INTO space_settings(workspace_id,lead_agent_id,lead_rules,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET lead_agent_id=excluded.lead_agent_id,lead_rules=excluded.lead_rules,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
        [workspaceId, agentId, written, user, now()]);
      await r.event(teamId, user, 'space.lead_changed', workspaceId);
      return this.readSettings(workspaceId);
    });
  }

  /** One card with its latest thread, for the steps after a run. */
  async latestCard(teamId, workspaceId, taskId) {
    const row = await this.taskIn(teamId, workspaceId, taskId);
    const comments = await this.repository.all('SELECT * FROM space_task_comments WHERE task_id=? ORDER BY created_at DESC LIMIT 12', [taskId]);
    return { ...taskRow(row), comments: comments.reverse().map(commentRow) };
  }

  /** The team lead takes a stopped card, to decide for the agent that stopped. */
  handToLead(teamId, workspaceId, taskId, { leadAgentId, fromAgentId }) {
    const r = this.repository;
    return r.transaction(async () => {
      await this.taskIn(teamId, workspaceId, taskId);
      await r.run("UPDATE space_tasks SET assignee_kind='agent',assignee_id=?,escalated_from=?,revision=revision+1,updated_at=? WHERE id=?", [leadAgentId, fromAgentId, now(), taskId]);
      await this.comment(taskId, 'system', fromAgentId, 'Asked the team lead to decide first.');
      return taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId]));
    });
  }

  /** The lead decided: the card goes back to the agent that stopped. Returns the card and the stop it answered. */
  returnFromLead(teamId, workspaceId, taskId, { decision }) {
    const r = this.repository;
    return r.transaction(async () => {
      const row = await this.taskIn(teamId, workspaceId, taskId);
      if (!row.escalated_from) fail(409, 'No team lead is deciding on this card', 'not_escalated');
      const at = now();
      await r.run("UPDATE space_tasks SET assignee_kind='agent',assignee_id=?,escalated_from=NULL,agent_state=NULL,agent_state_at=?,stop_reason=NULL,decision_json=NULL,revision=revision+1,updated_at=? WHERE id=?", [row.escalated_from, at, at, taskId]);
      await this.comment(taskId, 'agent', row.assignee_id, `Decided: ${decision}`);
      return { task: taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId])), stop: parseJson(row.decision_json) };
    });
  }

  /**
   * A person answers a stopped card: one of the choices it offered, or their own words. The card goes
   * to the agent that first stopped (not a team lead who passed it on), which continues with the answer.
   */
  answerStop(teamId, user, workspaceId, taskId, { answer }) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
      if (row.agent_state !== 'blocked' || !row.decision_json || row.assignee_kind !== 'agent') fail(409, 'Nothing on this card is waiting for a decision', 'not_stopped');
      const content = text(answer, 1000, 'answer');
      const at = now();
      await r.run("UPDATE space_tasks SET assignee_kind='agent',assignee_id=?,escalated_from=NULL,agent_state=NULL,agent_state_at=?,stop_reason=NULL,decision_json=NULL,revision=revision+1,updated_at=? WHERE id=?", [row.escalated_from || row.assignee_id, at, at, taskId]);
      await this.comment(taskId, 'person', user, `Decided: ${content}`);
      await r.event(teamId, user, 'task.answered', taskId);
      return { task: taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId])), stop: parseJson(row.decision_json), answer: content };
    });
  }

  /** Try a card again with the agent that stopped on it (a run that failed, not a question). */
  retryStop(teamId, user, workspaceId, taskId) {
    const r = this.repository;
    return r.transaction(async () => {
      await r.member(teamId, user, WRITERS);
      await this.workspace(teamId, workspaceId);
      const row = await this.taskIn(teamId, workspaceId, taskId, user);
      if (row.agent_state !== 'blocked' || row.assignee_kind !== 'agent') fail(409, 'Only a stopped agent card can be tried again', 'not_stopped');
      const at = now();
      await r.run('UPDATE space_tasks SET agent_state=NULL,agent_state_at=?,stop_reason=NULL,decision_json=NULL,revision=revision+1,updated_at=? WHERE id=?', [at, at, taskId]);
      await this.comment(taskId, 'person', user, 'Try again.');
      return taskRow(await r.get('SELECT * FROM space_tasks WHERE id=?', [taskId]));
    });
  }

  /** Cards waiting for room, oldest first: the order agents take them in. */
  async waitingCards(teamId, workspaceId) {
    const rows = await this.repository.all("SELECT * FROM space_tasks WHERE team_id=? AND workspace_id=? AND deleted_at IS NULL AND private_to IS NULL AND agent_state='queued' AND assignee_kind='agent' ORDER BY agent_state_at,created_at LIMIT 50", [teamId, workspaceId]);
    return rows.map((row) => ({ ...taskRow(row), queuedInput: row.queued_input || '' }));
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
