/** Canonical plugin URLs. Internal screen/storage IDs stay stable for saved settings. */
export function canonicalPluginQuery(query = {}) {
  const normalized = { ...query };
  const selection = Array.isArray(query.select) ? query.select[0] : query.select;
  if (typeof selection === 'string' && selection.startsWith('app:')) {
    normalized.select = `plugin:${selection.slice(4)}`;
  }
  return normalized;
}

export function pluginRouteRecords(component) {
  return [
    {
      path: '/plugins', name: 'TerminalPlugins', component,
      meta: { requiresAuth: true, terminalScreen: 'ConnectorsScreen' },
    },
    {
      path: '/plugin-forge', name: 'TerminalPluginForge', component,
      meta: { requiresAuth: true, terminalScreen: 'PluginsScreen' },
    },
    ...['/apps', '/connectors'].map((path) => ({
      path,
      ...(path === '/connectors' ? { name: 'TerminalConnectors' } : {}),
      redirect: (to) => ({ path: '/plugins', query: canonicalPluginQuery(to.query), hash: to.hash }),
    })),
  ];
}
