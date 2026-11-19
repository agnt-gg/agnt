/**
 * Teamspaces — the pure model behind the team pages. Facts in, plain data out.
 *
 * Where you are is the URL (/team?view=…&space=…&tab=…&task=…&doc=…), so
 * Back works, a link in a chat opens the same card, and a reload lands where
 * you were. Nothing here touches the network or the DOM.
 */

export const TASK_STATUSES = Object.freeze([
  { id: 'todo', label: 'To do', color: '#87898e' },
  { id: 'doing', label: 'In progress', color: '#2d64bd' },
  { id: 'review', label: 'Review', color: '#e53d8f' },
  { id: 'done', label: 'Done', color: '#157839' },
]);
export const statusLabel = (id) => TASK_STATUSES.find((s) => s.id === id)?.label || id;
export const statusColor = (id) => TASK_STATUSES.find((s) => s.id === id)?.color || '#87898e';

/**
 * A teamspace's tabs. The board is called Tasks; docs live in Files, beside
 * uploads, so their tab is hidden (old ?tab=docs links still open it).
 * People is reached from the header's "Add people".
 */
export const SPACE_TABS = Object.freeze([
  { id: 'chat', label: 'Chat', icon: 'chats' },
  { id: 'board', label: 'Tasks', icon: 'board' },
  { id: 'docs', label: 'Docs', icon: 'doc', hidden: true },
  { id: 'agents', label: 'Agents', icon: 'bot' },
  { id: 'routines', label: 'Routines', icon: 'bolt' },
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'people', label: 'People', icon: 'users', hidden: true },
]);
export const VIEWS = Object.freeze(['home', 'inbox', 'space', 'mine', 'doc', 'agents', 'agent', 'library', 'members']);
/**
 * Library tabs: every kind of asset you own, your files, and the Market to add more.
 * Connections and plugins live on Apps. `asset` is the Focused Library tab whose store list it shows;
 * Files is the workspace on disk, browsed a folder at a time (`dir`).
 */
export const LIBRARY_TABS = Object.freeze([
  { id: 'agents', label: 'Agents', icon: 'bot', asset: 'agents' },
  { id: 'workflows', label: 'Workflows', icon: 'bolt', asset: 'workflows' },
  { id: 'tools', label: 'Tools', icon: 'pen', asset: 'tools' },
  { id: 'skills', label: 'Skills', icon: 'library', asset: 'skills' },
  { id: 'widgets', label: 'Widgets', icon: 'board', asset: 'widgets' },
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'market', label: 'Market', icon: 'share' },
]);
/** My Space sections (the drawer). */
export const MINE_TABS = Object.freeze(['tasks']);

const str = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : '');
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const id = (v) => (ID.test(str(v)) ? str(v) : null);
/** A workspace folder as its path from the top ('a/b'); '' (the top) when absent or malformed. */
const folder = (v) => {
  const raw = str(v);
  if (!raw || raw.length > 1000) return '';
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  return parts.every((p) => p !== '.' && p !== '..' && !/[\u0000-\u001f]/.test(p)) ? parts.join('/') : '';
};

/** The team page a /team query describes. Unknown or malformed values fall back, never throw. */
export function teamLocation(query = {}) {
  const view = VIEWS.includes(str(query.view)) ? str(query.view) : 'home';
  const tabs = view === 'library' ? LIBRARY_TABS : SPACE_TABS;
  const tab = tabs.some((t) => t.id === str(query.tab)) ? str(query.tab) : tabs[0].id;
  const dir = view === 'library' && tab === 'files' ? folder(query.dir) : '';
  return { view, space: id(query.space), tab, task: id(query.task), doc: id(query.doc), item: id(query.item), dir };
}

