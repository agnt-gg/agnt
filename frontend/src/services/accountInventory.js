// accountInventory — the counts that describe what an account HAS.
//
// One list, two readers: the Dashboard's System overview draws these numbers,
// and the navigation onion decides which rail rows exist from them. Keeping
// the getter/action pairs here means the rail can never disagree with the
// overview about whether, say, a workflow exists.

export const len = (value) =>
  Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;

// [getter that proves the module is populated, action that populates it,
//  optional payload]. Dispatched only when the getter is still empty. Chats
// asks for a single row: the server returns the real totalCount with it, and
// leaving hasLoadedAll false keeps the chat sidebar's own full load intact.
export const HYDRATION = [
  ['goals/allGoals', 'goals/fetchGoals'],
  ['agents/allAgents', 'agents/fetchAgents'],
  ['workflows/allWorkflows', 'workflows/fetchWorkflows'],
  ['tools/customTools', 'tools/fetchTools'],
  ['skills/allSkills', 'skills/fetchSkills'],
  ['schedules/allSchedules', 'schedules/fetchSchedules'],
  ['widgetDefinitions/allDefinitions', 'widgetDefinitions/fetchDefinitions'],
  ['insights/agentMemories', 'insights/fetchAllMemories'],
  ['insights/allInsights', 'insights/fetchInsights'],
  ['executionHistory/getExecutions', 'executionHistory/fetchExecutions'],
  ['contentOutputs/outputs', 'contentOutputs/fetchOutputs', { limit: 1, offset: 0, loadAll: false, force: true }],
];

const namespaceOf = (key) => key.split('/')[0];

/** True when the store actually registers the module a getter/action lives in. */
export function storeHas(store, key) {
  try {
    return typeof store.hasModule === 'function' ? store.hasModule(namespaceOf(key)) : key in (store.getters || {});
  } catch {
    return false;
  }
}

/**
 * Populate the modules in `entries` that are still empty.
 * Resolves to the set of GETTER keys whose data is now trustworthy — already
 * non-empty, or loaded without error. A module that is missing or whose load
 * failed is left out: "we could not find out" is not "there are none".
 */
export async function hydrate(store, entries = HYDRATION) {
  const loaded = new Set();
  await Promise.allSettled(
    entries.map(async ([getter, action, payload]) => {
      if (!storeHas(store, getter)) return;
      if (len(store.getters[getter]) > 0) {
        loaded.add(getter);
        return;
      }
      await store.dispatch(action, payload);
      loaded.add(getter);
    }),
  );
  return loaded;
}
