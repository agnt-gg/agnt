import { TeamSpaceRepository, parseAssignee, parseMentions } from '../services/TeamSpaceRepository.js';
import { runAgentOnTask } from '../services/TeamSpaceAgents.js';
import { isAnnie, anniePrompt, answerInTeamChat, runAnnieTurn, liveReplies } from '../services/TeamSpaceAnnie.js';

/**
 * Teamspace collaboration routes, mounted inside TeamRoutes' router so every
 * path inherits its guards: cloud team access for the caller, and for
 * /workspaces/:id/... the cloud's per-workspace capability (resources.read on
 * GET, resources.write otherwise). Nothing here widens that.
 *
 * Added here: people named in a mention or assignment must be members of THIS
 * teamspace (an invite-only space is like a private channel), and agents must be
 * native agents of it. Live signals go to the teamspace's members only.
 *
 * deps:
 *   handler(fn)                          TeamRoutes' request wrapper (fn gets the request-bound repo)
 *   realtime                             createTeamSpaceRealtime(): members() + live signals
 *   workspaceAgents(repo, req)           [{id, name, status}] native agents in the teamspace
 *   agentExecutor(repo, req, user, id)   (input) => run result, through NativeTeamExecution
 *   schedule(fn)                         runs agent work after the response (setImmediate in production)
 *   askAnnie({userId, authToken, prompt, transport}) Annie's turn as the tagging person, streamed into
 *                                        `transport` (TeamSpaceAnnie.runAnnieTurn)
 *   spaceMembers(req)                    ids of the people in req.params.workspaceId (default: the whole team)
 *   canWriteIn(req, workspaceId)         throws unless the caller has resources.write in ANOTHER teamspace
 *                                        (a move's destination). Fails closed when not supplied.
 */
