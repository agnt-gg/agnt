import { TeamSpaceRepository, parseAssignee, parseMentions } from '../services/TeamSpaceRepository.js';
import { runAgentOnTask, FINISH_INSTRUCTIONS } from '../services/TeamSpaceAgents.js';
import { isAnnie, anniePrompt, answerInTeamChat, runAnnieTurn, liveReplies } from '../services/TeamSpaceAnnie.js';
import { aiFileMode, setAiFileMode } from '../services/security/teamFolders.js';

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

  /**
   * Hand a card to an agent after the response: the HTTP request never waits for a model. When a
   * column with a work limit is full the card waits in To do instead, and starts when room opens
   * (pullWaiting). Returns the card as it now stands.
   */
  async function startAgent(repo, req, user, task, input) {
    const { teamId, workspaceId } = req.params;
    const spaces = spacesOf(repo);
    const agentId = task.assignee.id;
    const { started, task: current } = await spaces.startAgentRun(teamId, workspaceId, task.id, { agentId, input });
    if (!started) return current;
    const execute = agentExecutor(repo, req, user, agentId);
    schedule(() => runAgentOnTask({
      spaces, teamId, workspaceId, taskId: task.id, agentId, input, execute, started: true,
      // A card the team lead holds for another agent is a decision, not a result to approve.
      decides: Boolean(current.escalatedFrom),
      changed: () => { signal(req, 'tasks', { taskId: task.id }); realtime.inbox(teamId, [task.createdBy]); },
    }).then((outcome) => afterRun(repo, req, user, task.id, agentId, outcome))
      .then(() => pullWaiting(repo, req, user))
      .catch((error) => console.warn('[Teamspaces] could not continue after a run:', error.message)));
    return current;
  }

  /**
   * After a run: an agent that stopped for a decision goes to the team lead first; a lead that
   * decided hands the card back to the agent it decided for, which carries on. A lead that also
   * needs a person leaves the card stopped, and the person's answer goes to the agent that first stopped.
   */
  async function afterRun(repo, req, user, taskId, agentId, outcome) {
    const { teamId, workspaceId } = req.params;
    const spaces = spacesOf(repo);
    if (outcome?.decided) {
      const { task, stop } = await spaces.returnFromLead(teamId, workspaceId, taskId, { decision: outcome.text.slice(0, 2000) });
      signal(req, 'tasks', { taskId });
      await startAgent(repo, req, user, task, agentInput(task, `Your team lead decided on what you stopped on${stop?.reason ? ` (${stop.reason})` : ''}:\n${outcome.text}\n\nCarry on with the task.`));
      return;
    }
    if (!outcome?.stopped) return;
    const card = await spaces.latestCard(teamId, workspaceId, taskId);
    if (card.escalatedFrom) return;
    const { leadAgentId, leadRules } = await spaces.readSettings(workspaceId);
    if (!leadAgentId || leadAgentId === agentId) return;
    const agents = new Map((await workspaceAgents(repo, req)).filter((a) => a.kind === 'agent').map((a) => [a.id, a]));
    if (!agents.has(leadAgentId)) return;
    const handed = await spaces.handToLead(teamId, workspaceId, taskId, { leadAgentId, fromAgentId: agentId });
    signal(req, 'tasks', { taskId });
    await startAgent(repo, req, user, handed, leadInput(handed, outcome, agents.get(agentId)?.name, leadRules));
  }

  /** Room may have opened: start waiting cards oldest first while the limits allow. */
  async function pullWaiting(repo, req, user) {
    const { teamId, workspaceId } = req.params;
    for (const card of await spacesOf(repo).waitingCards(teamId, workspaceId)) {
      const current = await startAgent(repo, req, user, card, card.queuedInput);
      if (current.agentState === 'queued') break;
    }
  }
  const pullWaitingLater = (repo, req, user) => schedule(() => pullWaiting(repo, req, user).catch((error) => console.warn('[Teamspaces] could not start waiting cards:', error.message)));
  const agentInput = (task, context) => [`Task: ${task.title}`, context ? `Context from the teamspace:\n${context}` : '', FINISH_INSTRUCTIONS].filter(Boolean).join('\n\n');
  /** What a team lead is given when an agent stops: the question, the agent's options, and the lead's standing rules. */
  const leadInput = (task, outcome, agentName, rules) => [
    `You lead this team. ${agentName || 'An agent'} stopped on a card and needs a decision before it can carry on.`,
    `Card: ${task.title}`,
    `Why it stopped: ${outcome.decision.reason}`,
    outcome.decision.options.length ? `Its options:\n${outcome.decision.options.map((option) => '- ' + option).join('\n')}` : '',
    outcome.text ? `What it said:\n${outcome.text}` : '',
    rules ? `Your standing rules:\n${rules}` : '',
    'If your rules or the facts let you decide, reply with the decision and one line of reasoning; the agent carries on with it.',
    'If only a person can decide, end with "DECISION NEEDED: <one line saying why>" and up to three lines "OPTION: <a choice they can pick>".',
  ].filter(Boolean).join('\n\n');

  // ── Chat ────────────────────────────────────────────────────────────────
  // "Team files with AI": may Annie and agents use teamspace Files (off / read / write). Everyone on the
  // team may read it; only the team owner changes it.
  router.get('/:teamId/ai-files', handler(async (repo, req, user) => {
    const me = await repo.member(req.params.teamId, user);
    return { mode: await aiFileMode(repo, req.params.teamId), canChange: me.role === 'owner' };
  }));
  router.put('/:teamId/ai-files', handler(async (repo, req, user) => {
    await repo.member(req.params.teamId, user, ['owner']);
    return { mode: await setAiFileMode(repo, req.params.teamId, user, req.body?.mode), canChange: true };
  }));
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
      await startAgent(repo, req, user, task, agentInput(task, message.body));
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
    let task = await spacesOf(repo).createTask(req.params.teamId, user, req.params.workspaceId, req.body || {});
    if (task.assignee?.kind === 'agent') task = await startAgent(repo, req, user, task, agentInput(task));
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
    const updated = await spacesOf(repo).updateTask(req.params.teamId, user, req.params.workspaceId, req.params.taskId, input);
    let { task } = updated;
    const { assigneeChanged } = updated;
    if (assigneeChanged && task.assignee?.kind === 'agent' && task.status !== 'done') task = await startAgent(repo, req, user, task, agentInput(task));
    // A card leaving a column, or changing hands, can make room for a waiting one.
    pullWaitingLater(repo, req, user);
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
      pullWaitingLater(repo, req, user);
      if (!wasPrivate) signal(req, 'tasks', { taskId });
      if (!task.private) signal(inSpace(req, to), 'tasks', { taskId });
      if (!task.private && task.assignee?.kind === 'person' && task.assignee.id !== user) realtime.inbox(teamId, [task.assignee.id]);
    }
    return task;
  }));

  router.delete(W + '/tasks/:taskId', handler(async (repo, req, user) => {
    const result = await spacesOf(repo).deleteTask(req.params.teamId, user, req.params.workspaceId, req.params.taskId);
    pullWaitingLater(repo, req, user);
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
      await startAgent(repo, req, user, task, agentInput(task, comment.body));
    }
    signal(req, 'tasks', { taskId });
    realtime.inbox(teamId, mentions.filter((m) => m.kind === 'person').map((m) => m.id));
    return comment;
  }));

  const decide = (approve) => handler(async (repo, req, user) => {
    let task = await spacesOf(repo).decide(req.params.teamId, user, req.params.workspaceId, req.params.taskId, { approve, note: req.body?.note });
    // Approved with "save as doc": the result becomes a teamspace doc, linked from the card's thread.
    let doc = null;
    if (approve && req.body?.saveAsDoc && task.result) {
      doc = await spacesOf(repo).createDoc(req.params.teamId, user, req.params.workspaceId, { name: task.title, content: task.result });
    }
    // Sent back: the agent takes the card again with the note.
    if (!approve && task.assignee?.kind === 'agent') task = await startAgent(repo, req, user, task, agentInput(task, `Your previous result was sent back${req.body?.note ? ': ' + req.body.note : '.'}\n\nPrevious result:\n${task.result || ''}`));
    // A decided card leaves Review: a card waiting for room may start now.
    pullWaitingLater(repo, req, user);
    signal(req, 'tasks', { taskId: task.id });
    if (doc) signal(req, 'docs', { docId: doc.id });
    realtime.inbox(req.params.teamId, [user]);
    return { task, doc };
  });
  router.post(W + '/tasks/:taskId/approve', decide(true));
  router.post(W + '/tasks/:taskId/send-back', decide(false));

  // A person answers a stopped card: a choice it offered, or their own words. With addRule, the
  // answer is also added to the team lead's rules, so the lead settles it next time.
  router.post(W + '/tasks/:taskId/answer', handler(async (repo, req, user) => {
    const { teamId, workspaceId, taskId } = req.params;
    const spaces = spacesOf(repo);
    let rules = null;
    if (req.body?.addRule === true) {
      await repo.member(teamId, user, ['owner', 'admin']);
      const settings = await spaces.readSettings(workspaceId);
      if (!settings.leadAgentId) throw Object.assign(new Error('This teamspace has no team lead to give the rule to'), { status: 400 });
      const current = await spaces.task(teamId, user, workspaceId, taskId);
      const answer = String(req.body?.answer ?? '').trim();
      rules = [settings.leadRules, `- When ${current.stopReason || 'this happens'}: ${answer}`].filter(Boolean).join('\n');
      if (rules.length > 1000) throw Object.assign(new Error('The team lead\u2019s rules are full. Shorten them on the Agents page first.'), { status: 400 });
    }
    const { task, stop, answer } = await spaces.answerStop(teamId, user, workspaceId, taskId, { answer: req.body?.answer });
    if (rules !== null) {
      const settings = await spaces.readSettings(workspaceId);
      await spaces.setLead(teamId, user, workspaceId, { agentId: settings.leadAgentId, rules });
    }
    const current = await startAgent(repo, req, user, task, agentInput(task, `A person decided on what you stopped on${stop?.reason ? ` (${stop.reason})` : ''}: ${answer}\n\nCarry on with the task.`));
    signal(req, 'tasks', { taskId });
    return current;
  }));

  // Try a stopped card again with its agent.
  router.post(W + '/tasks/:taskId/retry', handler(async (repo, req, user) => {
    const task = await spacesOf(repo).retryStop(req.params.teamId, user, req.params.workspaceId, req.params.taskId);
    const current = await startAgent(repo, req, user, task, agentInput(task, 'Trying again after the run stopped.'));
    signal(req, 'tasks', { taskId: task.id });
    return current;
  }));

  // The team lead: an agent of this teamspace that answers stops first, and its standing rules.
  router.get(W + '/lead', handler((repo, req, user) => spacesOf(repo).lead(req.params.teamId, user, req.params.workspaceId)));
  router.put(W + '/lead', handler(async (repo, req, user) => {
    const agentId = req.body?.agentId ?? null;
    if (agentId !== null) await checkAgents(repo, req, [String(agentId)]);
    const settings = await spacesOf(repo).setLead(req.params.teamId, user, req.params.workspaceId, { agentId, rules: req.body?.rules });
    signal(req, 'tasks');
    return settings;
  }));

  // Work limits on In progress and Review: { doing, review }, null where none is set.
  router.get(W + '/limits', handler((repo, req, user) => spacesOf(repo).limits(req.params.teamId, user, req.params.workspaceId)));
  router.put(W + '/limits', handler(async (repo, req, user) => {
    const limits = await spacesOf(repo).setLimit(req.params.teamId, user, req.params.workspaceId, { status: req.body?.status, max: req.body?.max ?? null });
    // A raised or removed limit can make room at once.
    pullWaitingLater(repo, req, user);
    signal(req, 'tasks');
    return limits;
  }));

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
