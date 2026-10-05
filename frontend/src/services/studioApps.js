import { appDisplayName, pluginProviders } from './appCards.js';

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const text = (value) => typeof value === 'string' ? value : '';
export const ASSET_GROUPS = Object.freeze([
  { key: 'agents', label: 'Agents', icon: 'agent' },
  { key: 'tools', label: 'Tools', icon: 'tool' },
  { key: 'widgets', label: 'Widgets', icon: 'grid' },
  { key: 'skills', label: 'Skills', icon: 'book' },
  { key: 'workflows', label: 'Workflows', icon: 'flow' },
]);
export const titleFromSlug = (value) => text(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Studio lists packages, not credentials. Focused keeps its existing account-grouped cards. */
export function studioCatalog(installed = [], available = []) {
  const packages = new Map();
  for (const row of list(available)) if (row.name) packages.set(row.name, { ...row, installed: false });
  for (const row of list(installed)) if (row.name) packages.set(row.name, { ...packages.get(row.name), ...row, installed: true });
  return [...packages.values()].map((row) => {
    const groups = pluginContents(row);
    return {
      ...row,
      displayName: appDisplayName(row),
      description: text(row.description),
      category: titleFromSlug(row.category) || 'Other',
      authorName: text(row.author) || text(row.author?.name),
      isPack: groups.some((group) => group.key !== 'tools' && group.items.length),
      groups,
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function pluginContents(plugin = {}, assets = []) {
  return ASSET_GROUPS.map((group) => {
    const entries = list(plugin[group.key]);
    const owned = list(assets).filter((asset) => `${asset.asset_type}s` === group.key && !asset.deprecated_at);
    const items = entries.map((entry) => {
      const row = typeof entry === 'string' ? { slug: entry } : entry.payload || entry;
      const slug = row.slug || row.type || row.id || row.name;
      const linked = owned.find((asset) => asset.asset_slug === slug);
      return { id: linked?.local_id || row.id || slug, name: row.schema?.title || row.title || row.name || titleFromSlug(slug), description: row.schema?.description || row.description || '' };
    });
    for (const asset of owned) {
      if (!items.some((item) => item.id === asset.local_id)) items.push({ id: asset.local_id, name: titleFromSlug(asset.asset_slug), description: '' });
    }
    return { ...group, items, known: Array.isArray(plugin[group.key]) || owned.length > 0 };
  });
}

export function pluginConnections(plugin, catalogue = [], connected = [], health = []) {
  const connectedIds = new Set(list(connected).map((id) => String(id).toLowerCase()));
  return pluginProviders(plugin).map((id) => {
    const provider = list(catalogue).find((entry) => String(entry.id).toLowerCase() === id);
    const unhealthy = list(health).some((entry) => String(entry.provider).toLowerCase() === id && entry.status === 'error');
    return {
      providerId: id, name: provider?.name || titleFromSlug(id), icon: provider?.icon || 'connect',
      known: !!provider, status: !connectedIds.has(id) ? 'connect' : unhealthy ? 'reconnect' : 'connected',
      tools: list(plugin.tools).filter((tool) => String(tool.schema?.authProvider || tool.authProvider || '').toLowerCase() === id)
        .map((tool) => tool.schema?.title || tool.title || titleFromSlug(tool.type)).filter(Boolean),
    };
  });
}

/** SimpleModal accepts HTML; every remotely supplied value must be escaped first. */
export const escapeDisclosure = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
export function installDisclosure(report) {
  if (!report?.success) throw new Error(report?.error || 'Package inspection unavailable.');
  if (report.integrityState === 'mismatch') throw new Error('Package integrity mismatch. Installation is blocked.');
  if (report.valid === false) throw new Error(`Package validation failed: ${(report.validationErrors || []).join('; ')}`);
  const capabilities = Object.keys(report.detected || {});
  return [
    report.integrityState === 'verified' ? 'Package integrity verified.' : 'No verified marketplace fingerprint is available.',
    `Trust tier: ${escapeDisclosure(report.trustTier || 'unverified')}.`,
    capabilities.length ? `Detected access: ${capabilities.map(escapeDisclosure).join(', ')}.` : 'No sensitive capabilities detected by the package scan.',
    list(report.undeclared).length ? `Undeclared by publisher: ${report.undeclared.map(escapeDisclosure).join(', ')}.` : '',
    'Plugins run with full access to your device. Only install code from publishers you trust.',
  ].filter(Boolean).join('<br><br>');
}
