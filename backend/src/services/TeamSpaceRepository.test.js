import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { TeamRepository } from './TeamRepository.js';
import { initializeTeamWorkspaces } from './TeamWorkspaceRepository.js';
import { TeamSpaceRepository, initializeTeamSpaces, parseMentions, MAX_MESSAGE } from './TeamSpaceRepository.js';

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
