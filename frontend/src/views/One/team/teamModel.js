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

/** A teamspace's tabs, as in the approved mockup. People is reached from the header's "Add people". */
export const SPACE_TABS = Object.freeze([
  { id: 'chat', label: 'Chat', icon: 'chats' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'docs', label: 'Docs', icon: 'doc' },
  { id: 'agents', label: 'Agents', icon: 'bot' },
  { id: 'routines', label: 'Routines', icon: 'bolt' },
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'people', label: 'People', icon: 'users', hidden: true },
]);
export const VIEWS = Object.freeze(['home', 'inbox', 'space', 'mine', 'doc', 'agents', 'agent', 'library', 'members']);
/** Library tabs, as in the approved mockup. */
export const LIBRARY_TABS = Object.freeze([
  { id: 'agents', label: 'Agents & skills' },
  { id: 'connections', label: 'Connections' },
  { id: 'templates', label: 'Templates' },
]);
/** My Space sections (the drawer). */
export const MINE_TABS = Object.freeze(['tasks']);

const str = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : '');
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const id = (v) => (ID.test(str(v)) ? str(v) : null);

/** The team page a /team query describes. Unknown or malformed values fall back, never throw. */
export function teamLocation(query = {}) {
  const view = VIEWS.includes(str(query.view)) ? str(query.view) : 'home';
  const tabs = view === 'library' ? LIBRARY_TABS : SPACE_TABS;
  const tab = tabs.some((t) => t.id === str(query.tab)) ? str(query.tab) : tabs[0].id;
  return { view, space: id(query.space), tab, task: id(query.task), doc: id(query.doc), item: id(query.item) };
}

/** The /team query for a location: the inverse of teamLocation (tested both ways). */
export function teamQuery(loc = {}) {
  const query = { view: VIEWS.includes(loc.view) ? loc.view : 'home' };
  if (loc.space) query.space = loc.space;
  if (loc.view === 'space' && loc.tab && loc.tab !== 'chat') query.tab = loc.tab;
  if (loc.view === 'library' && loc.tab && loc.tab !== 'agents') query.tab = loc.tab;
  if (loc.task) query.task = loc.task;
  if (loc.doc) query.doc = loc.doc;
  if (loc.item) query.item = loc.item;
  return query;
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
  return { running: 'Working…', waiting: 'Needs approval', blocked: 'Blocked', sent_back: 'Sent back' }[state] || '';
}
