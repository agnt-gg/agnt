// Per-channel chat configuration backed by localStorage. Each chat surface
// (orchestrator, agent forge, every saved-agent, every workflow, every tool,
// every widget, the artifacts session) carries its own AI provider, model,
// and enabled-tool list — keyed by channelKey ("agent:agent-chat",
// "workflow:<id>", "widget:<id>", "tool:<id>", "artifact:<sessionId>",
// "orchestrator:default", etc.).
//
// All reads and writes go through this module so the selectors, the send
// pipeline, and the UnifiedChatContainer stay in sync. The shape is:
//
//   { [channelKey]: { provider?: string, model?: string, enabledTools?: string[] } }

const STORAGE_KEY = 'agnt_chat_channel_configs';

// Per-chat-type SPECIALTY tool sets. These are the page-specific tools that
// every sidebar chat MUST have access to — they're presented in the tool
// selector under a locked "Specialty Tools" category that the user cannot
// toggle off. The page would be functionally broken without them.
//
// The orchestrator (`orchestrator:*`) is intentionally not listed — its main
// chat surface gets the full Built In + Plugins set, no specialty lock-in.
// Sidebar chats start with ONLY their specialty set enabled; the user can
// additionally enable System Tools or Plugins per chat from the selector.
//
// These mirror the backend's TOOL_GROUPS in toolSelector.js; if the canonical
// list there changes, mirror the change here so the frontend default matches
// what the backend actually exposes.
// mcp_client is included in every sidebar default — MCP awareness is a
// universal capability. v0.5.7 added strict whitelist enforcement; without
// adding mcp_client here it would be hidden from every sidebar chat.
const SIDEBAR_DEFAULTS = {
  agent: [
    'generate_agent',
    'modify_agent',
    'save_agent',
    'load_agent',
    'delete_agent',
    'list_agents',
    'run_agent',
    'get_agnt_api',
    'mcp_client',
  ],
  workflow: [
    'update_workflow',
    'revert_workflow',
    'list_workflow_versions',
    'create_checkpoint',
    'get_available_tool_node_types',
    'get_node_type_schema',
    'start_workflow',
    'stop_workflow',
    'get_agnt_api',
    'mcp_client',
  ],
  tool: [
    'generate_tool_update',
    'save_tool',
    'load_tool',
    'delete_tool',
    'list_tools',
    'run_tool',
    'get_agnt_api',
    'mcp_client',
  ],
  widget: [
    'edit_widget_code',
    'generate_widget',
    'update_widget_config',
    'save_widget',
    'load_widget',
    'get_agnt_api',
    'mcp_client',
  ],
  artifact: [
    'read_file',
    'write_file',
    'edit_file',
    'list_files',
    'get_agnt_api',
    'mcp_client',
  ],
};

function channelType(channelKey) {
  if (!channelKey || typeof channelKey !== 'string') return '';
  const i = channelKey.indexOf(':');
  return i === -1 ? channelKey : channelKey.slice(0, i);
}

/**
 * Returns the default enabled-tool list for a fresh channel, or null if the
 * channel type doesn't have a curated default (orchestrator + unknown types
 * fall back to "everything available", which the caller signals by returning
 * null rather than an empty array — empty would mean "tools disabled").
 */
export function getDefaultEnabledTools(channelKey) {
  const type = channelType(channelKey);
  return SIDEBAR_DEFAULTS[type] || null;
}

/**
 * Specialty tools for a channel — the page-specific set that must always
 * stay enabled. Returned as an array (or null if no specialty set applies,
 * e.g. orchestrator). Same data as getDefaultEnabledTools but named for the
 * locked "Specialty Tools" category in the selector UI.
 */
export function getSpecialtyToolNames(channelKey) {
  return getDefaultEnabledTools(channelKey);
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[chatChannelConfig] Failed to parse storage:', e);
    return {};
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[chatChannelConfig] Failed to persist:', e);
  }
}

/**
 * Read the saved config for a channel. Returns null when no override is set;
 * callers should fall back to the global default in that case.
 * @param {string} channelKey
 * @returns {{provider?: string, model?: string, enabledTools?: string[]}|null}
 */
export function getChannelConfig(channelKey) {
  if (!channelKey) return null;
  const all = readAll();
  return all[channelKey] || null;
}

/**
 * Merge partial fields into a channel's config.
 */
export function setChannelConfig(channelKey, patch) {
  if (!channelKey || !patch || typeof patch !== 'object') return;
  const all = readAll();
  all[channelKey] = { ...(all[channelKey] || {}), ...patch };
  writeAll(all);
}

export function setChannelProvider(channelKey, provider) {
  setChannelConfig(channelKey, { provider });
}

export function setChannelModel(channelKey, model) {
  setChannelConfig(channelKey, { model });
}

export function setChannelEnabledTools(channelKey, names) {
  setChannelConfig(channelKey, { enabledTools: Array.isArray(names) ? names : [] });
}

/**
 * Resolve the provider+model a channel should use right now. Falls back to
 * the global Vuex aiProvider state when the channel hasn't been customised.
 *
 * @param {string} channelKey
 * @param {{selectedProvider?: string, selectedModel?: string}|null} aiProviderState
 *   Pass `rootState.aiProvider` from a Vuex action; pass null/undefined when
 *   you don't have access (callers will then receive only the per-channel
 *   override and need their own fallback).
 */
export function resolveChannelProviderModel(channelKey, aiProviderState) {
  const cfg = getChannelConfig(channelKey) || {};
  return {
    provider: cfg.provider || aiProviderState?.selectedProvider || null,
    model: cfg.model || aiProviderState?.selectedModel || null,
  };
}

/**
 * Resolve the enabled-tool list for a channel. Specialty tools (the locked
 * page-specific set) are ALWAYS unioned in — they can't be turned off, so
 * they ride along regardless of what the user has saved. After that:
 *   1. Explicit per-channel save (the user has customised this chat).
 *   2. Curated default = specialty only (for sidebar chats with no save).
 *   3. Legacy global list at `agnt_enabled_tools` (only for channels with
 *      no specialty set, e.g. orchestrator).
 *   4. undefined — let the backend default to "everything available".
 *      The orchestrator falls into this bucket so its chat keeps full reach.
 */
export function resolveChannelEnabledTools(channelKey) {
  const specialty = getSpecialtyToolNames(channelKey) || [];

  const cfg = getChannelConfig(channelKey);
  if (cfg && Array.isArray(cfg.enabledTools)) {
    if (specialty.length > 0) {
      return Array.from(new Set([...specialty, ...cfg.enabledTools]));
    }
    return cfg.enabledTools;
  }

  // No save yet for this channel.
  if (specialty.length > 0) return specialty;

  // Channel has no specialty set (orchestrator / unknown) — fall back to
  // legacy global list, otherwise let the backend pick its own default.
  try {
    const legacy = localStorage.getItem('agnt_enabled_tools');
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    /* ignore */
  }
  return undefined;
}
