/**
 * The plugins an account installed, as the chat sees them.
 *
 * Each plugin is one tool category, `plugin:<package name>`, so the chat can
 * make it resident, list it in discover_tools and load it, one plugin at a
 * time. Ownership is per account (PluginAccountStore): a plugin another
 * account installed on this machine is not in this index.
 *
 * The data half (getPluginToolIndex) reads the live registry; everything else
 * here is pure, so the chat's residency rule is testable without a registry.
 */
import { estimateToolTokens } from '../../utils/contextManager.js';

export const PLUGIN_CATEGORY_PREFIX = 'plugin:';
export const pluginCategory = (pluginName) => PLUGIN_CATEGORY_PREFIX + pluginName;
export const isPluginCategory = (category) => typeof category === 'string' && category.startsWith(PLUGIN_CATEGORY_PREFIX);

/**
 * Installed plugin tools are resident in the chat up to this many tokens.
 *
 * Derivation, the same as WHITELIST_VERBATIM_BUDGET_TOKENS (chatConfigs.js):
 * the always-on DEFAULT_TOOLS baseline measures ~10.6k tokens on a live
 * install, so plugins may add at most about one baseline again. A typical
 * account (a handful of plugins) fits entirely and every plugin just works; a
 * power user with a hundred does not, and gets the ones named in the message
 * and the newest first, with the rest one discover_tools call away.
 */
export const PLUGIN_RESIDENT_BUDGET_TOKENS = 12_000;

/**
 * [{ name, displayName, category, toolNames, installedAt }] for every plugin
 * this account installed that registered at least one tool, newest install
 * first. Never throws: a registry that cannot be read leaves the chat with
 * its built-in tools, and says so in the log.
 */
export async function getPluginToolIndex(userId) {
  if (!userId) return [];
  try {
    const [{ default: toolRegistry }, { default: PluginAccounts }, { default: PluginManager }] = await Promise.all([
      import('./toolRegistry.js'),
      import('../../plugins/PluginAccountStore.js'),
      import('../../plugins/PluginManager.js'),
    ]);
    await toolRegistry.ensureInitialized();
    const installs = await PluginAccounts.installs(userId);
    const order = new Map(installs.map((row, index) => [row.plugin_name, { index, installedAt: row.installed_at || '' }]));
    const byPlugin = new Map();
    for (const tool of toolRegistry.getAllPluginTools()) {
      const toolName = tool.openApiSchema?.function?.name;
      if (!toolName || !order.has(tool.pluginName)) continue;
      if (!byPlugin.has(tool.pluginName)) {
        const meta = PluginManager.getPlugin(tool.pluginName);
        byPlugin.set(tool.pluginName, {
          name: tool.pluginName,
          displayName: meta?.displayName || tool.pluginName,
          category: pluginCategory(tool.pluginName),
          toolNames: [],
          installedAt: order.get(tool.pluginName).installedAt,
        });
      }
      const entry = byPlugin.get(tool.pluginName);
      if (!entry.toolNames.includes(toolName)) entry.toolNames.push(toolName);
    }
    return [...byPlugin.values()].sort((a, b) => order.get(a.name).index - order.get(b.name).index);
  } catch (error) {
    console.error('[PluginToolIndex] Could not read installed plugins; the chat continues without them:', error);
    return [];
  }
}

/** category -> Set(tool names), the shape getToolsForCategories takes. */
export function pluginToolsByCategory(index) {
  return new Map((index || []).map((plugin) => [plugin.category, new Set(plugin.toolNames)]));
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does the message name this plugin? By its display name ("Atlas Cloud") or
 * its package name without a "-plugin" suffix ("atlas-cloud", "gmail"). Words
 * may be joined by spaces, hyphens or underscores; whole words only, and at
 * least three letters, so "AI" or "X" never match by accident.
 */
export function messageNamesPlugin(message, plugin) {
  if (!message || !plugin) return false;
  const names = [plugin.displayName, String(plugin.name || '').replace(/[-_]plugin$/i, '')];
  return names.some((name) => {
    const words = String(name || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (words.join('').length < 3) return false;
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9])${words.map(escapeRegExp).join('[\\s_-]*')}(?![A-Za-z0-9])`, 'i');
    return pattern.test(message);
  });
}

/**
 * Which installed plugins are resident this turn. Pure.
 *
 *   1. Already resident in this conversation: stays. The surface only grows
 *      within a conversation, so the cached prompt prefix holds and a tool
 *      the model has seen never disappears under it.
 *   2. Named in the latest message: always, whatever the budget.
 *   3. Then the newest installs first while their tools fit what is left of
 *      the budget, so a plugin you just installed is in the very next chat.
 *
 * Only permitted tools count (the channel ceiling); a plugin with none
 * permitted is skipped. Returns the chosen plugins in index order.
 */
export function choosePluginResidency({ index, schemasByName, message = '', sticky = new Set(), permitted = () => true, budgetTokens = PLUGIN_RESIDENT_BUDGET_TOKENS }) {
  const chosen = new Set();
  let spent = 0;
  const costOf = (plugin) => estimateToolTokens(plugin.toolNames.filter(permitted).map((name) => schemasByName.get(name)).filter(Boolean));
  const usable = (index || []).filter((plugin) => plugin.toolNames.some((name) => permitted(name) && schemasByName.has(name)));

  for (const plugin of usable) {
    if (sticky.has(plugin.category) || messageNamesPlugin(message, plugin)) {
      chosen.add(plugin.category);
      spent += costOf(plugin);
    }
  }
  for (const plugin of usable) {
    if (chosen.has(plugin.category)) continue;
    const cost = costOf(plugin);
    if (spent + cost > budgetTokens) continue;
    chosen.add(plugin.category);
    spent += cost;
  }
  return usable.filter((plugin) => chosen.has(plugin.category));
}
