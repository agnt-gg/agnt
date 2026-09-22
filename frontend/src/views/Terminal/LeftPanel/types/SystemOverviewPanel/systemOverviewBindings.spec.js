// The dashboard's left panel reads its numbers out of Vuex by string key.
// A typo or a renamed module does not throw — the getter is simply undefined,
// the tile falls back to zero, and the panel confidently reports an empty
// account. That is exactly how `conversations/`, `widgets/`, `plugins/` and
// `artifacts/` came to render 0 forever: none of those namespaces exist.
//
// So every key the panel names is checked against the real module here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import agents from '@/store/features/agents.js';
import appAuth from '@/store/auth/appAuth.js';
import contentOutputs from '@/store/features/contentOutputs.js';
import executionHistory from '@/store/user/executionHistory.js';
import goals from '@/store/features/goals.js';
import insights from '@/store/features/insights.js';
import schedules from '@/store/features/schedules.js';
import skills from '@/store/features/skills.js';
import tools from '@/store/features/tools.js';
import widgetDefinitions from '@/store/features/widgetDefinitions.js';
import workflows from '@/store/features/workflows.js';

const MODULES = {
  agents,
  appAuth,
  contentOutputs,
  executionHistory,
  goals,
  insights,
  schedules,
  skills,
  tools,
  widgetDefinitions,
  workflows,
};

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'SystemOverviewPanel.vue'), 'utf8');

const matchAll = (pattern) => [...source.matchAll(pattern)].map((m) => m[1]);

describe('SystemOverviewPanel store bindings', () => {
  const getterKeys = [...new Set(matchAll(/g\('([\w-]+\/[\w-]+)'/g))];
  const actionKeys = [...new Set(matchAll(/'([\w-]+\/fetch[\w-]+)'/g))];

  it('names getters the panel can actually read', () => {
    expect(getterKeys.length).toBeGreaterThan(8);
  });

  it.each(getterKeys)('getter %s exists', (key) => {
    const [namespace, getter] = key.split('/');
    expect(MODULES, `unknown store namespace "${namespace}"`).toHaveProperty(namespace);
    expect(Object.keys(MODULES[namespace].getters || {})).toContain(getter);
  });

  it.each(actionKeys)('hydration action %s exists', (key) => {
    const [namespace, action] = key.split('/');
    expect(MODULES, `unknown store namespace "${namespace}"`).toHaveProperty(namespace);
    expect(Object.keys(MODULES[namespace].actions || {})).toContain(action);
  });

  it('hydrates every module it reads a count from', () => {
    // Landing on the dashboard first must not render an empty account, so any
    // namespace the inventory reads has to be in the hydration list. appAuth
    // is exempt: connection health is polled by the app shell, not per screen.
    const read = new Set(getterKeys.map((k) => k.split('/')[0]).filter((ns) => ns !== 'appAuth'));
    const hydrated = new Set(actionKeys.map((k) => k.split('/')[0]));
    expect([...read].filter((ns) => !hydrated.has(ns))).toEqual([]);
  });

  it('asks the outputs endpoint for one row, not the whole corpus', () => {
    // GET /content-outputs returns COUNT(*) OVER() as totalCount on every
    // query, so a single row carries the real total. loadAll must stay false
    // or hasLoadedAll gets set and the chat sidebar skips its own full load.
    expect(source).toMatch(/limit: 1, offset: 0, loadAll: false, force: true/);
  });

  it('counts plugins from the plugins endpoint, not from plugin tools', () => {
    // tools/installedPlugins groups plugin TOOLS by plugin_name, so a plugin
    // shipping only agents/workflows/skills/widgets would count as zero.
    expect(source).toMatch(/\/plugins\/installed/);
    expect(source).not.toMatch(/tools\/installedPlugins/);
  });

  it('never renders an unproven zero as a real count', () => {
    expect(source).toMatch(/hydrating\.value && isEmpty\(value\)/);
  });
});
