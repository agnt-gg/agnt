import { settingsDirectory, appsDirectory } from '@/mobile/sectionDirectories.js';
// sections.spec.js — holds the canvas navigation registry (sections.js) to
// the OTHER hand-maintained screen lists it must agree with:
//
//   1. Terminal.vue's lazy-import map        (which component loads)
//   2. Terminal/screenRoute.js SCREEN_ROUTES (which URL the screen owns)
//   3. router/index.js terminalScreen metas  (deep links / back-forward)
//   4. tourTargets.js sidebar.* ids          (guided-tour targets)
//
// These five lists describe the same set of screens and drift silently:
// nothing crashes when they disagree — a screen just becomes unreachable
// from one surface, or a tour id points at nothing. Every assertion here
// exists because making a change like "move Workspaces from the sidebar to
// the chat toolbar" required manually auditing all five files.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAIN_SECTIONS, BOTTOM_SECTIONS, ALL_SECTIONS, SECTION_ROUTES, withGroupHeadings, visibleTabs } from './sections.js';
import { TOUR_TARGETS } from '@/views/_components/utility/tourTargets.js';
import { RAIL_BADGE_READERS } from './railBadges.js';
import { SCREEN_ROUTES } from '@/views/Terminal/screenRoute.js';
import { pluginRouteRecords } from '@/router/pluginRoutes.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const terminalSrc = read('../views/Terminal/Terminal.vue');
const routerSrc = read('../router/index.js');
const backendTargetsSrc = read('../../../backend/src/services/orchestrator/tutorialTargets.js');
const canvasSrc = read('./CanvasScreen.vue');
const settingsPanelSrc = read('../views/Terminal/LeftPanel/types/SettingsPanel/SettingsPanel.vue');
const connectorsPanelSrc = read('../views/Terminal/LeftPanel/types/ConnectorsPanel/ConnectorsPanel.vue');
const connectorsScreenSrc = read('../views/Terminal/CenterPanel/screens/Connectors/Connectors.vue');
const settingsScreenSrc = read('../views/Terminal/CenterPanel/screens/Settings/Settings.vue');

const sectionScreens = ALL_SECTIONS.flatMap((s) => s.screens.map((t) => t.screen));

