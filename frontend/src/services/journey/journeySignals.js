/**
 * Store traffic → journey events. A step's `until: { event }` is satisfied by
 * these, so a mission advances whether the person clicked through the UI or
 * asked Annie to do it from chat (realtime sync commits the same mutations).
 *
 * Mutations, where one exists, rather than actions: a mutation means the
 * thing is in the store, an action only that someone asked for it.
 */

export const MUTATION_EVENTS = Object.freeze({
  'agents/ADD_AGENT': 'agent.created',
  'workflows/ADD_WORKFLOW': 'workflow.created',
  'goals/ADD_GOAL': 'goal.created',
  'skills/ADD_SKILL': 'skill.created',
  'tools/ADD_TOOL': 'tool.created',
  'pluginBuilder/ADD_BUILT_PLUGIN_NAME': 'plugin.built',
});

// Resolved actions. A rejected one never reaches `after`, so a failed send or
// install does not count.
export const ACTION_EVENTS = Object.freeze({
  'chat/startStreamingConversation': 'chat.sent',
  'chatUnified/sendMessage': 'chat.sent',
  'marketplace/installWorkflow': 'market.installed',
  'marketplace/installPlugin': 'market.installed',
  'marketplace/saveInstalledAsset': 'market.installed',
});

const RUNNING_STATUSES = new Set(['running', 'listening', 'active', 'queued']);

/** Events that are also lasting facts about the account, kept as flags. */
export const EVENT_FLAGS = Object.freeze({
  'chat.sent': 'chatted',
  'market.installed': 'installed',
});

export function eventForMutation(mutation) {
  if (!mutation?.type) return null;
  if (mutation.type === 'workflows/UPDATE_WORKFLOW_STATUS') {
    return RUNNING_STATUSES.has(String(mutation.payload?.status || '').toLowerCase()) ? 'workflow.activated' : null;
  }
  return MUTATION_EVENTS[mutation.type] || null;
}

export function eventForAction(action) {
  return (action?.type && ACTION_EVENTS[action.type]) || null;
}
