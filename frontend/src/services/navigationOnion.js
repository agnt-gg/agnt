// navigationOnion — the rail grows with the account.
//
// A new account sees one row: Chat. Every other row appears the first time
// the thing it manages exists — connect an app and Apps appears, save a
// workflow and Workflows appears — and stays. The rail is therefore a record
// of what this person has actually done, not a menu of everything AGNT can do.
//
// Nothing becomes unreachable. Hidden rows are still indexed by the jump
// palette (jumpCatalog.spec.js enforces every screen is there), listed in
// Settings → Navigation, and one click away via "Show all".
//
// PRECEDENCE (resolved in navigationPreferences.js):
//   1. an explicit Shown/Hidden the user set in Settings → Navigation
//   2. unlocked here
//   3. hidden
//
// SEEDING. The first time a rule can be judged — every fact it reads has
// loaded — its answer is recorded SILENTLY. Only a later false → true flip is
// an unlock worth announcing. That is what keeps an existing account, whose
// facts are all already true, from being greeted by a dozen "congratulations"
// popups on upgrade: it simply gets the rail it has earned, quietly.
//
// This module is pure: facts in, state out. No Vue, no store, no DOM — the
// composable that feeds it lives in composables/useNavigationOnion.js.

export const ONION_STORAGE_KEY = 'agnt:navigationOnion:v1';

/** Rows that are on the rail from the first second. */
export const ALWAYS_UNLOCKED = new Set(['chat']);

// Connections AGNT itself holds for every signed-in account. Counting them
// would unlock Apps before the person had connected anything.
const INTERNAL_CONNECTION = /^agnt/i;

const count = (value) => (Array.isArray(value) ? value.length : Number.isFinite(value) ? value : 0);

export function countUserConnections(connectedApps) {
  return (Array.isArray(connectedApps) ? connectedApps : []).filter(
    (id) => typeof id === 'string' && id && !INTERNAL_CONNECTION.test(id),
  ).length;
}

/**
 * One rule per rail row. `needs` names the facts the rule reads; the rule is
 * not judged (and so not seeded) until all of them have loaded. `title` and
 * `message` are the one-line tour shown when the row appears.
 *
 * Order matters only for `dashboard`, which counts the rows unlocked before it.
 */
export const UNLOCK_RULES = [
  {
    id: 'apps',
    needs: ['connectedApps'],
    when: (f) => countUserConnections(f.connectedApps) > 0,
    title: 'Plugins',
    message: 'Your first connection. Everything AGNT can use for you lives here — connect a service once and every plugin that uses it can use the connection.',
  },
  {
    id: 'artifacts',
    needs: ['chats'],
    when: (f) => count(f.chats) > 0,
    title: 'Files',
    message: 'Everything Annie writes for you is saved here.',
  },
  {
    id: 'traces',
    needs: ['executions'],
    when: (f) => count(f.executions) > 0,
    title: 'Activity',
    message: 'Every run, step by step. Check here to see what happened.',
  },
  {
    id: 'goals',
    needs: ['goals'],
    when: (f) => count(f.goals) > 0,
    title: 'Goals',
    message: 'Longer jobs Annie works toward in the background show up here.',
  },
  {
    id: 'workflows',
    needs: ['workflows'],
    when: (f) => count(f.workflows) > 0,
    title: 'Workflows',
    message: 'Your first workflow. Manage, run and schedule them here.',
  },
  {
    id: 'agents',
    needs: ['agents'],
    when: (f) => count(f.agents) > 0,
    title: 'Agents',
    message: 'Your first agent. Edit what it knows and what it can do here.',
  },
  {
    id: 'tools',
    needs: ['tools'],
    when: (f) => count(f.tools) > 0,
    title: 'Tools',
    message: 'Tools you build live here. Agents and workflows both use them.',
  },
  {
    id: 'skills',
    needs: ['skills'],
    when: (f) => count(f.skills) > 0,
    title: 'Skills',
    message: 'What your agents know how to do. Plugins can bring their own.',
  },
  {
    id: 'widgets',
    needs: ['widgets'],
    when: (f) => count(f.widgets) > 0,
    title: 'Widgets',
    message: 'Things you can see: put them on the Dashboard, a Canvas or a page.',
  },
  {
    id: 'store',
    needs: ['agents', 'workflows', 'tools'],
    when: (f) => count(f.agents) + count(f.workflows) + count(f.tools) > 0,
    title: 'Market',
    message: 'Ready-made agents, workflows and plugins — install one, or publish yours.',
  },
  {
    // An overview earns its place once there is enough to overview.
    id: 'dashboard',
    needs: [],
    after: true,
    when: (_f, unlocked) => [...unlocked].filter((id) => !ALWAYS_UNLOCKED.has(id)).length >= 5,
    title: 'Dashboard',
    message: 'A lot is going on now. This is the one-glance view of all of it.',
  },
];

