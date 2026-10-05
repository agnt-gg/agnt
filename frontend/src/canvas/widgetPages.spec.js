/**
 * AGNT's own pages are not widgets.
 *
 * Reported: Studio's Widgets list and the canvas picker showed the default
 * pages (Chat, Dashboard, Agents…) as widgets. They are registered so the
 * Workspace can open them as windows; nothing else may list them, and the
 * Workspace lists them under Pages, not Widgets.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllWidgets, getWidgetsOnly, isAppPage } from './widgetRegistry.js';
import { registerAllWidgets } from './widgets/index.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

beforeAll(() => registerAllWidgets());

describe('pages vs widgets', () => {
  it('the built-in pages are pages, the dashboard cards are widgets', () => {
    const byId = Object.fromEntries(getAllWidgets().map((w) => [w.id, w]));
    for (const id of ['chat', 'dashboard', 'agents', 'workflow-forge', 'settings']) {
      expect(byId[id], `${id} is registered`).toBeTruthy();
      expect(isAppPage(byId[id]), id).toBe(true);
    }
    for (const id of ['goals-map', 'agents-swarm', 'runs-queue']) expect(isAppPage(byId[id]), id).toBe(false);
  });

  it('getWidgetsOnly never returns a page, and loses no widget', () => {
    const widgets = getWidgetsOnly();
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets.some(isAppPage)).toBe(false);
    expect(widgets.length + getAllWidgets().filter(isAppPage).length).toBe(getAllWidgets().length);
  });

  it.each([
    ['the Widgets screen', 'views/Terminal/CenterPanel/screens/WidgetManager/WidgetManager.vue'],
    ['its sidebar', 'views/Terminal/LeftPanel/types/WidgetManagerPanel/WidgetManagerPanel.vue'],
    ['the canvas widget picker', 'canvas/WidgetCatalog.vue'],
  ])('%s lists widgets only', (_, file) => {
    const src = read(file);
    expect(src).toMatch(/getWidgetsOnly\(\)/);
    expect(src).not.toMatch(/getAllWidgets\(\)/);
  });

  it('the Workspace lists pages under their own heading, not as Widgets', () => {
    const src = read('views/Terminal/CenterPanel/screens/Workspace/Workspace.vue');
    expect(src).toMatch(/\{ label: 'Widgets', items: widgets \}/);
    expect(src).toMatch(/\{ label: 'Pages', items: pages \}/);
    expect(src).toMatch(/page: isAppPage\(w\)/);
  });
});
