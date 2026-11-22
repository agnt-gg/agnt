/**
 * The Apps page in Studio sits between Studio's own panels, as every Studio
 * screen does: the left is a collection overview (CollectionStatsPanel), the
 * right starts with the one create button (PanelActionBar). Pure: the page's
 * summary in, what each panel shows out. Every row names the page action it
 * runs, so the panels act through the page and never duplicate its logic.
 */
import { SECTIONS } from './appsModel.js';

const SECTION_ICON = Object.freeze({ connections: 'fas fa-plug', plugins: 'fas fa-puzzle-piece', mcp: 'fas fa-server', triggers: 'fas fa-envelope' });

/** Each section's create button, and the other things you can start from it. */
const SECTION_ACTIONS = Object.freeze({
  connections: { create: ['add', 'Add connection'], more: [['check-all', 'Check every connection', 'Check']] },
  plugins: { create: ['browse', 'Browse Market'], more: [['build', 'Build a plugin', 'Open']] },
  mcp: { create: ['mcp-manage', 'Add MCP server'], more: [] },
  triggers: { create: ['workflows', 'Open workflows'], more: [] },
});

const fixLabel = (row) => (row.status === 'reconnect' ? 'Reconnect' : 'Connect');

/**
 * @param summary { section, counts: { connections, plugins, mcp, triggers }, needsYou, broken: [{ id, name, problem, status }] }
 * @returns {{ left: { title, icon, stats, lists }, right: { create: { action, label }, needs, more } }}
 */
export function studioPanels(summary = {}) {
  const section = SECTION_ACTIONS[summary.section] ? summary.section : 'connections';
  const counts = summary.counts || {};
  const broken = Array.isArray(summary.broken) ? summary.broken : [];
  const needsYou = Number(summary.needsYou) || 0;
  const left = {
    title: 'Plugins',
    icon: 'fas fa-plug',
    stats: [
      { label: 'Connections', value: counts.connections ?? 0 },
      { label: 'Need you', value: needsYou, ...(needsYou ? { tone: 'bad' } : {}) },
      { label: 'Plugins', value: counts.plugins ?? 0 },
      { label: 'MCP servers', value: counts.mcp ?? 0 },
    ],
    lists: [
      {
        title: 'Sections',
        items: SECTIONS.map((s) => ({ id: `section:${s.id}`, label: s.label, meta: String(counts[s.id] ?? 0), icon: SECTION_ICON[s.id], active: s.id === section })),
      },
    ],
  };
  const [action, label] = SECTION_ACTIONS[section].create;
  const right = {
    create: { action, label },
    needs: broken.map((row) => ({ id: row.id, name: row.name, problem: row.problem || 'It stopped working', cta: fixLabel(row) })),
    more: SECTION_ACTIONS[section].more.map(([id, name, cta]) => ({ id, name, cta })),
  };
  return { left, right };
}

/** A left-panel row id back to what it does: open a section, or fix a connection. */
export function panelRowTarget(id = '') {
  const [kind, ...rest] = String(id).split(':');
  const value = rest.join(':');
  if (kind === 'section' && SECTION_ACTIONS[value]) return { kind: 'section', section: value };
  if (kind === 'fix' && value) return { kind: 'fix', id: value };
  return null;
}
