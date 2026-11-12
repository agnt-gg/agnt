import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { TeamRepository } from './TeamRepository.js';
import { initializeTeamWorkspaces } from './TeamWorkspaceRepository.js';
import { TeamSpaceRepository, initializeTeamSpaces, parseMentions, MAX_MESSAGE, columnBlockingStart } from './TeamSpaceRepository.js';

/**
 * The repository is driven the way TeamRoutes drives it: `member` is the
 * request-bound adapter that answers from the cloud. Here a role table plays
 * the cloud, so these tests are about the data rules, not authority.
 */
let db, base, spaces, roles;
const TEAM = 'team-1';

function asCloud(repository, table) {
  const scoped = Object.create(repository);
  scoped.transaction = repository.transaction.bind(repository);
  scoped.member = async (teamId, userId, allowed = null) => {
    const role = table.get(userId);
    if (teamId !== TEAM || !role) throw Object.assign(new Error('Team not found'), { status: 404 });
    if (allowed && !allowed.includes(role)) throw Object.assign(new Error('Your role does not allow this operation'), { status: 403 });
    return { team_id: teamId, user_id: userId, role };
  };
  return scoped;
}

async function workspace(name) {
  const id = 'ws-' + name;
  await base.run('INSERT INTO shared_workspaces(id,team_id,name,created_by) VALUES(?,?,?,?)', [id, TEAM, name, 'owner']);
  return id;
}

beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  base = new TeamRepository(db);
  await base.ready;
  await base.run('INSERT INTO teams VALUES(?,?,?,?)', [TEAM, 'Acme', 'owner', new Date().toISOString()]);
  await initializeTeamWorkspaces(base);
  await initializeTeamSpaces(base);
  roles = new Map([['owner', 'owner'], ['admin', 'admin'], ['ana', 'member'], ['ben', 'member'], ['vic', 'viewer']]);
  spaces = new TeamSpaceRepository(asCloud(base, roles));
});
afterEach(() => new Promise((resolve) => db.close(() => resolve())));