/** The /team query for a location: the inverse of teamLocation (tested both ways). */
export function teamQuery(loc = {}) {
  const query = { view: VIEWS.includes(loc.view) ? loc.view : 'home' };
  if (loc.space) query.space = loc.space;
  if (loc.view === 'space' && loc.tab && loc.tab !== 'chat') query.tab = loc.tab;
  if (loc.view === 'library' && loc.tab && loc.tab !== 'agents') query.tab = loc.tab;
  if (loc.view === 'library' && loc.tab === 'files' && loc.dir) query.dir = loc.dir;
  if (loc.task) query.task = loc.task;
  if (loc.doc) query.doc = loc.doc;
  if (loc.item) query.item = loc.item;
  return query;
}

/** Annie, taggable in every teamspace chat: she answers as the person who tagged her (TeamSpaceAnnie.js). */
export const ANNIE = Object.freeze({ id: 'annie', name: 'Annie' });

/**
 * The @ being typed at the caret, or null: `{ query, start }` where start is
 * the index of the @. Only at a word start, and only up to 30 characters.
 */
export function mentionAt(text, caret) {
  const before = String(text || '').slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(before);
  return m ? { query: m[2], start: before.length - m[2].length - 1 } : null;
}

/** Who the @ picker offers for a query: Annie, then teammates, then the teamspace's agents. */
export function mentionOptions(query, { people = [], agents = [], me = null } = {}) {
  const q = String(query || '').toLowerCase();
  const all = [
    { kind: 'agent', id: ANNIE.id, name: ANNIE.name, hint: 'Assistant' },
    ...people.filter((p) => p.id !== me).map((p) => ({ kind: 'person', id: p.id, name: p.name, hint: 'Teammate' })),
    ...agents.map((a) => ({ kind: 'agent', id: a.id, name: a.name, hint: 'Agent' })),
  ];
  return all.filter((o) => !q || o.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || o.name.toLowerCase().startsWith(q)).slice(0, 8);
}

/** "1 member", "3 members". */
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * A teamspace's emoji: the one it was given, else one that fits its name, so
 * every teamspace reads like the mockup's (💼 Sales, ⚙️ Ops, 📣 Marketing).
 */
const SPACE_EMOJI = [[/sales|deal|client|pipeline/i, '💼'], [/ops|operation|billing|finance|admin/i, '⚙️'], [/market|content|social|brand/i, '📣'],
  [/eng|dev|product|build/i, '🛠️'], [/design|creative/i, '🎨'], [/support|help|service/i, '🤝'], [/general|team|company|all/i, '💬']];
export function spaceEmoji(space) {
  if (space?.emoji) return space.emoji;
  const name = String(space?.name || '');
  return SPACE_EMOJI.find(([pattern]) => pattern.test(name))?.[1] || '📁';
}

/** The teamspace a person's private (My Space) cards live in: the team's default one, else the first. */
export const homeSpaceOf = (spaces = []) => spaces.find((s) => s.is_default) || spaces[0] || null;

/** The "Visible to" value for "only you". Never a teamspace id (those are UUIDs). */
export const PRIVATE_SCOPE = 'private';

/**
 * "Visible to" choices, the same everywhere an item can live in a teamspace:
 * optionally "Only you" first, then every teamspace the caller can see (the
 * server re-checks write access to the one picked).
 */
export function visibleToOptions(spaces = [], { includePrivate = false, privateLabel = 'Only you' } = {}) {
  return [
    ...(includePrivate ? [{ value: PRIVATE_SCOPE, label: privateLabel }] : []),
    ...spaces.map((s) => ({ value: s.id, label: `${spaceEmoji(s)} ${s.name}` })),
  ];
}