/** A card title from a chat message: the text with the @mentioned agents' names taken out. */
export function cardTitle(body, agentNames) {
  let title = String(body);
  for (const name of [...agentNames].filter(Boolean).sort((a, b) => b.length - a.length)) title = title.split('@' + name).join(' ');
  return title.replace(/^[\s,:;-]+/, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const refuseOtherSpaces = async () => { throw Object.assign(new Error('Moving between teamspaces is not available here'), { status: 403 }); };

export function mountTeamSpaceRoutes(router, { handler, realtime, workspaceAgents, agentExecutor, schedule = (fn) => setImmediate(fn), askAnnie = runAnnieTurn, spaceMembers = (req) => realtime.members(req.params.teamId, req.headers.authorization), canWriteIn = refuseOtherSpaces }) {
  const W = '/:teamId/workspaces/:workspaceId';
  const spacesOf = (repo) => new TeamSpaceRepository(repo);
  const signal = (req, kind, extra = {}) => realtime.space(req.params.teamId, req.headers.authorization, { workspaceId: req.params.workspaceId, kind, ...extra }, () => spaceMembers(req));
  /** The same request, addressed to another teamspace: for its member list and its live signal. */
  const inSpace = (req, workspaceId) => ({ params: { ...req.params, workspaceId }, headers: req.headers, cloudTeam: req.cloudTeam });

  async function checkPeople(req, ids) {
    if (!ids.length) return;
    const members = new Set(await spaceMembers(req));
    if (ids.some((id) => !members.has(id))) throw Object.assign(new Error('You can only mention or assign people in this teamspace'), { status: 400 });
  }
  async function checkAgents(repo, req, ids) {
    if (!ids.length) return new Map();
    const agents = new Map((await workspaceAgents(repo, req)).filter((a) => a.kind === 'agent').map((a) => [a.id, a]));
    if (ids.some((id) => !agents.has(id))) throw Object.assign(new Error('That agent is not in this teamspace'), { status: 400 });
    return agents;
  }
  async function checkTargets(repo, req, list) {
    await checkPeople(req, list.filter((m) => m.kind === 'person').map((m) => m.id));
    return checkAgents(repo, req, list.filter((m) => m.kind === 'agent').map((m) => m.id));
  }

  /** Hand a card to an agent after the response: the HTTP request never waits for a model. */
  function startAgent(repo, req, user, task, input) {
    const { teamId, workspaceId } = req.params;
    const execute = agentExecutor(repo, req, user, task.assignee.id);
    schedule(() => runAgentOnTask({
      spaces: spacesOf(repo), teamId, workspaceId, taskId: task.id, agentId: task.assignee.id, input, execute,
      changed: () => { signal(req, 'tasks', { taskId: task.id }); realtime.inbox(teamId, [task.createdBy]); },
    }));
  }
  const agentInput = (task, context) => [`Task: ${task.title}`, context ? `Context from the teamspace:\n${context}` : ''].filter(Boolean).join('\n\n');

  // ── Chat ────────────────────────────────────────────────────────────────
  router.get(W + '/messages', handler((repo, req, user) => spacesOf(repo).messages(req.params.teamId, user, req.params.workspaceId, { before: req.query.before })));
  // Replies being written right now (Annie streaming), for the people who may read this chat.
  // The realtime signal carries only ids; the content is fetched here, behind the same check.
  router.get(W + '/messages/live', handler(async (repo, req, user) => {
    await spacesOf(repo).canRead(req.params.teamId, user, req.params.workspaceId);
    return liveReplies(req.params.teamId, req.params.workspaceId);
  }));

  router.post(W + '/messages', handler(async (repo, req, user) => {
    const mentions = parseMentions(req.body?.mentions);
    // @Annie is the assistant, not a teamspace agent: checked apart, and she gets no card.
    const annie = mentions.some(isAnnie);
    const agents = await checkTargets(repo, req, mentions.filter((m) => !isAnnie(m)));
    const spaces = spacesOf(repo);
    const { teamId, workspaceId } = req.params;
    const message = await spaces.postMessage(teamId, user, workspaceId, { body: req.body?.body, mentions });
    if (annie) {
      // Context is read now, inside the request that proved the caller may read this chat.
      const history = await spaces.messages(teamId, user, workspaceId);
      const names = new Map((await workspaceAgents(repo, req)).map((a) => [a.id, a.name]));
      const prompt = anniePrompt({ spaceName: req.body?.spaceName, message, history: history.filter((m) => m.id !== message.id), names });
      const authToken = req.headers.authorization;
      schedule(() => answerInTeamChat({
        spaces, teamId, workspaceId, prompt,
        ask: (p, transport) => askAnnie({ userId: user, authToken, prompt: p, transport }),
        changed: (extra = {}) => signal(req, 'messages', extra),
      }));
    }
    // Each @agent gets a card made from the message and starts on it.
    for (const mention of mentions.filter((m) => m.kind === 'agent' && !isAnnie(m)).slice(0, 3)) {
      const title = cardTitle(message.body, [...agents.values()].map((a) => a.name)) || 'Request from chat';
      const task = await spaces.createTask(teamId, user, workspaceId, { title, assignee: mention, sourceMessageId: message.id });
      await spaces.postAgentMessage(teamId, workspaceId, mention.id, 'Got it. I made a card for this and I am starting now.', task.id);
      startAgent(repo, req, user, task, agentInput(task, message.body));
    }
    signal(req, 'messages');
    realtime.inbox(teamId, mentions.filter((m) => m.kind === 'person').map((m) => m.id));
    return message;
  }));

  router.delete(W + '/messages/:messageId', handler(async (repo, req, user) => {
    const result = await spacesOf(repo).deleteMessage(req.params.teamId, user, req.params.workspaceId, req.params.messageId);
    signal(req, 'messages');
    return result;
  }));

  // ── Board ───────────────────────────────────────────────────────────────
  // ?private=1: the caller's own My Space cards in this workspace; otherwise the shared board.
  router.get(W + '/tasks', handler((repo, req, user) => spacesOf(repo).tasks(req.params.teamId, user, req.params.workspaceId, { private: req.query.private === '1' })));
  router.get(W + '/tasks/:taskId', handler((repo, req, user) => spacesOf(repo).task(req.params.teamId, user, req.params.workspaceId, req.params.taskId)));

  router.post(W + '/tasks', handler(async (repo, req, user) => {
    const assignee = parseAssignee(req.body?.assignee);
    if (assignee) await checkTargets(repo, req, [assignee]);
    const task = await spacesOf(repo).createTask(req.params.teamId, user, req.params.workspaceId, req.body || {});
    if (task.assignee?.kind === 'agent') startAgent(repo, req, user, task, agentInput(task));
    // A private card is nobody else's business: no teamspace signal for it.
    if (task.private) return task;
    signal(req, 'tasks', { taskId: task.id });
    if (task.assignee?.kind === 'person') realtime.inbox(req.params.teamId, [task.assignee.id]);
    return task;
  }));

  router.patch(W + '/tasks/:taskId', handler(async (repo, req, user) => {
    const input = req.body || {};
    if (input.assignee !== undefined) {
      const assignee = parseAssignee(input.assignee);
      if (assignee) await checkTargets(repo, req, [assignee]);
    }
    const { task, assigneeChanged } = await spacesOf(repo).updateTask(req.params.teamId, user, req.params.workspaceId, req.params.taskId, input);
    if (assigneeChanged && task.assignee?.kind === 'agent' && task.status !== 'done') startAgent(repo, req, user, task, agentInput(task));
    signal(req, 'tasks', { taskId: task.id });
    if (assigneeChanged && task.assignee?.kind === 'person') realtime.inbox(req.params.teamId, [task.assignee.id]);
    return task;
  }));

  // "Visible to": move the card to another teamspace, or make it private (My Space).
  router.post(W + '/tasks/:taskId/move', handler(async (repo, req, user) => {
    const { teamId, workspaceId, taskId } = req.params;
    const to = typeof req.body?.to === 'string' ? req.body.to : '';
    if (!to) throw Object.assign(new Error('Pick where the card shows'), { status: 400 });
    // The guard above checked THIS teamspace only; the destination is checked with the cloud too.
    if (to !== workspaceId) await canWriteIn(req, to);
    const spaces = spacesOf(repo);
    const current = await spaces.task(teamId, user, workspaceId, taskId);
    const personStays = current.assignee?.kind === 'person' && (await spaceMembers(inSpace(req, to))).includes(current.assignee.id);
    const { task, moved, wasPrivate } = await spaces.moveTask(teamId, user, workspaceId, taskId, { to, private: req.body?.private === true, expectedRevision: req.body?.expectedRevision }, { personStays });
    if (moved) {
      if (!wasPrivate) signal(req, 'tasks', { taskId });
      if (!task.private) signal(inSpace(req, to), 'tasks', { taskId });
      if (!task.private && task.assignee?.kind === 'person' && task.assignee.id !== user) realtime.inbox(teamId, [task.assignee.id]);
    }
    return task;
  }));

  router.delete(W + '/tasks/:taskId', handler(async (repo, req, user) => {
    const result = await spacesOf(repo).deleteTask(req.params.teamId, user, req.params.workspaceId, req.params.taskId);
    signal(req, 'tasks', { taskId: req.params.taskId });
    return result;
  }));

  router.post(W + '/tasks/:taskId/comments', handler(async (repo, req, user) => {
    const mentions = parseMentions(req.body?.mentions);
    const agents = await checkTargets(repo, req, mentions);
    const spaces = spacesOf(repo);
    const { teamId, workspaceId, taskId } = req.params;
    const comment = await spaces.addComment(teamId, user, workspaceId, taskId, { body: req.body?.body, mentions });
    // @agent in a card's thread hands the card to that agent.
    const agentMention = mentions.find((m) => m.kind === 'agent' && agents.has(m.id));
    if (agentMention) {
      const current = await spaces.task(teamId, user, workspaceId, taskId);
      const { task } = await spaces.updateTask(teamId, user, workspaceId, taskId, { assignee: agentMention, expectedRevision: current.revision });
      startAgent(repo, req, user, task, agentInput(task, comment.body));
    }
    signal(req, 'tasks', { taskId });
    realtime.inbox(teamId, mentions.filter((m) => m.kind === 'person').map((m) => m.id));
    return comment;
  }));

  const decide = (approve) => handler(async (repo, req, user) => {
    const task = await spacesOf(repo).decide(req.params.teamId, user, req.params.workspaceId, req.params.taskId, { approve, note: req.body?.note });
    // Approved with "save as doc": the result becomes a teamspace doc, linked from the card's thread.
    let doc = null;
    if (approve && req.body?.saveAsDoc && task.result) {
      doc = await spacesOf(repo).createDoc(req.params.teamId, user, req.params.workspaceId, { name: task.title, content: task.result });
    }
    // Sent back: the agent takes the card again with the note.
    if (!approve && task.assignee?.kind === 'agent') startAgent(repo, req, user, task, agentInput(task, `Your previous result was sent back${req.body?.note ? ': ' + req.body.note : '.'}\n\nPrevious result:\n${task.result || ''}`));
    signal(req, 'tasks', { taskId: task.id });
    if (doc) signal(req, 'docs', { docId: doc.id });
    realtime.inbox(req.params.teamId, [user]);
    return { task, doc };
  });
  router.post(W + '/tasks/:taskId/approve', decide(true));
  router.post(W + '/tasks/:taskId/send-back', decide(false));

  // ── Docs ────────────────────────────────────────────────────────────────
  router.get(W + '/docs', handler((repo, req, user) => spacesOf(repo).docs(req.params.teamId, user, req.params.workspaceId)));
  router.get(W + '/docs/:docId', handler((repo, req, user) => spacesOf(repo).doc(req.params.teamId, user, req.params.workspaceId, req.params.docId)));
  router.post(W + '/docs', handler(async (repo, req, user) => {
    const doc = await spacesOf(repo).createDoc(req.params.teamId, user, req.params.workspaceId, { name: req.body?.name, content: req.body?.content ?? '' });
    signal(req, 'docs', { docId: doc.id });
    return doc;
  }));
  router.put(W + '/docs/:docId', handler(async (repo, req, user) => {
    const doc = await spacesOf(repo).saveDoc(req.params.teamId, user, req.params.workspaceId, req.params.docId, req.body || {});
    signal(req, 'docs', { docId: doc.id });
    return doc;
  }));
  router.delete(W + '/docs/:docId', handler(async (repo, req, user) => {
    const result = await spacesOf(repo).deleteDoc(req.params.teamId, user, req.params.workspaceId, req.params.docId);
    signal(req, 'docs', { docId: req.params.docId });
    return result;
  }));

  // ── Members of this teamspace, for avatars, @mentions and assignment ────
  router.get(W + '/people', handler(async (repo, req) => {
    const ids = new Set(await spaceMembers(req));
    const agents = (await workspaceAgents(repo, req)).filter((a) => a.kind === 'agent').map((a) => ({ id: a.id, name: a.name, status: a.status }));
    return { memberIds: [...ids], agents };
  }));

  // ── Inbox (per person, across the team) ─────────────────────────────────
  router.get('/:teamId/inbox', handler((repo, req, user) => spacesOf(repo).inbox(req.params.teamId, user)));
  router.post('/:teamId/inbox/read-all', handler((repo, req, user) => spacesOf(repo).markAllRead(req.params.teamId, user)));
  router.post('/:teamId/inbox/:itemId/read', handler((repo, req, user) => spacesOf(repo).markRead(req.params.teamId, user, req.params.itemId)));
}