describe('teamspace chat', () => {
  it('posts, lists in order, and gives each mentioned teammate (not the author) an inbox item', async () => {
    const ws = await workspace('sales');
    await spaces.postMessage(TEAM, 'ana', ws, { body: 'first' });
    await spaces.postMessage(TEAM, 'ana', ws, { body: 'hey @ben and me', mentions: [{ kind: 'person', id: 'ben' }, { kind: 'person', id: 'ana' }] });
    const list = await spaces.messages(TEAM, 'ben', ws);
    expect(list.map((m) => m.body)).toEqual(['first', 'hey @ben and me']);
    expect((await spaces.inbox(TEAM, 'ben')).map((i) => [i.kind, i.actor.id, i.read])).toEqual([['mention', 'ana', false]]);
    expect(await spaces.inbox(TEAM, 'ana')).toEqual([]);
  });

  it('a pasted list or CSV well over 4,000 characters posts whole; the inbox shows an excerpt', async () => {
    const ws = await workspace('sales');
    const csv = 'rank,prospect\n' + Array.from({ length: 300 }, (_, i) => `"${i + 1}","Prospect ${i + 1} — a longer descriptive line"`).join('\n');
    expect(csv.length).toBeGreaterThan(14000);
    await spaces.postMessage(TEAM, 'ana', ws, { body: `@ben here i found this:\n\n${csv}`, mentions: [{ kind: 'person', id: 'ben' }] });
    const [stored] = await spaces.messages(TEAM, 'ben', ws);
    expect(stored.body.endsWith('a longer descriptive line"')).toBe(true);
    const [note] = await spaces.inbox(TEAM, 'ben');
    expect(note.summary.length).toBeLessThanOrEqual(280);
    expect(note.summary.endsWith('…')).toBe(true);
  });

  it('a message over the limit says it is too long and by how much, not just "Invalid"', async () => {
    const ws = await workspace('sales');
    await expect(spaces.postMessage(TEAM, 'ana', ws, { body: 'x'.repeat(MAX_MESSAGE + 5) })).rejects.toMatchObject({ status: 400, message: 'This message is too long: 100,005 characters, and the limit is 100,000.' });
    await expect(spaces.postMessage(TEAM, 'ana', ws, { body: '   ' })).rejects.toMatchObject({ status: 400, message: 'Invalid message' });
  });

  it('a viewer reads but cannot post', async () => {
    const ws = await workspace('sales');
    await expect(spaces.postMessage(TEAM, 'vic', ws, { body: 'hi' })).rejects.toMatchObject({ status: 403 });
    await expect(spaces.messages(TEAM, 'vic', ws)).resolves.toEqual([]);
  });

  it('only the author or an admin deletes a message', async () => {
    const ws = await workspace('sales');
    const message = await spaces.postMessage(TEAM, 'ana', ws, { body: 'oops' });
    await expect(spaces.deleteMessage(TEAM, 'ben', ws, message.id)).rejects.toMatchObject({ status: 403 });
    await spaces.deleteMessage(TEAM, 'admin', ws, message.id);
    expect(await spaces.messages(TEAM, 'ana', ws)).toEqual([]);
  });

  it('refuses empty, oversized and malformed input', async () => {
    const ws = await workspace('sales');
    await expect(spaces.postMessage(TEAM, 'ana', ws, { body: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(spaces.postMessage(TEAM, 'ana', ws, { body: 'x'.repeat(MAX_MESSAGE + 1) })).rejects.toMatchObject({ status: 400 });
    expect(() => parseMentions([{ kind: 'robot', id: 'x' }])).toThrow(/mentions|assignee/i);
    expect(() => parseMentions('ben')).toThrow();
    expect(parseMentions([{ kind: 'person', id: 'a' }, { kind: 'person', id: 'a' }])).toHaveLength(1);
  });

  it('never serves a workspace of another team or an archived one', async () => {
    const ws = await workspace('sales');
    await base.run("INSERT INTO teams VALUES('team-2','Other','x','now')");
    await base.run("INSERT INTO shared_workspaces(id,team_id,name,created_by) VALUES('foreign','team-2','F','x')");
    await expect(spaces.messages(TEAM, 'ana', 'foreign')).rejects.toMatchObject({ status: 404 });
    await base.run('UPDATE shared_workspaces SET archived_at=CURRENT_TIMESTAMP WHERE id=?', [ws]);
    await expect(spaces.postMessage(TEAM, 'ana', ws, { body: 'hi' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('teamspace board', () => {
  it('creates a card from a message and links the message to it', async () => {
    const ws = await workspace('sales');
    const message = await spaces.postMessage(TEAM, 'ana', ws, { body: 'Globex wants pricing by Friday' });
    const task = await spaces.createTask(TEAM, 'ana', ws, { title: 'Pricing for Globex', sourceMessageId: message.id, due: 'Fri' });
    expect(task).toMatchObject({ status: 'todo', due: 'Fri', sourceMessageId: message.id, revision: 1 });
    expect((await spaces.messages(TEAM, 'ana', ws))[0].taskId).toBe(task.id);
  });

  it('a stale revision never overwrites a teammate\u2019s move', async () => {
    const ws = await workspace('sales');
    const task = await spaces.createTask(TEAM, 'ana', ws, { title: 'Card' });
    await spaces.updateTask(TEAM, 'ben', ws, task.id, { status: 'doing', expectedRevision: 1 });
    await expect(spaces.updateTask(TEAM, 'ana', ws, task.id, { status: 'done', expectedRevision: 1 })).rejects.toMatchObject({ status: 409, code: 'revision_conflict' });
    expect((await spaces.task(TEAM, 'ana', ws, task.id)).status).toBe('doing');
  });

  it('assigning a person tells them, and the thread records it', async () => {
    const ws = await workspace('sales');
    const task = await spaces.createTask(TEAM, 'ana', ws, { title: 'Call Northwind' });
    const { assigneeChanged } = await spaces.updateTask(TEAM, 'ana', ws, task.id, { assignee: { kind: 'person', id: 'ben' }, expectedRevision: 1 });
    expect(assigneeChanged).toBe(true);
    expect((await spaces.inbox(TEAM, 'ben')).map((i) => i.kind)).toEqual(['assigned']);
    expect((await spaces.task(TEAM, 'ana', ws, task.id)).comments.map((c) => c.author.kind)).toEqual(['system']);
  });

  it('a card is only reachable through its own workspace', async () => {
    const sales = await workspace('sales');
    const ops = await workspace('ops');
    const task = await spaces.createTask(TEAM, 'ana', sales, { title: 'Sales only' });
    await expect(spaces.task(TEAM, 'ana', ops, task.id)).rejects.toMatchObject({ status: 404 });
    await expect(spaces.updateTask(TEAM, 'ana', ops, task.id, { status: 'done', expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    expect(await spaces.tasks(TEAM, 'ana', ops)).toEqual([]);
  });

  it('only the creator or an admin deletes a card', async () => {
    const ws = await workspace('sales');
    const task = await spaces.createTask(TEAM, 'ana', ws, { title: 'Mine' });
    await expect(spaces.deleteTask(TEAM, 'ben', ws, task.id)).rejects.toMatchObject({ status: 403 });
    await spaces.deleteTask(TEAM, 'ana', ws, task.id);
    expect(await spaces.tasks(TEAM, 'ana', ws)).toEqual([]);
  });

  it('a comment reaches the assignee, the creator and anyone mentioned, never the author', async () => {
    const ws = await workspace('sales');
    const task = await spaces.createTask(TEAM, 'ana', ws, { title: 'Card', assignee: { kind: 'person', id: 'ben' } });
    await spaces.markAllRead(TEAM, 'ben');
    await spaces.addComment(TEAM, 'ben', ws, task.id, { body: 'done, @admin please check', mentions: [{ kind: 'person', id: 'admin' }] });
    expect((await spaces.inbox(TEAM, 'ana')).map((i) => i.kind)).toEqual(['mention']);
    expect((await spaces.inbox(TEAM, 'admin')).map((i) => i.kind)).toEqual(['mention']);
    expect((await spaces.inbox(TEAM, 'ben')).filter((i) => !i.read)).toEqual([]);
  });
});

// My Space: a private card is its owner's alone, and invisible to everyone else (not even "forbidden").
describe('private tasks', () => {
  it('show only on their owner\'s My Space, never on the teamspace board', async () => {
    const ws = await workspace('General');
    const mine = await spaces.createTask(TEAM, 'ana', ws, { title: 'Call the dentist', private: true });
    await spaces.createTask(TEAM, 'ana', ws, { title: 'Team card' });
    expect(mine.private).toBe(true);
    expect((await spaces.tasks(TEAM, 'ana', ws)).map((t) => t.title)).toEqual(['Team card']);
    expect((await spaces.tasks(TEAM, 'ana', ws, { private: true })).map((t) => t.title)).toEqual(['Call the dentist']);
    expect(await spaces.tasks(TEAM, 'ben', ws, { private: true })).toEqual([]);
    expect((await spaces.tasks(TEAM, 'owner', ws)).map((t) => t.title)).toEqual(['Team card']);
  });
  it('are not found for anyone else, even an owner, on every path', async () => {
    const ws = await workspace('General');
    const card = await spaces.createTask(TEAM, 'ana', ws, { title: 'Private', private: true });
    for (const who of ['ben', 'owner']) {
      await expect(spaces.task(TEAM, who, ws, card.id)).rejects.toMatchObject({ status: 404 });
      await expect(spaces.updateTask(TEAM, who, ws, card.id, { status: 'done', expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
      await expect(spaces.deleteTask(TEAM, who, ws, card.id)).rejects.toMatchObject({ status: 404 });
      await expect(spaces.addComment(TEAM, who, ws, card.id, { body: 'hi' })).rejects.toMatchObject({ status: 404 });
    }
    const { task } = await spaces.updateTask(TEAM, 'ana', ws, card.id, { status: 'doing', expectedRevision: 1 });
    expect(task.status).toBe('doing');
  });
  it('can only be assigned to their owner', async () => {
    const ws = await workspace('General');
    await expect(spaces.createTask(TEAM, 'ana', ws, { title: 'x', private: true, assignee: { kind: 'person', id: 'ben' } })).rejects.toMatchObject({ status: 400 });
    await expect(spaces.createTask(TEAM, 'ana', ws, { title: 'x', private: true, assignee: { kind: 'agent', id: 'a1' } })).rejects.toMatchObject({ status: 400 });
    const card = await spaces.createTask(TEAM, 'ana', ws, { title: 'x', private: true, assignee: { kind: 'person', id: 'ana' } });
    await expect(spaces.updateTask(TEAM, 'ana', ws, card.id, { assignee: { kind: 'person', id: 'ben' }, expectedRevision: 1 })).rejects.toMatchObject({ status: 400 });
  });
});

// "Visible to": a card moves between teamspaces, or into its maker's My Space.
describe('moving a card', () => {
  it('moves to another teamspace with its thread, and is gone from the first board', async () => {
    const sales = await workspace('sales');
    const ops = await workspace('ops');
    const card = await spaces.createTask(TEAM, 'ana', sales, { title: 'Ship it' });
    await spaces.addComment(TEAM, 'ana', sales, card.id, { body: 'context' });
    const { task, moved } = await spaces.moveTask(TEAM, 'ana', sales, card.id, { to: ops, expectedRevision: 1 });
    expect(moved).toBe(true);
    expect(task).toMatchObject({ workspaceId: ops, revision: 2, private: false });
    expect(await spaces.tasks(TEAM, 'ana', sales)).toEqual([]);
    expect((await spaces.task(TEAM, 'ben', ops, card.id)).comments.map((c) => c.body)).toEqual(['context', 'Moved here.']);
  });

  it('keeps a person only when the route says they are in the destination; never an agent', async () => {
    const sales = await workspace('sales');
    const ops = await workspace('ops');
    const forBen = await spaces.createTask(TEAM, 'ana', sales, { title: 'a', assignee: { kind: 'person', id: 'ben' } });
    expect((await spaces.moveTask(TEAM, 'ana', sales, forBen.id, { to: ops, expectedRevision: 1 }, { personStays: true })).task.assignee).toEqual({ kind: 'person', id: 'ben' });
    const notThere = await spaces.createTask(TEAM, 'ana', sales, { title: 'b', assignee: { kind: 'person', id: 'ben' } });
    expect((await spaces.moveTask(TEAM, 'ana', sales, notThere.id, { to: ops, expectedRevision: 1 })).task.assignee).toBeNull();
    const forAgent = await spaces.createTask(TEAM, 'ana', sales, { title: 'c', assignee: { kind: 'agent', id: 'agent-1' } });
    const moved = await spaces.moveTask(TEAM, 'ana', sales, forAgent.id, { to: ops, expectedRevision: 1 }, { personStays: true });
    expect(moved.task.assignee).toBeNull();
    expect((await spaces.task(TEAM, 'ana', ops, forAgent.id)).comments.at(-1).body).toMatch(/Unassigned/);
  });

  it('the body cannot vouch for the assignee: personStays is only a server option', async () => {
    const sales = await workspace('sales');
    const ops = await workspace('ops');
    const card = await spaces.createTask(TEAM, 'ana', sales, { title: 'a', assignee: { kind: 'person', id: 'ben' } });
    const { task } = await spaces.moveTask(TEAM, 'ana', sales, card.id, { to: ops, expectedRevision: 1, personStays: true });
    expect(task.assignee).toBeNull();
  });

  it('only its maker makes a card private; then nobody else finds it', async () => {
    const ws = await workspace('General');
    const card = await spaces.createTask(TEAM, 'ana', ws, { title: 'Mine now', assignee: { kind: 'person', id: 'ben' } });
    await expect(spaces.moveTask(TEAM, 'admin', ws, card.id, { to: ws, private: true, expectedRevision: 1 })).rejects.toMatchObject({ status: 403 });
    const { task } = await spaces.moveTask(TEAM, 'ana', ws, card.id, { to: ws, private: true, expectedRevision: 1 }, { personStays: true });
    expect(task).toMatchObject({ private: true, assignee: null });
    await expect(spaces.task(TEAM, 'ben', ws, card.id)).rejects.toMatchObject({ status: 404 });
    const back = await spaces.moveTask(TEAM, 'ana', ws, card.id, { to: ws, private: false, expectedRevision: 2 });
    expect(back.task.private).toBe(false);
    expect((await spaces.tasks(TEAM, 'ben', ws)).map((t) => t.id)).toEqual([card.id]);
  });

  it('the maker or an admin moves it; a member who did not make it, a viewer, or a stale revision cannot', async () => {
    const sales = await workspace('sales');
    const ops = await workspace('ops');
    const card = await spaces.createTask(TEAM, 'ana', sales, { title: 'x' });
    await expect(spaces.moveTask(TEAM, 'ben', sales, card.id, { to: ops, expectedRevision: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(spaces.moveTask(TEAM, 'vic', sales, card.id, { to: ops, expectedRevision: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(spaces.moveTask(TEAM, 'ana', sales, card.id, { to: ops, expectedRevision: 9 })).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await spaces.moveTask(TEAM, 'admin', sales, card.id, { to: ops, expectedRevision: 1 })).task.workspaceId).toBe(ops);
  });

  it('never to another team\'s or an archived workspace, and not while an agent is running', async () => {
    const sales = await workspace('sales');
    const old = await workspace('old');
    await base.run("INSERT INTO teams VALUES('team-2','Other','x','now')");
    await base.run("INSERT INTO shared_workspaces(id,team_id,name,created_by) VALUES('foreign','team-2','F','x')");
    await base.run('UPDATE shared_workspaces SET archived_at=CURRENT_TIMESTAMP WHERE id=?', [old]);
    const card = await spaces.createTask(TEAM, 'ana', sales, { title: 'x' });
    await expect(spaces.moveTask(TEAM, 'ana', sales, card.id, { to: 'foreign', expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(spaces.moveTask(TEAM, 'ana', sales, card.id, { to: old, expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    await base.run("UPDATE space_tasks SET agent_state='running' WHERE id=?", [card.id]);
    const ops = await workspace('ops');
    await expect(spaces.moveTask(TEAM, 'ana', sales, card.id, { to: ops, expectedRevision: 1 })).rejects.toMatchObject({ status: 409, code: 'agent_running' });
  });

  it('inbox rows follow the card; the source message stops pointing at it', async () => {
    const sales = await workspace('sales');
    const ops = await workspace('ops');
    const message = await spaces.postMessage(TEAM, 'ana', sales, { body: 'do this' });
    const card = await spaces.createTask(TEAM, 'ana', sales, { title: 'x', sourceMessageId: message.id, assignee: { kind: 'person', id: 'ben' } });
    await spaces.moveTask(TEAM, 'ana', sales, card.id, { to: ops, expectedRevision: 1 }, { personStays: true });
    expect((await spaces.inbox(TEAM, 'ben')).map((i) => i.workspaceId)).toEqual([ops]);
    expect((await spaces.messages(TEAM, 'ana', sales))[0].taskId).toBeNull();
    expect((await spaces.task(TEAM, 'ana', ops, card.id)).sourceMessageId).toBeNull();
  });
});

describe('agent results wait for a person', () => {
  it('waiting → approval inbox → approve moves the card to done and resolves the inbox item', async () => {
    const ws = await workspace('sales');
    const task = await spaces.createTask(TEAM, 'ana', ws, { title: 'Draft proposal', assignee: { kind: 'agent', id: 'agent-1' } });
    await spaces.setAgentState(TEAM, ws, task.id, { state: 'waiting', status: 'review', result: 'The draft', agentId: 'agent-1', comment: 'The draft' });
    await spaces.requestApproval(TEAM, ws, task.id, 'agent-1');
    const [approval] = await spaces.inbox(TEAM, 'ana');
    expect(approval).toMatchObject({ kind: 'approval', state: 'pending', actor: { kind: 'agent', id: 'agent-1' } });
    const done = await spaces.decide(TEAM, 'ana', ws, task.id, { approve: true });
    expect(done).toMatchObject({ status: 'done', agentState: null, result: 'The draft' });
    expect((await spaces.inbox(TEAM, 'ana'))[0]).toMatchObject({ state: 'approved', read: true });
    await expect(spaces.decide(TEAM, 'ana', ws, task.id, { approve: true })).rejects.toMatchObject({ status: 409 });
  });

  it('a second run supersedes the earlier pending approval', async () => {
    const ws = await workspace('sales');
    const task = await spaces.createTask(TEAM, 'ana', ws, { title: 'X', assignee: { kind: 'agent', id: 'a' } });
    await spaces.requestApproval(TEAM, ws, task.id, 'a');
    await spaces.requestApproval(TEAM, ws, task.id, 'a');
    expect((await spaces.inbox(TEAM, 'ana')).map((i) => i.state).sort()).toEqual(['pending', 'superseded']);
  });
});

describe('teamspace docs', () => {
  it('create, read, save with revision guard', async () => {
    const ws = await workspace('sales');
    const doc = await spaces.createDoc(TEAM, 'ana', ws, { name: 'Playbook', content: 'v1' });
    expect(await spaces.doc(TEAM, 'ben', ws, doc.id)).toMatchObject({ name: 'Playbook', content: 'v1', revision: 1 });
    await spaces.saveDoc(TEAM, 'ben', ws, doc.id, { content: 'v2', expectedRevision: 1 });
    await expect(spaces.saveDoc(TEAM, 'ana', ws, doc.id, { content: 'lost?', expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await spaces.doc(TEAM, 'ana', ws, doc.id)).content).toBe('v2');
  });

  it('a teamspace doc is invisible to the team library and to other teamspaces', async () => {
    const sales = await workspace('sales');
    const ops = await workspace('ops');
    const doc = await spaces.createDoc(TEAM, 'ana', sales, { name: 'Comp plan', content: 'secret' });
    const library = asCloud(base, roles);
    await library.save(TEAM, 'ana', { name: 'Shared tool', kind: 'markdown', content: 'ok' });
    expect((await library.assets(TEAM, 'ana')).map((a) => a.name)).toEqual(['Shared tool']);
    await expect(library.asset(TEAM, 'ana', doc.id)).rejects.toMatchObject({ status: 404 });
    await expect(library.save(TEAM, 'ana', { id: doc.id, name: 'x', kind: 'markdown', content: 'overwrite', expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(spaces.doc(TEAM, 'ana', ops, doc.id)).rejects.toMatchObject({ status: 404 });
    expect(await spaces.docs(TEAM, 'ana', ops)).toEqual([]);
  });

  it('deleting unlinks the doc from its teamspace without destroying its history', async () => {
    const ws = await workspace('sales');
    const doc = await spaces.createDoc(TEAM, 'ana', ws, { name: 'Old', content: 'x' });
    await expect(spaces.deleteDoc(TEAM, 'ben', ws, doc.id)).rejects.toMatchObject({ status: 403 });
    await spaces.deleteDoc(TEAM, 'ana', ws, doc.id);
    expect(await spaces.docs(TEAM, 'ana', ws)).toEqual([]);
    expect((await base.get('SELECT COUNT(*) AS n FROM team_asset_versions WHERE asset_id=?', [doc.id])).n).toBe(1);
  });
});

describe('board flow: work limits, waiting cards, review history', () => {
  const agentCard = (ws, title) => spaces.createTask(TEAM, 'ana', ws, { title, assignee: { kind: 'agent', id: 'agent-1' } });
  const toReview = (ws, id) => spaces.setAgentState(TEAM, ws, id, { state: 'waiting', status: 'review', result: 'draft', agentId: 'agent-1' });

  it('names the full column that holds a start, In progress before Review', () => {
    expect(columnBlockingStart({ doing: 9, review: 9 }, { doing: null, review: null })).toBeNull();
    expect(columnBlockingStart({ doing: 2, review: 0 }, { doing: 2, review: 1 })).toBe('In progress');
    expect(columnBlockingStart({ doing: 1, review: 1 }, { doing: 2, review: 1 })).toBe('Review');
    expect(columnBlockingStart({ doing: 1, review: 0 }, { doing: 2, review: 1 })).toBeNull();
  });

  it('work limits: set and remove; other columns and out-of-range values are refused', async () => {
    const ws = await workspace('sales');
    expect(await spaces.limits(TEAM, 'vic', ws)).toEqual({ doing: null, review: null });
    expect(await spaces.setLimit(TEAM, 'ana', ws, { status: 'review', max: 2 })).toEqual({ doing: null, review: 2 });
    expect(await spaces.setLimit(TEAM, 'ben', ws, { status: 'review', max: 3 })).toEqual({ doing: null, review: 3 });
    await expect(spaces.setLimit(TEAM, 'vic', ws, { status: 'doing', max: 2 })).rejects.toMatchObject({ status: 403 });
    await expect(spaces.setLimit(TEAM, 'ana', ws, { status: 'todo', max: 2 })).rejects.toMatchObject({ status: 400 });
    for (const max of [0, 100, 2.5, '3']) await expect(spaces.setLimit(TEAM, 'ana', ws, { status: 'doing', max })).rejects.toMatchObject({ status: 400 });
    expect(await spaces.setLimit(TEAM, 'ana', ws, { status: 'review', max: null })).toEqual({ doing: null, review: null });
  });

  it('a full Review makes an agent card wait in To do with the reason, keeping its place; room lets it start', async () => {
    const ws = await workspace('sales');
    await spaces.setLimit(TEAM, 'ana', ws, { status: 'review', max: 1 });
    const first = await agentCard(ws, 'First');
    expect((await spaces.startAgentRun(TEAM, ws, first.id, { agentId: 'agent-1', input: 'Task: First' })).started).toBe(true);
    await toReview(ws, first.id);

    const second = await agentCard(ws, 'Second');
    const waiting = await spaces.startAgentRun(TEAM, ws, second.id, { agentId: 'agent-1', input: 'Task: Second\n\nContext' });
    expect(waiting.started).toBe(false);
    expect(waiting.task).toMatchObject({ status: 'todo', agentState: 'queued', stopReason: 'Review is full' });
    // Asking again keeps its place in the queue and says it only once.
    const again = await spaces.startAgentRun(TEAM, ws, second.id, { agentId: 'agent-1', input: 'Task: Second\n\nContext' });
    expect(again.task.agentStateAt).toBe(waiting.task.agentStateAt);
    const third = await agentCard(ws, 'Third');
    await spaces.startAgentRun(TEAM, ws, third.id, { agentId: 'agent-1', input: 'Task: Third' });
    expect((await spaces.waitingCards(TEAM, ws)).map((c) => [c.title, c.queuedInput])).toEqual([['Second', 'Task: Second\n\nContext'], ['Third', 'Task: Third']]);
    const comments = (await spaces.task(TEAM, 'ana', ws, second.id)).comments.map((c) => c.body);
    expect(comments.filter((body) => body === 'Waiting to start: Review is full.')).toHaveLength(1);

    await spaces.decide(TEAM, 'ana', ws, first.id, { approve: true });
    const started = await spaces.startAgentRun(TEAM, ws, second.id, { agentId: 'agent-1', input: 'Task: Second\n\nContext' });
    expect(started.started).toBe(true);
    expect(started.task).toMatchObject({ status: 'doing', agentState: 'running', stopReason: null });
    expect((await spaces.waitingCards(TEAM, ws)).map((c) => c.title)).toEqual(['Third']);
  });

  it('an In progress limit counts the cards already started, not the one starting', async () => {
    const ws = await workspace('sales');
    await spaces.setLimit(TEAM, 'ana', ws, { status: 'doing', max: 1 });
    const one = await agentCard(ws, 'One');
    expect((await spaces.startAgentRun(TEAM, ws, one.id, { agentId: 'agent-1', input: '' })).started).toBe(true);
    // Starting the same card again (a send-back) never counts the card against itself.
    expect((await spaces.startAgentRun(TEAM, ws, one.id, { agentId: 'agent-1', input: '' })).started).toBe(true);
    const two = await agentCard(ws, 'Two');
    expect((await spaces.startAgentRun(TEAM, ws, two.id, { agentId: 'agent-1', input: '' })).task.stopReason).toBe('In progress is full');
  });

  it('records review history: sent back counts up, approval stamps the time, moves stamp the column time', async () => {
    const ws = await workspace('sales');
    const card = await agentCard(ws, 'Proposal');
    expect(card).toMatchObject({ sendBackCount: 0, approvedAt: null, stopReason: null });
    expect(card.statusChangedAt).toBe(card.createdAt);
    await toReview(ws, card.id);
    const sentBack = await spaces.decide(TEAM, 'ana', ws, card.id, { approve: false, note: 'shorter' });
    expect(sentBack).toMatchObject({ status: 'doing', agentState: 'sent_back', sendBackCount: 1, approvedAt: null });
    await toReview(ws, card.id);
    const approved = await spaces.decide(TEAM, 'ana', ws, card.id, { approve: true });
    expect(approved).toMatchObject({ status: 'done', sendBackCount: 1 });
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.statusChangedAt).toBe(approved.approvedAt);
    // A title edit is not a move: the column time stays.
    const renamed = (await spaces.updateTask(TEAM, 'ana', ws, card.id, { title: 'Proposal v2', expectedRevision: approved.revision })).task;
    expect(renamed.statusChangedAt).toBe(approved.statusChangedAt);
  });

  it('a stopped card carries its reason until someone takes it over; moving a waiting card by hand clears the wait', async () => {
    const ws = await workspace('sales');
    const card = await agentCard(ws, 'Quote');
    const stopped = await spaces.setAgentState(TEAM, ws, card.id, { state: 'blocked', status: 'todo', agentId: 'agent-1', comment: 'full text', reason: 'prices disagree' });
    expect(stopped).toMatchObject({ agentState: 'blocked', stopReason: 'prices disagree' });
    const taken = (await spaces.updateTask(TEAM, 'ana', ws, card.id, { assignee: { kind: 'person', id: 'ana' }, expectedRevision: stopped.revision })).task;
    expect(taken).toMatchObject({ agentState: null, stopReason: null });

    await spaces.setLimit(TEAM, 'ana', ws, { status: 'doing', max: 1 });
    const busy = await agentCard(ws, 'Busy');
    await spaces.startAgentRun(TEAM, ws, busy.id, { agentId: 'agent-1', input: '' });
    const queued = (await spaces.startAgentRun(TEAM, ws, (await agentCard(ws, 'Later')).id, { agentId: 'agent-1', input: 'x' })).task;
    const moved = (await spaces.updateTask(TEAM, 'ana', ws, queued.id, { status: 'doing', expectedRevision: queued.revision })).task;
    expect(moved).toMatchObject({ status: 'doing', agentState: null, stopReason: null });
    expect(await spaces.waitingCards(TEAM, ws)).toEqual([]);
  });

  it('waits on: same board only, never itself or a loop; the held-up card counts and lists what waits on it', async () => {
    const ws = await workspace('sales');
    const other = await workspace('ops');
    const quote = await spaces.createTask(TEAM, 'ana', ws, { title: 'Quote' });
    const send = await spaces.createTask(TEAM, 'ana', ws, { title: 'Send quote' });
    const forecast = await spaces.createTask(TEAM, 'ana', ws, { title: 'Forecast' });
    const elsewhere = await spaces.createTask(TEAM, 'ana', other, { title: 'Elsewhere' });
    await spaces.updateTask(TEAM, 'ana', ws, send.id, { waitsOn: quote.id, expectedRevision: send.revision });
    await spaces.updateTask(TEAM, 'ana', ws, forecast.id, { waitsOn: send.id, expectedRevision: forecast.revision });
    await expect(spaces.updateTask(TEAM, 'ana', ws, quote.id, { waitsOn: quote.id, expectedRevision: quote.revision })).rejects.toMatchObject({ status: 400 });
    await expect(spaces.updateTask(TEAM, 'ana', ws, quote.id, { waitsOn: forecast.id, expectedRevision: quote.revision })).rejects.toMatchObject({ status: 400, message: 'That would make these cards wait on each other' });
    await expect(spaces.updateTask(TEAM, 'ana', ws, quote.id, { waitsOn: elsewhere.id, expectedRevision: quote.revision })).rejects.toMatchObject({ status: 404 });
    const board = await spaces.tasks(TEAM, 'ana', ws);
    expect(board.find((t) => t.id === quote.id).holdingUp).toBe(1);
    const detail = await spaces.task(TEAM, 'ana', ws, quote.id);
    expect(detail.heldUp.map((c) => c.title)).toEqual(['Send quote']);
    expect((await spaces.task(TEAM, 'ana', ws, send.id)).waitsOnTask).toMatchObject({ id: quote.id, title: 'Quote' });
    const cleared = (await spaces.updateTask(TEAM, 'ana', ws, send.id, { waitsOn: null, expectedRevision: (await spaces.task(TEAM, 'ana', ws, send.id)).revision })).task;
    expect(cleared.waitsOn).toBeNull();
  });

  it('the team lead: set, change and remove it; its rules stay', async () => {
    const ws = await workspace('sales');
    expect(await spaces.lead(TEAM, 'vic', ws)).toEqual({ leadAgentId: null, leadRules: '' });
    await expect(spaces.setLead(TEAM, 'ana', ws, { agentId: 'lead-1', rules: 'x' })).rejects.toMatchObject({ status: 403 });
    expect(await spaces.setLead(TEAM, 'admin', ws, { agentId: 'lead-1', rules: 'Settle price gaps under 15%.' })).toEqual({ leadAgentId: 'lead-1', leadRules: 'Settle price gaps under 15%.' });
    // Changing only the lead keeps the rules; removing the lead keeps them too.
    expect(await spaces.setLead(TEAM, 'owner', ws, { agentId: 'lead-2' })).toEqual({ leadAgentId: 'lead-2', leadRules: 'Settle price gaps under 15%.' });
    expect(await spaces.setLead(TEAM, 'owner', ws, { agentId: null })).toEqual({ leadAgentId: null, leadRules: 'Settle price gaps under 15%.' });
  });

  it('a stop: the lead takes it for the agent, its decision hands it back; a person\u2019s answer goes to the agent that first stopped', async () => {
    const ws = await workspace('sales');
    const card = await agentCard(ws, 'Quote');
    const stop = { reason: 'prices disagree', options: ['Use $34', 'Use $38'] };
    await spaces.setAgentState(TEAM, ws, card.id, { state: 'blocked', status: 'todo', agentId: 'agent-1', comment: 'Two prices.', reason: stop.reason, decision: stop });
    const handed = await spaces.handToLead(TEAM, ws, card.id, { leadAgentId: 'lead-1', fromAgentId: 'agent-1' });
    expect(handed).toMatchObject({ assignee: { kind: 'agent', id: 'lead-1' }, escalatedFrom: 'agent-1', decision: stop });
    const back = await spaces.returnFromLead(TEAM, ws, card.id, { decision: 'Use $34: the quote is signed.' });
    expect(back.stop).toEqual(stop);
    expect(back.task).toMatchObject({ assignee: { kind: 'agent', id: 'agent-1' }, escalatedFrom: null, agentState: null, decision: null });
    const thread = (await spaces.task(TEAM, 'ana', ws, card.id)).comments.map((c) => [c.author.kind, c.body]);
    expect(thread).toContainEqual(['system', 'Asked the team lead to decide first.']);
    expect(thread).toContainEqual(['agent', 'Decided: Use $34: the quote is signed.']);

    // The lead could not decide either: the person answers, and the card goes to the agent that first stopped.
    await spaces.setAgentState(TEAM, ws, card.id, { state: 'blocked', status: 'todo', agentId: 'agent-1', reason: stop.reason, decision: stop });
    await spaces.handToLead(TEAM, ws, card.id, { leadAgentId: 'lead-1', fromAgentId: 'agent-1' });
    await spaces.setAgentState(TEAM, ws, card.id, { state: 'blocked', status: 'todo', agentId: 'lead-1', reason: 'only a person can change a signed price', decision: { reason: 'only a person can change a signed price', options: ['Keep $34'] } });
    await expect(spaces.answerStop(TEAM, 'vic', ws, card.id, { answer: 'Keep $34' })).rejects.toMatchObject({ status: 403 });
    const answered = await spaces.answerStop(TEAM, 'ben', ws, card.id, { answer: 'Keep $34' });
    expect(answered.task).toMatchObject({ assignee: { kind: 'agent', id: 'agent-1' }, escalatedFrom: null, agentState: null });
    expect(answered.stop.reason).toBe('only a person can change a signed price');
    await expect(spaces.answerStop(TEAM, 'ben', ws, card.id, { answer: 'again' })).rejects.toMatchObject({ status: 409, code: 'not_stopped' });
  });

  it('run cost: priced runs add up on the card, unpriced ones are counted, and the revision stays', async () => {
    const ws = await workspace('sales');
    const card = await agentCard(ws, 'Quote');
    await spaces.addRunCost(TEAM, ws, card.id, 0.25);
    await spaces.addRunCost(TEAM, ws, card.id, 0.5);
    await spaces.addRunCost(TEAM, ws, card.id, null);
    await spaces.addRunCost(TEAM, ws, card.id, Number.NaN);
    const after = await spaces.task(TEAM, 'ana', ws, card.id);
    expect(after).toMatchObject({ runCost: 0.75, runCostUnknown: 2, revision: card.revision });
  });

  it('try again: only a stopped agent card, and it clears the stop', async () => {
    const ws = await workspace('sales');
    const card = await agentCard(ws, 'Draft');
    await expect(spaces.retryStop(TEAM, 'ana', ws, card.id)).rejects.toMatchObject({ status: 409 });
    await spaces.setAgentState(TEAM, ws, card.id, { state: 'blocked', status: 'todo', agentId: 'agent-1', reason: 'the run failed' });
    expect(await spaces.retryStop(TEAM, 'ana', ws, card.id)).toMatchObject({ agentState: null, stopReason: null });
  });

  it('upgrades an existing board in place: new columns added, column time backfilled from the last update', async () => {
    const oldDb = new sqlite3.Database(':memory:');
    const old = new TeamRepository(oldDb);
    await old.ready;
    await initializeTeamWorkspaces(old);
    await old.run("CREATE TABLE space_tasks(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,workspace_id TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,assignee_kind TEXT,assignee_id TEXT,due TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,source_message_id TEXT,agent_state TEXT,result_text TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT)");
    await old.run("INSERT INTO space_tasks(id,team_id,workspace_id,title,status,created_by,created_at,updated_at) VALUES('t1','team','ws','Old card','review','ana','2026-01-01T00:00:00.000Z','2026-02-01T00:00:00.000Z')");
    await initializeTeamSpaces(old);
    await initializeTeamSpaces(old); // idempotent
    const columns = (await old.all('PRAGMA table_info(space_tasks)')).map((c) => c.name);
    for (const name of ['private_to', 'status_changed_at', 'agent_state_at', 'stop_reason', 'queued_input', 'send_back_count', 'approved_at', 'decision_json', 'checks_json', 'escalated_from', 'waits_on', 'run_cost', 'run_cost_unknown']) expect(columns).toContain(name);
    expect(await old.get('SELECT status_changed_at,send_back_count FROM space_tasks WHERE id=?', ['t1'])).toEqual({ status_changed_at: '2026-02-01T00:00:00.000Z', send_back_count: 0 });
    await new Promise((resolve) => oldDb.close(() => resolve()));
  });
});

describe('inbox', () => {
  it('is private to its owner and marks read', async () => {
    const ws = await workspace('sales');
    await spaces.postMessage(TEAM, 'ana', ws, { body: '@ben', mentions: [{ kind: 'person', id: 'ben' }] });
    const [item] = await spaces.inbox(TEAM, 'ben');
    await expect(spaces.markRead(TEAM, 'ana', item.id)).rejects.toMatchObject({ status: 404 });
    await spaces.markRead(TEAM, 'ben', item.id);
    expect((await spaces.inbox(TEAM, 'ben'))[0].read).toBe(true);
  });
});
