/**
 * AGNT One — the model behind the frame. Pure: facts in, plain data out.
 *
 * Three things live here:
 *   the setup     the three steps the top-bar capsule tracks;
 *   the rail      which icons it shows;
 *   the greeting  what Annie says on an empty chat.
 *
 * Facts are the counts useJourney.readFacts reads from the live store, plus
 * the connected-app ids and Text Annie's status. What no store records (the
 * setup was finished, the capsule was hidden) is kept per account in
 * localStorage; see loadOneFlags.
 */
import { CONNECT_AI_TITLE, CONNECT_AI_HINT } from '@/services/ownAi.js';
import { isPhoneLinked, phoneEligible } from '@/services/firstRunSetup.js';

// ── The setup ────────────────────────────────────────────────────────────────

/**
 * The first-run setup's three steps (services/firstRunSetup.js), in its
 * order: your AI, then Google, then your phone. A tap opens the setup at that
 * step in a blank chat (FirstRunSetup, in OneWelcome), which connects through
 * the app's own pipelines (2026-10-28). They used to be seven goals, the last
 * three of them requests to type; the setup's done screen now offers the
 * first request itself.
 *
 * Connecting your own AI stays first and required (2026-10-21): starting on
 * AGNT Flash ("for now") leaves it as the next step. The phone needs a plan
 * with texting; on one without, it is shown as optional and "All set" does
 * not wait for it.
 */
export const ONE_STEPS = Object.freeze([
  { id: 'ai', title: CONNECT_AI_TITLE, hint: CONNECT_AI_HINT, action: { kind: 'setup', step: 'ai' } },
  { id: 'google', title: 'Connect Google', hint: 'Gmail, Calendar and Drive in one sign-in', action: { kind: 'setup', step: 'google' } },
  { id: 'phone', title: 'Text Annie from your phone', hint: 'iMessage, RCS or SMS', pro: true, action: { kind: 'setup', step: 'phone' } },
]);

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

const DONE = Object.freeze({
  ai: ({ facts }) => count(facts.aiModels) > 0,
  google: ({ apps }) => apps.includes('google'),
  phone: ({ phone }) => isPhoneLinked(phone),
});
/** Shown, but not waited for: a plan that cannot text has nothing to link. */
const OPTIONAL = Object.freeze({
  phone: ({ phone }) => phoneEligible(phone) === false,
});

const normalizeApps = (apps) => (Array.isArray(apps) ? apps.map((app) => String(app).toLowerCase()) : []);

/**
 * Where the account is in its setup. `phone` is Text Annie's status (null
 * until it answers). `next` is the first unfinished required step; an
 * optional one is next only once nothing required is left. `complete`
 * ignores optional steps.
 */
export function oneSummary({ facts = {}, apps = [], phone = null } = {}) {
  const input = { facts: facts || {}, apps: normalizeApps(apps), phone };
  const evaluated = ONE_STEPS.map((step) => ({ ...step, optional: !!OPTIONAL[step.id]?.(input), done: DONE[step.id](input) }));
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
const EMPTY_FLAGS = Object.freeze({ setup: false, hidden: false });

export function flagsKey(account) {
  return account ? `${FLAGS_KEY}:${account}` : FLAGS_KEY;
}

/** Only known keys, only booleans: a hand-edited or stale value cannot leak through. */
function cleanFlags(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_FLAGS };
  return { setup: raw.setup === true, hidden: raw.hidden === true };
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
  home: '<path d="M4 11 12 4l8 7v8.5a1 1 0 0 1-1 1h-4.5V15h-5v5.5H5a1 1 0 0 1-1-1z"/>',
  inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13.5h4.5l1 2.5h5l1-2.5H20"/>',
  new: '<path d="M12 20h8M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 4 19.5l.9-3.5z"/>',
  chats: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  routines: '<path d="M17 2.5l3 3-3 3M4 11.5v-2a4 4 0 0 1 4-4h12M7 21.5l-3-3 3-3M20 12.5v2a4 4 0 0 1-4 4H4"/>',
  library: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5zM9 4h4v16H9zM14.5 5.2l3.4-.9 2.6 15.4-3.4.9z"/>',
  market: '<path d="M4 9.5 5.5 4h13L20 9.5zM4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20"/>',
  // A brain, as Memory is drawn elsewhere (fa-brain): a scalloped outline
  // with folds, so it does not read as a round globe at rail size.
  memory: '<path d="M12 4.5c-1-1.2-3.2-1.3-4.3 0-1.6-.2-3 1.1-2.9 2.8-1.6.6-2.4 2.4-1.7 4-1.1 1-1.2 2.9-.1 4 .1 1.7 1.6 3 3.3 2.8.9 1.2 2.7 1.4 3.7.4zM12 4.5c1-1.2 3.2-1.3 4.3 0 1.6-.2 3 1.1 2.9 2.8 1.6.6 2.4 2.4 1.7 4 1.1 1 1.2 2.9.1 4-.1 1.7-1.6 3-3.3 2.8-.9 1.2-2.7 1.4-3.7.4M8.5 9.3c1 0 1.8.8 1.8 1.7M15.5 9.3c-1 0-1.8.8-1.8 1.7M8 14.2c.8.6 1.8.6 2.5 0M16 14.2c-.8.6-1.8.6-2.5 0"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/>',
  goals: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  approvals: '<path d="M12 3.5 19.5 6v5.5c0 4.5-3.2 8-7.5 9-4.3-1-7.5-4.5-7.5-9V6z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>',
  find: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
});

