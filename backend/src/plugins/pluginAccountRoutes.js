import PluginAccounts from './PluginAccountStore.js';
import { isRestrictedInstance, tenantOwnerId } from '../services/auth/tenantOwnership.js';

/** Keep every installed-package read/write behind the same account check. */
export async function pluginAccountBoundary(req, res, next) {
  try {
    await PluginAccounts.ready();
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    // Installing an extension executes trusted backend code. Membership alone
    // must never confer that administrative authority over a shared instance.
    if (isRestrictedInstance() && req.method !== 'GET' && userId !== tenantOwnerId()) {
      return res.status(403).json({ success: false, error: 'Only the instance owner may change installed extensions' });
    }
    const suppliedName = req.body?.name || req.body?.pluginName || req.body?.manifest?.name;
    if (suppliedName && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(suppliedName)) return res.status(400).json({ success: false, error: 'Invalid plugin name' });
    const ownedPath = req.path.match(/^\/(?:installed|update|update-policy)\/([^/]+)/);
    const assetPath = req.path.match(/^\/([^/]+)\/assets$/);
    const deletePath = req.method === 'DELETE' && req.path.match(/^\/([^/]+)$/);
    const match = ownedPath || assetPath || deletePath;
    if (match) {
      const name = decodeURIComponent(match[1]);
      await PluginAccounts.assert(name, userId);
      if (req.method !== 'GET' && req.method !== 'DELETE' && (await PluginAccounts.owners(name)).some(owner => owner !== userId)) {
        return res.status(409).json({ success: false, error: 'This package is also in use by another account. Its shared code cannot be changed here.' });
      }
    }
    if (req.method === 'POST' && ['/install-file','/install-github','/bundle-from-assets','/build-generated'].includes(req.path)) {
      const name = suppliedName;
      if (name && (await PluginAccounts.owners(name)).some(owner => owner !== userId)) {
        return res.status(409).json({ success: false, error: 'Another account uses a package with this name. Choose a different name; their package will not be overwritten.' });
      }
    }
    if (req.method === 'POST' && req.path === '/bundle-from-assets') {
      const selection = req.body?.selection || {};
      for (const [key, table, ownerColumn] of [['agentIds','agents','created_by'],['workflowIds','workflows','user_id'],['skillIds','skills','user_id'],['widgetIds','widget_definitions','user_id'],['toolIds','tools','created_by']]) {
        if (selection[key] != null && !Array.isArray(selection[key])) return res.status(400).json({ success: false, error: 'Invalid asset selection' });
        for (const id of selection[key] || []) {
          const row = await PluginAccounts.get(`SELECT id FROM ${table} WHERE ${ownerColumn}=? AND (id=?${key === 'toolIds' ? ' OR type=?' : ''})`, key === 'toolIds' ? [userId,id,id] : [userId,id]);
          if (!row) return res.status(404).json({ success: false, error: 'Selected asset is not owned by this account' });
        }
      }
    }
    next();
  } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
}

// Package files and the registry are host resources. Serialize mutations until the
// handler settles (not until the socket closes), then re-check account ownership.
// This prevents two accounts installing/uninstalling the same cache concurrently.
let mutationTail = Promise.resolve();
let queuedMutations = 0;
export function accountPluginMutation(handler) {
  return async (req, res) => {
    if (queuedMutations >= 20) return res.status(429).json({ success: false, error: 'Plugin operations are busy. Retry shortly.' });
    queuedMutations++;
    const predecessor = mutationTail;
    let release;
    mutationTail = new Promise(resolve => { release = resolve; });
    await predecessor;
    try {
      if (req.destroyed && !req.complete) return;
      let permitted = false;
      await pluginAccountBoundary(req, res, () => { permitted = true; });
      if (permitted) await handler(req, res);
    } catch (error) {
      console.error('[plugins] account operation failed:', error);
      if (!res.headersSent) res.status(error.status || 500).json({ success: false, error: error.message });
    } finally { queuedMutations--; release(); }
  };
}