// Terminal.vue component registrations. Most screens are lazy:
//   ['XScreen', () => import(...)]
// but the landing screen (ChatScreen) is EAGER by design — no chunk fetch on
// first paint — and registers as:
//   XScreen: markRaw(XScreen)
const lazyMapScreens = [...terminalSrc.matchAll(/\['(\w+Screen)',\s*\(\)\s*=>\s*import\(/g)].map((m) => m[1]);
const eagerScreens = [...terminalSrc.matchAll(/^\s*(\w+Screen):\s*markRaw\(/gm)].map((m) => m[1]);
const resolvableScreens = [...lazyMapScreens, ...eagerScreens];

// The screen → URL table changeScreen uses (imported, not regex-parsed: it
// moved out of Terminal.vue into a pure module).
const screenRouteScreens = Object.keys(SCREEN_ROUTES);

// router/index.js: meta: { ..., terminalScreen: 'XScreen' }
const routerScreens = [...routerSrc.matchAll(/terminalScreen:\s*'(\w+Screen)'/g)].map((m) => m[1]).concat(pluginRouteRecords(null).map(r => r.meta?.terminalScreen).filter(Boolean));

describe('canvas sections registry', () => {
  it('parsed the hand-maintained lists (guards against silent regex rot)', () => {
    // If a refactor changes the shape these regexes match, fail HERE with an
    // obvious message instead of vacuously passing the containment checks.
    expect(lazyMapScreens.length).toBeGreaterThanOrEqual(15);
    expect(screenRouteScreens.length).toBeGreaterThanOrEqual(15);
    expect(routerScreens.length).toBeGreaterThanOrEqual(15);
  });

  it('every section screen has a component registration in Terminal.vue', () => {
    const missing = sectionScreens.filter((s) => !resolvableScreens.includes(s));
    expect(missing).toEqual([]);
  });

  it('every section screen has a SCREEN_ROUTES entry', () => {
    const missing = sectionScreens.filter((s) => !screenRouteScreens.includes(s));
    expect(missing).toEqual([]);
  });

  it('every section screen has a router entry (deep links survive)', () => {
    const missing = sectionScreens.filter((s) => !routerScreens.includes(s));
    expect(missing).toEqual([]);
  });

  it('no section id collides between the main rail and its foot', () => {
    const mainIds = MAIN_SECTIONS.map((s) => s.id);
    const bottomIds = BOTTOM_SECTIONS.map((s) => s.id);
    expect(mainIds.filter((id) => bottomIds.includes(id))).toEqual([]);
  });

  it('sidebar tour targets and section ids agree bidirectionally', () => {
    // sidebar.* ids that are controls, not sections.
    const NON_SECTION_CONTROLS = new Set(['sidebar.add-page', 'sidebar.toggle']);
    const tourSidebarIds = TOUR_TARGETS.map((t) => t.id)
      .filter((id) => id.startsWith('sidebar.') && !NON_SECTION_CONTROLS.has(id))
      .map((id) => id.slice('sidebar.'.length));
    const sectionIds = ALL_SECTIONS.map((s) => s.id);

    // Every registered tour target points at a section that renders.
    expect(tourSidebarIds.filter((id) => !sectionIds.includes(id))).toEqual([]);
    // Every section is tour-able (frontend/backend tour mirrors stay honest).
    expect(sectionIds.filter((id) => !tourSidebarIds.includes(id))).toEqual([]);
  });

  it('SECTION_ROUTES is exactly the set of section screens (custom-page filter)', () => {
    expect([...SECTION_ROUTES].sort()).toEqual([...new Set(sectionScreens)].sort());
  });

  it('the backend tour-target mirror lists the same ids', () => {
    // Both files say "keep the two in sync" in a comment and nothing enforced
    // it, so renaming a sidebar section silently left the orchestrator
    // planning tours against ids the DOM no longer carries. Comparing ids (not
    // selectors) is the whole contract: the backend copy deliberately ships no
    // selectors.
    const backendIds = [...backendTargetsSrc.matchAll(/id:\s*'([\w.-]+)'/g)].map((m) => m[1]);
    expect(backendIds.length).toBeGreaterThanOrEqual(15);
    expect(backendIds.sort()).toEqual(TOUR_TARGETS.map((t) => t.id).sort());
  });

  it('no screen is owned by two sidebar rows', () => {
    // CanvasScreen resolves the lit row from the screen name alone, so a
    // second owner would silently light the first of them from both. CONNECT
    // used to be six rows sharing ConnectorsScreen, kept apart by a deep-link
    // mechanism; collapsing it to one row deleted that mechanism, and this is
    // what stops the next shared screen from arriving without it.
    const owners = new Map();
    for (const section of ALL_SECTIONS) {
      for (const tab of section.screens) {
        owners.set(tab.screen, [...(owners.get(tab.screen) || []), section.id]);
      }
    }
    expect([...owners.entries()].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });

  // ── Grouping ──
  // The rail emits a caption whenever `group` changes while walking the list,
  // so an ungrouped section would render under whichever caption happened to
  // precede it, and a group split across two runs would render twice.
  describe('sidebar grouping', () => {
    it('every section declares a group', () => {
      const ungrouped = ALL_SECTIONS.filter((s) => !s.group).map((s) => s.id);
      expect(ungrouped).toEqual([]);
    });

    it('sections of a group are contiguous (no caption renders twice)', () => {
      const order = MAIN_SECTIONS.map((s) => s.group);
      const runs = order.filter((g, i) => g !== order[i - 1]);
      expect(runs).toEqual([...new Set(runs)]);
    });

    it('withGroupHeadings captions exactly the first section of each group', () => {
      const rows = withGroupHeadings(MAIN_SECTIONS);
      expect(rows).toHaveLength(MAIN_SECTIONS.length);
      const captions = rows.filter((r) => r.caption).map((r) => r.caption);
      expect(captions).toEqual([...new Set(MAIN_SECTIONS.map((s) => s.group))]);
      // The very first row always opens a group.
      expect(rows[0].startsGroup).toBe(true);
    });

    it('renders the three main groups in order (work · plan · build)', () => {
      // Three plain words a business user already does with a team: talk and
      // get more (WORK) → see what is going on (PLAN) → the things that do
      // the work (BUILD). SYSTEM (Members, the gear) sits below them.
      expect([...new Set(MAIN_SECTIONS.map((s) => s.group))]).toEqual(['WORK', 'PLAN', 'BUILD']);
      // Same part of speech throughout: one noun each, no verbs, no "my".
      for (const caption of new Set(MAIN_SECTIONS.map((s) => s.group))) expect(caption).toMatch(/^[A-Z]+$/);
    });

    it('the rail reads as twelve plain nouns, in order', () => {
      // The whole point of the grouping: cover the captions, read the rows
      // aloud, and a first-time user can say what each one holds. No verbs,
      // no engineering words (runs, traces, artifacts, library, plugins,
      // workspaces, connectors).
      expect(MAIN_SECTIONS.map((s) => s.label)).toEqual([
        'Chat', 'Market',
        'Dashboard', 'Goals', 'Activity', 'Files',
        'Plugins', 'Agents', 'Workflows', 'Tools', 'Skills', 'Widgets',
      ]);
      expect(MAIN_SECTIONS.map((s) => s.id)).toEqual([
        'chat', 'store',
        'dashboard', 'goals', 'traces', 'artifacts',
        'apps', 'agents', 'workflows', 'tools', 'skills', 'widgets',
      ]);
      for (const label of MAIN_SECTIONS.map((s) => s.label)) expect(label).not.toMatch(/connector|workspace|library/i);
    });

    it('no group is a single row (a caption over one item is noise)', () => {
      const counts = MAIN_SECTIONS.reduce((acc, s) => ({ ...acc, [s.group]: (acc[s.group] || 0) + 1 }), {});
      expect(Object.entries(counts).filter(([, n]) => n < 2)).toEqual([]);
    });
  });

  // ── Regression locks for the plain-English rail (2026-09-03) ──
  it('Canvas is a Chat toolbar tab, not a sidebar row', () => {
    // A canvas is a chat with a custom layout around it — closer to a
    // conversation than to anything else on the rail. "Workspace" now means
    // only a shared cloud instance, so the tab is not called that.
    const chat = MAIN_SECTIONS.find((s) => s.id === 'chat');
    expect(chat.group).toBe('WORK');
    expect(visibleTabs(chat, 'ChatScreen').map((t) => t.label)).toEqual(['CHAT', 'CANVAS']);
    expect(MAIN_SECTIONS.some((s) => s.id === 'workspaces')).toBe(false);
  });

  it('Files (ArtifactsScreen) is a PLAN row beside Activity, not a Chat tab', () => {
    // Runs, goals, agents and chats all produce files; only one of those is
    // a conversation, so a Chat tab was the wrong owner. The Chat inspector
    // keeps the provenance link (its Artifacts section ⇧-clicks here).
    const outputs = MAIN_SECTIONS.find((s) => s.id === 'artifacts');
    expect(outputs?.group).toBe('PLAN');
    expect(outputs.label).toBe('Files');
    expect(outputs.screens).toEqual([{ screen: 'ArtifactsScreen', label: 'FILES' }]);
    const chat = MAIN_SECTIONS.find((s) => s.id === 'chat');
    expect(chat.screens.some((t) => t.screen === 'ArtifactsScreen')).toBe(false);
  });

  it('BUILD is Apps first, then one row per kind of thing that does the work', () => {
    // An app is the box the rest arrive in (a plugin and its sign-in are one
    // app), so it leads. Then: an agent decides for itself; a workflow runs
    // the same steps every time; tools are what both call; skills are what
    // agents know; widgets show things. None may be a tab of another.
    const build = MAIN_SECTIONS.filter((s) => s.group === 'BUILD');
    expect(build.map((s) => s.id)).toEqual(['apps', 'agents', 'workflows', 'tools', 'skills', 'widgets']);
  });

  it('Agents owns Memory as a tab; Skills is its own row; Approvals is not here', () => {
    // Memory is a property of an agent and of nothing else. Skills are shared
    // between agents and shipped by apps, so they are a row. Approvals is a
    // rule you set once, so it lives behind Settings.
    const agents = MAIN_SECTIONS.find((s) => s.id === 'agents');
    expect(agents.screens[0].screen).toBe('AgentsScreen');
    // No AGENT FORGE: a new agent is a modal on the Agents page itself.
    expect(visibleTabs(agents, 'AgentsScreen').map((t) => t.label)).toEqual(['AGENTS', 'MEMORY']);
    expect(MAIN_SECTIONS.find((s) => s.id === 'skills').screens).toEqual([{ screen: 'SkillsScreen', label: 'SKILLS' }]);
    expect(agents.screens.some((t) => t.screen === 'AgentForgeScreen')).toBe(false);
    expect(agents.screens.some((t) => t.screen === 'LearningScreen')).toBe(false);
  });

  it('Workflows, Tools and Widgets are each a row paired with their forge', () => {
    const strip = (id, screen) => visibleTabs(MAIN_SECTIONS.find((s) => s.id === id), screen).map((t) => t.label);
    expect(strip('workflows', 'WorkflowsScreen')).toEqual(['WORKFLOWS', 'WORKFLOW FORGE']);
    expect(strip('workflows', 'WorkflowForgeScreen')).toEqual(['WORKFLOWS', 'WORKFLOW FORGE']);
    // A tool does something; a widget shows something. Not one row.
    expect(strip('tools', 'ToolsScreen')).toEqual(['TOOLS', 'TOOL FORGE']);
    expect(strip('tools', 'ToolForgeScreen')).toEqual(['TOOLS', 'TOOL FORGE']);
    expect(strip('widgets', 'WidgetManagerScreen')).toEqual(['WIDGETS', 'WIDGET FORGE']);
    expect(strip('widgets', 'WidgetForgeScreen')).toEqual(['WIDGETS', 'WIDGET FORGE']);
    for (const id of ['automations', 'library', 'marketplace', 'connect', 'connectors', 'plugins']) {
      expect(MAIN_SECTIONS.some((s) => s.id === id)).toBe(false);
    }
  });

  it('every forge is a permanent tab, directly after the page it builds for', () => {
    const forges = ALL_SECTIONS.flatMap((s) => s.screens).filter((t) => /ForgeScreen$/.test(t.screen));
    expect(forges.length).toBeGreaterThanOrEqual(3);

    // Not contextual and not hidden: a builder you cannot see is a builder
    // nobody finds.
    expect(forges.filter((t) => t.ctx === true).map((t) => t.screen)).toEqual([]);
    expect(forges.filter((t) => t.tab === false).map((t) => t.screen)).toEqual([]);

    // Adjacency is the whole point of the pairing, so it is pinned rather than
    // left to the order someone happens to type the array in.
    const pairs = {
      WorkflowForgeScreen: 'WorkflowsScreen',
      ToolForgeScreen: 'ToolsScreen',
      WidgetForgeScreen: 'WidgetManagerScreen',
    };
    for (const [forge, page] of Object.entries(pairs)) {
      const section = ALL_SECTIONS.find((s) => s.screens.some((t) => t.screen === forge));
      const strip = visibleTabs(section, page).map((t) => t.screen);
      expect(strip.indexOf(forge), `${forge} follows ${page}`).toBe(strip.indexOf(page) + 1);
    }
  });

  it('visibleTabs honours tab:false and the ctx:true mechanism, and the toolbar uses it', () => {
    // ctx:true still works — nothing uses it today, and the filter that
    // implements it must not rot in the meantime.
    const ctxOnly = { screens: [{ screen: 'AScreen', label: 'A' }, { screen: 'BScreen', label: 'B', ctx: true }] };
    expect(visibleTabs(ctxOnly, 'AScreen').map((t) => t.label)).toEqual(['A']);
    expect(visibleTabs(ctxOnly, 'BScreen').map((t) => t.label)).toEqual(['A', 'B']);

    const settings = BOTTOM_SECTIONS.find((s) => s.id === 'settings');
    expect(visibleTabs(settings, 'LearningScreen').map((t) => t.label)).toEqual(['SETTINGS']);
    expect(visibleTabs(null, 'ChatScreen')).toEqual([]);
    // The toolbar must derive its strip from the same function the test does.
    expect(canvasSrc).toMatch(/activeSectionTabs[\s\S]{0,220}?visibleTabs\(/);
  });

  it('every rail badge names a reader, and the canvas draws them', () => {
    // A `badge` key with no reader is decoration; a reader with no key is
    // dead code. railBadges.js declares the readers keyed by the same ids.
    const badged = ALL_SECTIONS.filter((s) => s.badge).map((s) => s.badge);
    expect(badged.length).toBeGreaterThanOrEqual(3);
    for (const key of badged) expect(typeof RAIL_BADGE_READERS[key]).toBe('function');
    for (const key of Object.keys(RAIL_BADGE_READERS)) expect(badged).toContain(key);
    expect(canvasSrc).toMatch(/railBadges\[item\.id\]/);
  });

  it('SYSTEM screens are reachable but absent from the main rail', () => {
    // Approvals (Autonomy) and Improvements (Evolution) are navigated from
    // SettingsPanel. They must stay inside SECTION_ROUTES (or the canvas
    // treats them as custom pages and the gear goes dark while you are on
    // them) while owning no row of their own in MAIN_SECTIONS. Memory used to
    // be here too; it is a tab of the Agents row now.
    const systemScreens = ['LearningScreen'];
    const mainScreens = MAIN_SECTIONS.flatMap((s) => s.screens.map((t) => t.screen));
    for (const screen of systemScreens) {
      expect(SECTION_ROUTES.has(screen)).toBe(true);
      expect(mainScreens).not.toContain(screen);
    }
    const settings = BOTTOM_SECTIONS.find((s) => s.id === 'settings');
    // The sidebar row lands on the first screen — must stay SettingsScreen.
    expect(settings.screens[0].screen).toBe('SettingsScreen');
  });

  // ── SYSTEM sub-nav ──
  // SettingsPanel is the ONLY way to reach these screens now that they have no
  // sidebar row, so a screen listed as a SYSTEM tab with no matching nav row
  // is unreachable, and a nav row naming a screen that is not a SYSTEM tab
  // navigates somewhere the gear does not stay lit for. Neither crashes.
  describe('SYSTEM sub-nav (SettingsPanel)', () => {
    const navScreens = settingsDirectory.flatMap(g => g.items).filter(i => i.screen).map(i => i.screen);
    // Scoped to the Settings row specifically — Connect sits beside it at the
    // foot of the rail but is navigated from the rail, not from this panel.
    const systemTabs = BOTTOM_SECTIONS.find((s) => s.id === 'settings').screens.map((t) => t.screen);

    it('lists exactly the SYSTEM screens that are not SettingsScreen itself', () => {
      expect(navScreens.sort()).toEqual(systemTabs.filter((s) => s !== 'SettingsScreen').sort());
    });

    it('those screens are routed but kept out of the toolbar', () => {
      // Two halves of one invariant, and dropping either breaks something
      // silently: remove them from `screens` and the canvas reads them as
      // custom pages (gear goes dark, wrong left panel); leave them tabbable
      // and the toolbar repeats the panel that navigates them.
      const settings = BOTTOM_SECTIONS.find((s) => s.id === 'settings');
      expect(settings.screens.filter((t) => t.tab !== false).map((t) => t.screen)).toEqual(['SettingsScreen']);
      for (const screen of ['LearningScreen']) expect(SECTION_ROUTES.has(screen)).toBe(true);
    });

    it('the toolbar actually honours tab:false, and names the screen instead', () => {
      // A registry flag nothing reads is decoration. The second half matters
      // too: without it the strip renders with nothing selected, which reads
      // as a bug rather than as a deliberate absence.
      expect(canvasSrc).toMatch(/activeSectionTabs[\s\S]{0,220}?visibleTabs\(/);
      expect(canvasSrc).toMatch(/untabbedScreenLabel/);
      expect(canvasSrc).toMatch(/v-else-if="untabbedScreenLabel"/);
    });

    it('every nav row that is a Settings SECTION has a matching v-if branch', () => {
      // A row whose id no longer matches any `activeSection === '…'` branch
      // renders a blank page rather than erroring.
      const sectionIds = settingsDirectory.flatMap(g => g.items).filter(i => !i.screen).map(i => i.id);
      const branches = new Set([...settingsScreenSrc.matchAll(/activeSection === '([\w-]+)'/g)].map((m) => m[1]));
      expect(sectionIds.length).toBeGreaterThanOrEqual(9);
      expect(sectionIds.filter((id) => !branches.has(id))).toEqual([]);
    });

    it('AI Models lives in Settings only, with all three cards', () => {
      // It was briefly reduced to ProviderSelector alone while moving screens
      // between surfaces. Fallback and chat behaviour are the other two thirds
      // of that page and vanish silently, because a missing card looks like a
      // page that simply has less on it.
      const providerBlock = settingsScreenSrc.split("activeSection === 'providers'")[1]?.split('activeSection ===')[0] ?? '';
      for (const card of ['<ProviderSelector />', '<FallbackProviders />', '<ChatBehaviorSettings />']) {
        expect(providerBlock, `Settings → ${card}`).toContain(card);
      }
      expect(settingsDirectory[0].items.find((i) => i.id === 'providers').label).toBe('AI Models');
      // AI models are not apps: the Apps screen draws no model page, and every
      // old way in (?section=providers) is sent on to Settings.
      expect(connectorsScreenSrc).not.toMatch(/activeSection === 'providers'/);
      expect(connectorsScreenSrc).toMatch(/next === 'providers'[\s\S]{0,120}openAiModels\(\)/);
      expect(connectorsScreenSrc).toMatch(/emit\('screen-change', 'SettingsScreen', \{ section: 'providers' \}\)/);
      expect(canvasSrc).toMatch(/function goProviders\(\)[\s\S]{0,120}'SettingsScreen', \{ section: 'providers' \}/);
    });
  });

  it('Plugins leads BUILD (PLUGINS | PLUGIN FORGE tabs); Market is WORK; Settings is the foot alone', () => {
    // A plugin and the sign-in it needs are ONE app, so connecting and
    // installing are one row. Plugin Forge sits beside Plugins in the toolbar,
    // the same way Tool Forge sits beside Tools.
    const apps = MAIN_SECTIONS.find((s) => s.id === 'apps');
    expect(apps.group).toBe('BUILD');
    expect(MAIN_SECTIONS.filter((s) => s.group === 'BUILD')[0].id).toBe('apps');
    expect(visibleTabs(apps, 'ConnectorsScreen').map((t) => t.label)).toEqual(['PLUGINS', 'PLUGIN FORGE']);
    expect(visibleTabs(apps, 'PluginsScreen').map((t) => t.label)).toEqual(['PLUGINS', 'PLUGIN FORGE']);
    expect(apps.screens.map((t) => t.screen)).toEqual(['ConnectorsScreen', 'PluginsScreen']);
    const market = MAIN_SECTIONS.find((s) => s.id === 'store');
    expect(market.group).toBe('WORK');
    expect(market.screens).toEqual([{ screen: 'MarketplaceScreen', label: 'MARKET' }]);
    expect(BOTTOM_SECTIONS.map((s) => s.id)).toEqual(['settings']);
    // The attention badge rides the Apps row, and the canvas paints it as a warning there.
    expect(apps.badge).toBe('connect');
    expect(canvasSrc).toMatch(/'is-warn': item\.id === 'apps'/);
  });

  // Email and Webhooks are headline features: they were buried under an
  // "Advanced" caption. There is no Advanced group on Apps; Advanced is a
  // Settings group (navigation, remote access, backup, reset).
  it('the Plugins nav is one list: Plugins, then Email and Webhooks; Plugin Forge is not a row', () => {
    expect(ALL_SECTIONS.filter((s) => s.screens.some((t) => t.screen === 'PluginsScreen')).map((s) => s.id)).toEqual(['apps']);

    expect(appsDirectory.map((g) => g.label)).toEqual(['Plugins']);
    const [main] = appsDirectory;
    // Plugins is the default view (one card per thing you connect).
    expect(main.items.map((i) => i.id)).toEqual(['apps', 'email-server', 'webhooks', 'mcp-servers', 'oauth']);
    expect(main.items[0].label).toBe('Plugins');
    expect(main.items.some((i) => i.screen === 'PluginsScreen' || /forge/i.test(i.label))).toBe(false);
    expect(appsDirectory.flatMap((g) => g.items).map((i) => i.label).join(' ')).not.toMatch(/advanced/i);
    expect(connectorsScreenSrc).toMatch(/const activeSection = ref\('apps'\)/);
    expect(connectorsScreenSrc).not.toMatch(/activeSection === 'plugins'/);

    // Models are not a row of the Apps nav, and no screen of its own.
    const items = appsDirectory.flatMap((g) => g.items);
    expect(items.some((i) => i.id === 'providers')).toBe(false);
    expect(MAIN_SECTIONS.some((s) => s.screens.some((t) => t.screen === 'ProvidersScreen'))).toBe(false);
    for (const item of items) expect(item.label).not.toMatch(/app|connector/i);
  });

  it('every view the Connect panel lists has a branch on the Connect screen', () => {
    // The panel is the only way to reach these views, so a row naming a view
    // the screen cannot render shows a blank page rather than erroring.
    // Rows that open their own screen (item.screen) are not Connectors views.
    const connectNavIds = appsDirectory.flatMap(g => g.items).filter(i => !i.screen).map(i => i.id);
    const branches = new Set([...connectorsScreenSrc.matchAll(/activeSection === '([\w-]+)'/g)].map((m) => m[1]));
    expect(connectNavIds.filter((id) => !branches.has(id))).toEqual([]);
  });

  it('no section declares a deep-link inner section', () => {
    // The `section` field went with the six CONNECT rows. Leaving one behind
    // would be inert: nothing reads it any more.
    expect(ALL_SECTIONS.filter((s) => s.section).map((s) => s.id)).toEqual([]);
  });
});
