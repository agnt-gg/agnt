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

export const SPACE_TABS = Object.freeze([
  { id: 'chat', label: 'Chat' },
  { id: 'board', label: 'Board' },
  { id: 'docs', label: 'Docs' },
  { id: 'agents', label: 'Agents' },
  { id: 'routines', label: 'Routines' },
  { id: 'people', label: 'People' },
]);
export const VIEWS = Object.freeze(['home', 'inbox', 'space', 'mine', 'doc']);

const str = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : '');
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const id = (v) => (ID.test(str(v)) ? str(v) : null);

/** The team page a /team query describes. Unknown or malformed values fall back, never throw. */
export function teamLocation(query = {}) {
  const view = VIEWS.includes(str(query.view)) ? str(query.view) : 'home';
  const tab = SPACE_TABS.some((t) => t.id === str(query.tab)) ? str(query.tab) : 'chat';
  return { view, space: id(query.space), tab, task: id(query.task), doc: id(query.doc) };
}

/** The /team query for a location: the inverse of teamLocation (tested both ways). */
export function teamQuery(loc = {}) {
  const query = { view: VIEWS.includes(loc.view) ? loc.view : 'home' };
  if (loc.space) query.space = loc.space;
  if (loc.view === 'space' && loc.tab && loc.tab !== 'chat') query.tab = loc.tab;
  if (loc.task) query.task = loc.task;
  if (loc.doc) query.doc = loc.doc;
  return query;
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

/** Card label for an agent's state. */
export function agentStateLabel(state) {
  return { running: 'Working…', waiting: 'Needs approval', blocked: 'Blocked', sent_back: 'Sent back' }[state] || '';
}