export const UNLOCK_RULE_BY_ID = Object.fromEntries(UNLOCK_RULES.map((rule) => [rule.id, rule]));

export function emptyOnionState() {
  return { version: 1, unlocked: [], seeded: [], fresh: [] };
}

function cleanIds(value) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && id && id !== 'teams'))] : [];
}

export function loadOnionState(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(ONION_STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1) return emptyOnionState();
    return { version: 1, unlocked: cleanIds(parsed.unlocked), seeded: cleanIds(parsed.seeded), fresh: cleanIds(parsed.fresh) };
  } catch {
    return emptyOnionState();
  }
}

export function saveOnionState(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(ONION_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Quota / private mode: the rail falls back to what it computed this
    // session. Losing persistence is not worth losing the navigation.
    console.warn('[navigationOnion] could not persist:', error?.message || error);
  }
  return state;
}

export function isUnlocked(id, state = loadOnionState()) {
  return ALWAYS_UNLOCKED.has(id) || state.unlocked.includes(id);
}

/**
 * Judge every rule that can be judged.
 *
 * @param {object} facts  fact name → array | number
 * @param {Set<string>} known  fact names that have finished loading
 * @param {object} state  current onion state (not mutated)
 * @param {object} [options]
 * @param {(id: string) => boolean} [options.quiet]  rows whose flip right now
 *        is not news (the caller's startup window); they unlock silently.
 * @returns {{ state: object, announced: string[] }}  `announced` lists rows
 *          that flipped false → true AFTER being seeded — the only unlocks the
 *          UI should celebrate. Silent seeds never appear in it.
 */
export function evaluateUnlocks(facts, known, state, { quiet = () => false } = {}) {
  const unlocked = new Set(cleanIds(state.unlocked));
  const seeded = new Set(cleanIds(state.seeded));
  const fresh = new Set(cleanIds(state.fresh));
  const announced = [];

  const judge = (rule) => {
    if (unlocked.has(rule.id)) {
      seeded.add(rule.id);
      return;
    }
    const passes = Boolean(rule.when(facts, unlocked));
    if (passes) {
      unlocked.add(rule.id);
      if (seeded.has(rule.id) && !quiet(rule.id)) {
        announced.push(rule.id);
        fresh.add(rule.id);
      }
    }
    seeded.add(rule.id);
  };

  const ready = (rule) => rule.needs.every((fact) => known.has(fact));
  const primary = UNLOCK_RULES.filter((rule) => !rule.after);
  primary.filter(ready).forEach(judge);

  // Rules that read the unlock set itself wait until every primary rule has
  // been seeded, or a half-loaded account would look emptier than it is.
  if (primary.every((rule) => seeded.has(rule.id))) {
    UNLOCK_RULES.filter((rule) => rule.after).forEach(judge);
  }

  return {
    state: { version: 1, unlocked: [...unlocked], seeded: [...seeded], fresh: [...fresh] },
    announced,
  };
}

/** The row was visited: it is no longer new. */
export function markSeen(id, state) {
  if (!state.fresh.includes(id)) return state;
  return { ...state, fresh: state.fresh.filter((freshId) => freshId !== id) };
}
