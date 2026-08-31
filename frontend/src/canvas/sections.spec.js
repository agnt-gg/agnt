// sections.spec.js — holds the canvas navigation registry (sections.js) to
// the OTHER hand-maintained screen lists it must agree with:
//
//   1. Terminal.vue's lazy-import map        (which component loads)
//   2. Terminal.vue's screenRoutes           (which URL the screen owns)
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
import { MAIN_SECTIONS, BOTTOM_SECTIONS, ALL_SECTIONS, SECTION_ROUTES, withGroupHeadings } from './sections.js';
import { TOUR_TARGETS } from '@/views/_components/utility/tourTargets.js';

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

// Terminal.vue screenRoutes entries: XScreen: '/route',
const screenRouteScreens = [...terminalSrc.matchAll(/^\s*(\w+Screen):\s*'\/[^']*',?\s*$/gm)].map((m) => m[1]);

// router/index.js: meta: { ..., terminalScreen: 'XScreen' }
const routerScreens = [...routerSrc.matchAll(/terminalScreen:\s*'(\w+Screen)'/g)].map((m) => m[1]);

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

  it('every section screen has a screenRoutes entry in Terminal.vue', () => {
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
    expect(backendIds.length).toBeGreaterThanOrEqual(20);
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

    it('renders the three intended main groups in order', () => {
      expect([...new Set(MAIN_SECTIONS.map((s) => s.group))]).toEqual(['WORK', 'PLAN', 'BUILD']);
    });

    it('no group is a single row (a caption over one item is noise)', () => {
      const counts = MAIN_SECTIONS.reduce((acc, s) => ({ ...acc, [s.group]: (acc[s.group] || 0) + 1 }), {});
      expect(Object.entries(counts).filter(([, n]) => n < 2)).toEqual([]);
    });
  });

  // ── Regression locks for the sidebar-categories re-parent (2026-08-31) ──
  it('Workspaces is its own sidebar row, not a Chat toolbar tab', () => {
    const chat = MAIN_SECTIONS.find((s) => s.id === 'chat');
    expect(chat.screens.map((t) => t.screen)).toEqual(['ChatScreen']);
    const workspaces = MAIN_SECTIONS.find((s) => s.id === 'workspaces');
    expect(workspaces.screens.map((t) => t.screen)).toEqual(['WorkspaceScreen']);
    expect(workspaces.group).toBe('WORK');
  });

  it('SYSTEM screens are reachable but absent from the main rail', () => {
    // Memory / Evolution / Autonomy are navigated from SettingsPanel. They
    // must stay inside SECTION_ROUTES (or the canvas treats them as custom
    // pages and the gear goes dark while you are on them) while owning no row
    // of their own in MAIN_SECTIONS.
    const systemScreens = ['MemoryScreen', 'ExperimentsScreen', 'AutonomyScreen'];
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
    const navScreens = [...settingsPanelSrc.matchAll(/screen:\s*'(\w+Screen)'/g)].map((m) => m[1]);
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
      for (const screen of ['MemoryScreen', 'ExperimentsScreen', 'AutonomyScreen']) {
        expect(SECTION_ROUTES.has(screen)).toBe(true);
      }
    });

    it('the toolbar actually honours tab:false, and names the screen instead', () => {
      // A registry flag nothing reads is decoration. The second half matters
      // too: without it the strip renders with nothing selected, which reads
      // as a bug rather than as a deliberate absence.
      expect(canvasSrc).toMatch(/activeSectionTabs[\s\S]{0,220}?filter\(\(t\) => t\.tab !== false\)/);
      expect(canvasSrc).toMatch(/untabbedScreenLabel/);
      expect(canvasSrc).toMatch(/v-else-if="untabbedScreenLabel"/);
    });

    it('every nav row that is a Settings SECTION has a matching v-if branch', () => {
      // A row whose id no longer matches any `activeSection === '…'` branch
      // renders a blank page rather than erroring.
      const sectionIds = [...settingsPanelSrc.matchAll(/\{\s*id:\s*'([\w-]+)',[^}]*\}/g)]
        .map((m) => m[0])
        .filter((entry) => !/screen:/.test(entry))
        .map((entry) => entry.match(/id:\s*'([\w-]+)'/)[1]);
      const branches = new Set([...settingsScreenSrc.matchAll(/activeSection === '([\w-]+)'/g)].map((m) => m[1]));
      expect(sectionIds.length).toBeGreaterThanOrEqual(9);
      expect(sectionIds.filter((id) => !branches.has(id))).toEqual([]);
    });

    it('the AI Provider page still renders all three cards', () => {
      // It was briefly reduced to ProviderSelector alone while moving screens
      // between surfaces. Fallback and chat behaviour are the other two thirds
      // of that page and vanished silently, because a missing card looks like
      // a page that simply has less on it.
      const providerBlock = settingsScreenSrc.split("activeSection === 'providers'")[1]?.split('activeSection ===')[0] ?? '';
      for (const card of ['<ProviderSelector />', '<FallbackProviders />', '<ChatBehaviorSettings />']) {
        expect(providerBlock).toContain(card);
      }
    });
  });

  it('Connect is a single row at the foot of the rail, directly above Settings', () => {
    // It was six rows — API/OAuth, Emails, MCP, Plugins, Vault, Webhooks — each
    // deep-linking into a view that ConnectorsScreen's own left panel already
    // lists. The rail spent its longest group restating a menu the destination
    // draws anyway.
    expect(MAIN_SECTIONS.some((s) => s.screens.some((t) => t.screen === 'ConnectorsScreen'))).toBe(false);
    expect(BOTTOM_SECTIONS.map((s) => s.id)).toEqual(['connect', 'settings']);

    const connect = BOTTOM_SECTIONS[0];
    expect(connect.label).toBe('Connectors');
    expect(connect.screens.map((t) => t.screen)).toEqual(['ConnectorsScreen']);
  });

  it('Plugins is a BUILD row of its own, and Connect no longer offers it', () => {
    // A plugin is an installable asset — the same kind of thing as an agent or
    // a tool — not something AGNT reaches out to. Both ends are pinned because
    // either half alone fails quietly: left in the Connect nav it would be a
    // second door to a screen that moved, and left rendering inside
    // Connectors it would be an unreachable branch.
    const plugins = MAIN_SECTIONS.find((s) => s.id === 'plugins');
    expect(plugins?.group).toBe('BUILD');
    expect(plugins?.screens.map((t) => t.screen)).toEqual(['PluginsScreen']);

    const connectNavIds = [...connectorsPanelSrc.matchAll(/\{\s*id:\s*'([\w-]+)'/g)].map((m) => m[1]);
    expect(connectNavIds.length).toBeGreaterThanOrEqual(4);
    expect(connectNavIds).not.toContain('plugins');
    expect(connectorsScreenSrc).not.toMatch(/activeSection === 'plugins'/);
  });

  it('every view the Connect panel lists has a branch on the Connect screen', () => {
    // The panel is the only way to reach these views, so a row naming a view
    // the screen cannot render shows a blank page rather than erroring.
    const connectNavIds = [...connectorsPanelSrc.matchAll(/\{\s*id:\s*'([\w-]+)'/g)].map((m) => m[1]);
    const branches = new Set([...connectorsScreenSrc.matchAll(/activeSection === '([\w-]+)'/g)].map((m) => m[1]));
    expect(connectNavIds.filter((id) => !branches.has(id))).toEqual([]);
  });

  it('no section declares a deep-link inner section', () => {
    // The `section` field went with the six CONNECT rows. Leaving one behind
    // would be inert: nothing reads it any more.
    expect(ALL_SECTIONS.filter((s) => s.section).map((s) => s.id)).toEqual([]);
  });
});