/** Which rail icon a page belongs to (its active state). */
// Activity and Memories live under More (2026-10-23). The Market is on the
// rail again (2026-10-26): publishing, your listings and earnings live there.
const RAIL_OF_PAGE = Object.freeze({ connectors: 'apps', scheduled: 'routines', library: 'library', market: 'market', activity: 'more', memory: 'more', settings: 'settings' });
/** The page each rail icon (or More entry) opens; `chats` toggles the drawer, `more` opens its menu. */
export const RAIL_PAGE = Object.freeze({ apps: 'connectors', routines: 'scheduled', library: 'library', market: 'market', activity: 'activity', memory: 'memory', settings: 'settings' });
/**
 * What More holds, in order (2026-10-23). Dashboard, Goals and Approvals are
 * Studio's screens, opened in full with a way back (`screen`); Find anything
 * opens the Ctrl+K palette, so every other screen is a click away too.
 */
export const MORE_ITEMS = Object.freeze([
  { id: 'activity', label: 'Activity' },
  { id: 'memory', label: 'Memories' },
  { id: 'dashboard', label: 'Dashboard', screen: 'DashboardScreen' },
  { id: 'goals', label: 'Goals', screen: 'GoalsScreen' },
  { id: 'approvals', label: 'Approvals', screen: 'LearningScreen' },
  { id: 'find', label: 'Find anything', hint: 'Ctrl K', separated: true },
]);
/** The Studio screen a More entry opens, if any. */
export const MORE_SCREEN = Object.freeze(Object.fromEntries(MORE_ITEMS.filter((m) => m.screen).map((m) => [m.id, m.screen])));

/**
 * The rail is AGNT One's only navigation, so it always lists every place.
 * It used to grow with the account (Apps, Routines, Library appeared once
 * there was something behind them), which forced the Chats drawer to carry
 * the same links again: two navigations side by side (reported 2026-10-21).
 * The drawer now holds chats only. Settings is pinned to the bottom.
 */
export function railItems({ activePage = null, drawerOpen = false, onBlankChat = false, activeScreen = null, needsYou = 0 } = {}) {
  // The page you are on is highlighted, open drawer or not. The drawer used to
  // win, so with it left open every page lit up Chats (reported 2026-10-21).
  // Chats is highlighted only on a chat with the drawer open; otherwise an
  // open drawer is shown as `open` on the Chats icon.
  // New chat is in the Chats drawer's header, not on the rail (2026-10-21), so
  // a blank chat highlights Chats like any other chat.
  // A Studio screen opened from More lights More.
  // Teamspaces: Home is also the inbox (2026-10-30), so every /team page (Home,
  // a teamspace, My tasks, a doc, an old inbox link) lights Home.
  const teamRail = activePage === 'team' ? 'home' : null;
  const page = teamRail || RAIL_OF_PAGE[activePage] || (!activePage && Object.values(MORE_SCREEN).includes(activeScreen) ? 'more' : null);
  const active = page || (drawerOpen || (onBlankChat && !activePage) ? 'chats' : null);
  const items = [
    { id: 'home', label: 'Home' },
    { id: 'chats', label: 'Chats' },
    { id: 'apps', label: 'Apps' },
    { id: 'routines', label: 'Routines' },
    { id: 'library', label: 'Library' },
    { id: 'market', label: 'Market' },
    { id: 'more', label: 'More' },
  ];
  return items.map(({ id, label }) => ({
    id,
    label,
    icon: RAIL_ICONS[id],
    active: active === id,
    ...(id === 'chats' ? { open: drawerOpen } : {}),
    // What needs you (Home's inbox): checkpoints waiting for your OK plus unread team items.
    ...(id === 'home' && needsYou > 0 ? { badge: needsYou > 99 ? '99+' : String(needsYou) } : {}),
    ...(id === 'more' ? { menu: MORE_ITEMS.map((m) => ({ ...m, icon: RAIL_ICONS[m.id], active: activePage === m.id || (!!m.screen && activeScreen === m.screen) })) } : {}),
  }));
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