/** A person's avatar colour, stable for their id, from the mockup's palette. */
const HUES = ['#e53d8f', '#2d64bd', '#157839', '#915d06', '#7d3de5', '#5c5c72'];
export function avatarHue(id) {
  let hash = 0;
  for (const ch of String(id || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

/** "Jess Park" → "JP"; "sam@globex.com" → "SA". */
export function initials(label) {
  const text = String(label || '').trim();
  if (!text) return '?';
  const base = text.includes('@') && !text.includes(' ') ? text.split('@')[0] : text;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : base.slice(0, 2)).toUpperCase();
}

/** Members from the cloud ({user_id, name, email, role}) → display people. */
export function toPeople(members = [], me = null) {
  return (Array.isArray(members) ? members : [])
    .filter((m) => m && (m.user_id || m.userId))
    .map((m) => {
      const userId = m.user_id || m.userId;
      const name = (m.name || '').trim() || (m.email || '').split('@')[0] || 'Teammate';
      return { id: userId, name, first: name.split(/\s+/)[0], email: m.email || '', role: m.role || 'member', isMe: userId === me };
    });
}

/** Who someone is, for a byline. "You" for yourself. */
export function nameOf(ref, { people = [], agents = [], me = null } = {}) {
  if (!ref) return 'Unassigned';
  if (ref.kind === 'agent' && ref.id === ANNIE.id) return ANNIE.name;
  if (ref.kind === 'agent') return agents.find((a) => a.id === ref.id)?.name || 'Agent';
  if (ref.kind === 'system') return 'AGNT';
  if (ref.id === me) return 'You';
  return people.find((p) => p.id === ref.id)?.first || 'Teammate';
}

/**
 * Mentions in typed text, matched against real names only (longest first, so
 * "@Proposal Agent" is not read as "@Proposal"). The server re-validates every
 * one against the team and the teamspace.
 */
export function mentionsIn(text, { people = [], agents = [] } = {}) {
  const lower = String(text || '').toLowerCase();
  const candidates = [
    ...agents.map((a) => ({ kind: 'agent', id: a.id, name: a.name })),
    ...people.map((p) => ({ kind: 'person', id: p.id, name: p.name })),
    ...people.map((p) => ({ kind: 'person', id: p.id, name: p.first })),
  ].filter((c) => c.name).sort((a, b) => b.name.length - a.name.length);
  const found = [];
  let rest = lower;
  for (const c of candidates) {
    const token = '@' + c.name.toLowerCase();
    if (!rest.includes(token)) continue;
    rest = rest.split(token).join(' ');
    if (!found.some((f) => f.kind === c.kind && f.id === c.id)) found.push({ kind: c.kind, id: c.id });
  }
  return found;
}

/** Text split into plain and @mention runs, for safe rendering (no v-html). */
export function mentionRuns(text, names = []) {
  const source = String(text || '');
  const list = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return [{ text: source, mention: false }];
  const escaped = list.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const alternatives = '@(?:' + escaped.join('|') + ')';
  const splitter = new RegExp('(' + alternatives + ')', 'gi');
  const whole = new RegExp('^' + alternatives + '$', 'i'); // not global: no lastIndex state between parts
  return source.split(splitter).filter((part) => part !== '').map((part) => ({ text: part, mention: whole.test(part) }));
}

/** "just now", "5m", "3h", "2d". */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, now - t);
  if (s < 60e3) return 'just now';
  if (s < 3600e3) return Math.floor(s / 60e3) + 'm';
  if (s < 86400e3) return Math.floor(s / 3600e3) + 'h';
  return Math.floor(s / 86400e3) + 'd';
}

