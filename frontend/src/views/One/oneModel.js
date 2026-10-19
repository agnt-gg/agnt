/**
 * AGNT One — the model behind the frame. Pure: facts in, plain data out.
 *
 * Three things live here:
 *   the first ten minutes  the seven goals the top-bar capsule tracks;
 *   the rail               which icons it shows (it grows with the account);
 *   the greeting           what Annie says on an empty chat.
 *
 * Facts are the counts useJourney.readFacts reads from the live store, plus
 * the connected-app ids. The two things no store records (the ah-ha request
 * was sent, the capsule was hidden) are flags kept per account in
 * localStorage; see loadOneFlags.
 */

// ── The first ten minutes ──────────────────────────────────────────────────

/** The ah-ha. Specific on purpose: Annie needs the whole job to do it in one go. */
export const AHA_PROMPT =
  'Prep me for tomorrow: read my calendar, research anyone I am meeting from outside my company, ' +
  'go through my recent email with them, write a one-page brief for each meeting in a Google Doc, ' +
  'and draft the replies I owe. Read and draft only. Send nothing.';

/** Two apps working together: the ah-ha, every weekday, delivered to Slack. */
export const AUTOPILOT_PROMPT =
  'Every weekday at 7am, prep me for the day the same way and send me the brief on Slack. Ask me before any email goes out.';

/** Sent from the capsule's "First chat" step. */
export const FIRST_CHAT_PROMPT = 'What can you do for me?';

/** Sent from the capsule's "Connect Google" step. */
export const GOOGLE_PROMPT = 'Connect my Google account';

/** Matches the ah-ha however it was phrased: typed, edited, or sent from the capsule. */
const AHA_PATTERN = /\bprep me for tomorrow\b/i;

export function isAhaRequest(text) {
  return typeof text === 'string' && AHA_PATTERN.test(text);
}

/**
 * The seven goals, in order. `action` is what a tap does: put a sentence in
 * the composer (`ask`), or open the model picker (`models`; a key never goes
 * through the chat). The first two are done by the time anyone can see them.
 */
export const ONE_STEPS = Object.freeze([
  { id: 'get', title: 'Get AGNT' },
  { id: 'open', title: 'Open it' },
  { id: 'chat', title: 'First chat', hint: 'Ask Annie anything', action: { kind: 'ask', text: FIRST_CHAT_PROMPT } },
  { id: 'brain', title: 'A bigger brain', hint: 'Claude, ChatGPT or your own key', optional: true, action: { kind: 'models' } },
  { id: 'google', title: 'Connect Google', hint: 'Gmail, Calendar and Drive in one sign-in', action: { kind: 'ask', text: GOOGLE_PROMPT } },
  { id: 'aha', title: 'Prep me for tomorrow', hint: 'The one that saves an hour', action: { kind: 'ask', text: AHA_PROMPT } },
  { id: 'autopilot', title: 'Put it on autopilot', hint: 'Two apps, working together', action: { kind: 'ask', text: AUTOPILOT_PROMPT } },
]);

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

const DONE = Object.freeze({
  get: () => true,
  open: () => true,
  chat: ({ facts }) => count(facts.chats) > 0,
  brain: ({ facts }) => count(facts.aiModels) > 0,
  google: ({ apps }) => apps.includes('google'),
  aha: ({ flags }) => flags.aha === true,
  autopilot: ({ facts }) => count(facts.workflows) + count(facts.schedules) > 0,
});

const normalizeApps = (apps) => (Array.isArray(apps) ? apps.map((app) => String(app).toLowerCase()) : []);

/**
 * Where the account is in its first ten minutes.
 * `next` is the first unfinished required goal; an optional one is next only
 * once nothing required is left. `complete` ignores optional goals.
 */
export function oneSummary({ facts = {}, apps = [], flags = {} } = {}) {
  const input = { facts: facts || {}, apps: normalizeApps(apps), flags: flags || {} };
  const evaluated = ONE_STEPS.map((step) => ({ ...step, optional: step.optional === true, done: DONE[step.id](input) }));
  const next = evaluated.find((step) => !step.done && !step.optional) || evaluated.find((step) => !step.done) || null;
  const steps = evaluated.map((step) => ({ ...step, current: step.id === next?.id }));
  return {
    steps,
    done: steps.filter((step) => step.done).length,
    total: steps.length,
    complete: steps.every((step) => step.done || step.optional),
    next,
  };
}

/** The ring's stroke-dashoffset for `done` of `total` (r = 8 → 2πr ≈ 50.27). */
export const RING_CIRCUMFERENCE = 50.27;
export function ringOffset(done, total, circumference = RING_CIRCUMFERENCE) {
  if (!(total > 0)) return circumference;
  const share = Math.min(Math.max(done / total, 0), 1);
  return Number((circumference * (1 - share)).toFixed(2));
}

// ── Flags no store records ─────────────────────────────────────────────────

const FLAGS_KEY = 'agnt:one-journey';
const EMPTY_FLAGS = Object.freeze({ aha: false, hidden: false });

export function flagsKey(account) {
  return account ? `${FLAGS_KEY}:${account}` : FLAGS_KEY;
}

/** Only known keys, only booleans: a hand-edited or stale value cannot leak through. */
function cleanFlags(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_FLAGS };
  return { aha: raw.aha === true, hidden: raw.hidden === true };
}

export function loadOneFlags(account, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(flagsKey(account));
    return cleanFlags(raw ? JSON.parse(raw) : null);
  } catch {
    // Corrupt JSON or storage disabled: start clean rather than break the frame.
    return { ...EMPTY_FLAGS };
  }
}

/** Saves and returns the cleaned flags. A failed write keeps them for this session. */
export function saveOneFlags(account, flags, storage = globalThis.localStorage) {
  const clean = cleanFlags(flags);
  try {
    storage?.setItem(flagsKey(account), JSON.stringify(clean));
  } catch (error) {
    console.warn('[AGNT One] could not save first-run progress:', error?.message || error);
  }
  return clean;
}

// ── The rail ───────────────────────────────────────────────────────────────

/** 24×24 stroke icons. Static, trusted markup (rendered with v-html). */
export const RAIL_ICONS = Object.freeze({
  new: '<path d="M12 20h8M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 4 19.5l.9-3.5z"/>',
  chats: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  routines: '<path d="M17 2.5l3 3-3 3M4 11.5v-2a4 4 0 0 1 4-4h12M7 21.5l-3-3 3-3M20 12.5v2a4 4 0 0 1-4 4H4"/>',
  library: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5zM9 4h4v16H9zM14.5 5.2l3.4-.9 2.6 15.4-3.4.9z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
});

/** Which rail icon a page belongs to (its active state). */
const RAIL_OF_PAGE = Object.freeze({ connectors: 'apps', scheduled: 'routines', library: 'library', settings: 'settings' });
/** The page each rail icon opens; `chats` toggles the drawer instead. */
export const RAIL_PAGE = Object.freeze({ apps: 'connectors', routines: 'scheduled', library: 'library', settings: 'settings' });

/**
 * The rail grows with the account: an icon appears once there is something
 * behind it, and while its page is open (a link can land there first).
 * New chat and Chats are always there; Settings is pinned to the bottom.
 */
export function railItems({ facts = {}, activePage = null, drawerOpen = false, onBlankChat = false } = {}) {
  const has = (...keys) => keys.reduce((sum, key) => sum + count(facts[key]), 0) > 0;
  const active = drawerOpen ? 'chats' : RAIL_OF_PAGE[activePage] || (onBlankChat && !activePage ? 'new' : null);
  const items = [
    { id: 'new', label: 'New chat', show: true },
    { id: 'chats', label: 'Chats', show: true },
    { id: 'apps', label: 'Apps', show: has('apps') || active === 'apps' },
    { id: 'routines', label: 'Routines', show: has('workflows', 'schedules') || active === 'routines' },
    { id: 'library', label: 'Library', show: has('agents', 'tools', 'skills', 'widgets') || active === 'library' },
  ];
  return items.filter((item) => item.show).map(({ id, label }) => ({ id, label, icon: RAIL_ICONS[id], active: active === id }));
}

// ── The greeting ───────────────────────────────────────────────────────────

export function partOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** "Good afternoon, Maya." — or without a name when there is none. */
export function greetingFor(name, date = new Date()) {
  const greeting = `Good ${partOfDay(date)}`;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed ? `${greeting}, ${trimmed}.` : `${greeting}.`;
}