export function partOfDay(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

/** Board filter: everything, mine, or the agents'. */
export function filterTasks(tasks = [], filter = 'all', me = null) {
  if (filter === 'mine') return tasks.filter((t) => t.assignee?.kind === 'person' && t.assignee.id === me);
  if (filter === 'agents') return tasks.filter((t) => t.assignee?.kind === 'agent');
  return tasks;
}

export const unreadCount = (items = []) => items.filter((i) => !i.read).length;
export const pendingApprovals = (items = []) => items.filter((i) => i.kind === 'approval' && i.state === 'pending');

/** What an inbox row says after the actor's name. */
export function inboxSentence(item) {
  switch (item.kind) {
    case 'mention': return `mentioned you: “${item.summary}”`;
    case 'assigned': return `assigned you “${item.summary}”`;
    case 'approval': return item.state === 'pending' ? `finished “${item.summary}” and needs your approval` : `finished “${item.summary}” (${item.state === 'approved' ? 'approved' : item.state === 'sent_back' ? 'sent back' : 'replaced by a newer run'})`;
    case 'run': return `ran “${item.summary}”`;
    case 'shared': return `shared “${item.summary}”`;
    default: return item.summary;
  }
}

// ── Routine runs (schedules → goal runs) ──

/** How a routine run reads, from its recorded status (ScheduleRoutes run history). */
export function runTone(status) {
  switch (status) {
    case 'running': return { label: 'Running', color: '#2d64bd', state: 'running' };
    case 'needs_review': return { label: 'Waiting for your OK', color: '#e53d8f', state: 'need' };
    case 'completed': return { label: 'Done', color: '#157839', state: 'done' };
    case 'stopped': return { label: 'Stopped', color: '#87898e', state: 'done' };
    case 'interrupted': return { label: 'Interrupted', color: '#915d06', state: 'problem' };
    case 'failed': case 'stuck': case 'max_iterations': return { label: 'Needs a look', color: '#915d06', state: 'problem' };
    default: return { label: status || 'Unknown', color: '#87898e', state: 'done' };
  }
}

/**
 * A routine's number, from its real run history: runs in the last 30 days,
 * the share that finished, and runs per week for the last 8 weeks (oldest
 * first) for the sparkline.
 */
export function runStats(runs = [], now = Date.now()) {
  const WEEK = 7 * 86400e3;
  const times = runs.map((r) => ({ t: Date.parse(r.fired_at), status: r.status })).filter((r) => Number.isFinite(r.t));
  const recent = times.filter((r) => now - r.t <= 30 * 86400e3);
  const ended = recent.filter((r) => r.status !== 'running');
  const finished = ended.filter((r) => r.status === 'completed').length;
  const weekly = Array.from({ length: 8 }, (_, i) => times.filter((r) => now - r.t >= (7 - i) * WEEK && now - r.t < (8 - i) * WEEK).length);
  return { last30: recent.length, finishedShare: ended.length ? Math.round((finished / ended.length) * 100) : null, weekly };
}

/**
 * Routines whose latest run went wrong: one per routine, its newest run.
 * A failure a later run already fixed is not shown.
 */
export function routinesNeedingALook(runs = []) {
  const newest = new Map();
  for (const run of runs) {
    const key = run.routineId ?? run.routineName;
    const seen = newest.get(key);
    if (!seen || Date.parse(run.fired_at) > Date.parse(seen.fired_at)) newest.set(key, run);
  }
  return [...newest.values()].filter((run) => runTone(run.status).state === 'problem');
}

/**
 * Open cards an agent has stopped on that are yours to unblock: it finished and
 * needs approval, or it could not run. Yours means you made the card or it is
 * assigned to you. Sent back is the agent's turn, so it is not listed.
 */
export function tasksNeedingMe(tasks = [], me) {
  if (!me) return [];
  return tasks.filter((task) => task.status !== 'done'
    && ['waiting', 'blocked'].includes(task.agentState)
    && (task.createdBy === me || (task.assignee?.kind === 'person' && task.assignee.id === me)));
}

/** The run Run-now must not race: the newest one, while it is still running or waiting for the person. */
export function blockingRun(runs = []) {
  const newest = [...runs].sort((a, b) => Date.parse(b.fired_at) - Date.parse(a.fired_at))[0];
  return newest && ['running', 'needs_review'].includes(newest.status) ? newest : null;
}

/** SVG path data for a small sparkline. */
export function sparkPath(points = [], width = 110, height = 34) {
  if (points.length < 2) return '';
  const lo = Math.min(...points), hi = Math.max(...points);
  return points.map((v, i) => `${i ? 'L' : 'M'}${((i * width) / (points.length - 1)).toFixed(1)} ${(height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 8)).toFixed(1)}`).join(' ');
}

/** Card label for an agent's state. */
export function agentStateLabel(state) {
  return { running: 'Working…', waiting: 'Needs approval', blocked: 'Blocked', sent_back: 'Sent back', queued: 'Waiting' }[state] || '';
}

// ── Flow on the board ──

const DAY_MS = 86400e3;

/**
 * The line a card shows for its agent, in words: why it stopped, why it waits, or that it needs
 * an approval. `tone` is the tag colour (mk.css: pink, amber, blue). Working cards show a pulse
 * instead, and cards with no agent state show nothing.
 */
export function cardStateLine(task = {}) {
  switch (task.agentState) {
    case 'blocked': return { label: `Stopped: ${task.stopReason || 'needs a look'}`, tone: 'amber' };
    case 'queued': return { label: `Waiting: ${task.stopReason || 'no room yet'}`, tone: 'blue' };
    case 'waiting': return { label: 'Needs approval', tone: 'pink' };
    case 'sent_back': return { label: 'Sent back', tone: 'amber' };
    default: return null;
  }
}

/** How long a card has sat in its column ("2d"), and whether a day has passed, which shows in amber. */
export function timeInColumn(task = {}, now = Date.now()) {
  const since = task.statusChangedAt || task.updatedAt;
  const label = ago(since, now);
  if (!label) return null;
  return { label, warn: now - Date.parse(since) >= DAY_MS };
}

/** "Accepted first time" or "Sent back 2×" once a card's result is approved; nothing for cards nobody reviewed. */
export function reviewOutcome(task = {}) {
  if (!task.approvedAt) return null;
  const times = task.sendBackCount || 0;
  return times ? { label: `Sent back ${times}×`, tone: 'amber' } : { label: 'Accepted first time', tone: 'green' };
}

/** The card agents take next when room opens: the one that has waited longest. */
export function nextUpTaskId(tasks = []) {
  const waiting = tasks.filter((t) => t.agentState === 'queued');
  waiting.sort((a, b) => Date.parse(a.agentStateAt || a.updatedAt) - Date.parse(b.agentStateAt || b.updatedAt));
  return waiting[0]?.id || null;
}

/**
 * A column measured against its work limit. Full means agents wait (the server holds new starts
 * at the limit); over means it holds more than the limit, after a lowered limit or a card dragged
 * in by hand. `toFree` is how many cards must leave before agents start again.
 */
export function columnLoad(count, max) {
  if (!max) return { count, max: null, full: false, over: false, toFree: 0, label: String(count) };
  return { count, max, full: count >= max, over: count > max, toFree: Math.max(0, count - max + 1), label: `${count} of ${max}` };
}

/**
 * One teamspace's flow from its board: what its agents are doing, what has stopped, whether a
 * column is at its work limit, and how often results were accepted first time (last 7 days).
 */
export function spaceFlow(tasks = [], limits = {}, now = Date.now()) {
  const count = (test) => tasks.filter(test).length;
  const fullColumns = ['doing', 'review'].filter((status) => columnLoad(count((t) => t.status === status), limits?.[status]).full);
  const since = now - 7 * DAY_MS;
  const reviewed = tasks.filter((t) => t.approvedAt && Date.parse(t.approvedAt) >= since);
  const firstTime = reviewed.filter((t) => !t.sendBackCount).length;
  // Cost per accepted card, over the cards whose every run could be priced (rework included).
  const priced = reviewed.filter((t) => !t.runCostUnknown);
  return {
    open: count((t) => t.status !== 'done'),
    doing: count((t) => t.status === 'doing'),
    review: count((t) => t.status === 'review'),
    costPerAccepted: priced.length ? priced.reduce((sum, t) => sum + (t.runCost || 0), 0) / priced.length : null,
    pricedCount: priced.length,
    working: count((t) => t.agentState === 'running'),
    stopped: count((t) => t.agentState === 'blocked'),
    toReview: count((t) => t.agentState === 'waiting'),
    waitingForRoom: count((t) => t.agentState === 'queued'),
    fullColumns,
    atLimit: fullColumns.length > 0,
    reviewed: reviewed.length,
    firstTimeRate: reviewed.length ? Math.round((firstTime / reviewed.length) * 100) : null,
  };
}

/** A team's line in Teams at work, and its tag: stopped and full columns first, quiet last. */
export function teamFlowLine(flow) {
  const parts = [];
  if (flow.working) parts.push(`${flow.working} working`);
  if (flow.stopped) parts.push(`${flow.stopped} stopped`);
  if (flow.toReview) parts.push(`${flow.toReview} to review`);
  if (flow.waitingForRoom) parts.push(`${flow.waitingForRoom} waiting for room`);
  if (flow.firstTimeRate !== null) parts.push(`${flow.firstTimeRate}% accepted first time`);
  const text = parts.join(' · ') || (flow.open ? `${plural(flow.open, 'open card')}, none with an agent` : 'Nothing in flight');
  const tag = flow.stopped ? { label: `${flow.stopped} stopped`, tone: 'amber' }
    : flow.atLimit ? { label: 'At its limit', tone: 'amber' }
    : flow.working ? { label: 'Flowing', tone: 'green' }
    : null;
  return { text, tag };
}

/** Dollars as the KPI shows them: two decimals, and never $0.00 for a cost that is not zero. */
export function formatUsd(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (value > 0 && value < 0.01) return '<$0.01';
  return '$' + value.toFixed(2);
}

/**
 * What an agent is doing, in words, from the cards assigned to it: stopped first (a person is
 * needed), then waiting for approval, working, waiting for room, and idle.
 */
export function agentStatus(agentId, tasks = []) {
  const mine = tasks.filter((t) => t.status !== 'done' && t.assignee?.kind === 'agent' && String(t.assignee.id) === String(agentId));
  const pick = (state) => mine.filter((t) => t.agentState === state);
  const more = (list) => (list.length > 1 ? ` (+${list.length - 1} more)` : '');
  const stopped = pick('blocked');
  if (stopped.length) return { tone: 'stopped', label: `Stopped: ${stopped[0].stopReason || 'needs a look'}${more(stopped)}`, taskId: stopped[0].id };
  const approval = pick('waiting');
  if (approval.length) return { tone: 'approval', label: `Needs approval: “${approval[0].title}”${more(approval)}`, taskId: approval[0].id };
  const working = pick('running');
  if (working.length) return { tone: 'working', label: `${working[0].escalatedFrom ? 'Deciding on' : 'Working on'} “${working[0].title}”${more(working)}`, taskId: working[0].id };
  const queued = pick('queued');
  if (queued.length) return { tone: 'paused', label: `Waiting: ${queued[0].stopReason || 'no room yet'}${more(queued)}`, taskId: queued[0].id };
  return { tone: 'idle', label: 'Idle: no card assigned', taskId: null };
}

/** The drawer's mark beside a teamspace: what has stopped there, or that it is at its work limit. */
export function spaceMark(flow) {
  if (flow?.stopped) return `${flow.stopped} stopped`;
  if (flow?.atLimit) return 'At limit';
  return '';
}

/** Stopped cards in the order to answer them: the ones holding up the most work, then the longest stopped. */
export function byWhatTheyHoldUp(tasks = []) {
  return [...tasks].sort((a, b) => (b.holdingUp || 0) - (a.holdingUp || 0)
    || Date.parse(a.agentStateAt || a.updatedAt || 0) - Date.parse(b.agentStateAt || b.updatedAt || 0));
}

/** "3 of 3 checks passed", or the first check that failed, for a result waiting for review. */
export function checksSummary(checks = []) {
  const judged = checks.filter((c) => c.ok !== null && c.ok !== undefined);
  if (!judged.length) return null;
  const failed = judged.filter((c) => c.ok === false);
  if (!failed.length) return { label: `${judged.length} of ${judged.length} ${judged.length === 1 ? 'check' : 'checks'} passed`, tone: 'green' };
  return { label: `${failed.length === 1 ? '1 check' : `${failed.length} checks`} failed: ${failed[0].label}`, tone: 'amber' };
}
