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
import { MAIN_SECTIONS, SETTINGS_SECTIONS, ALL_SECTIONS, SECTION_ROUTES, withGroupHeadings } from './sections.js';
import { TOUR_TARGETS } from '@/views/_components/utility/tourTargets.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const terminalSrc = read('../views/Terminal/Terminal.vue');
const routerSrc = read('../router/index.js');
const backendTargetsSrc = read('../../../backend/src/services/orchestrator/tutorialTargets.js');

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

  it('no section id collides between main and settings', () => {
    const mainIds = MAIN_SECTIONS.map((s) => s.id);
    const settingsIds = SETTINGS_SECTIONS.map((s) => s.id);
    expect(mainIds.filter((id) => settingsIds.includes(id))).toEqual([]);
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

  // ── Shared screens ──
  // A screen may have several sidebar rows (CONNECT: six rows, one
  // ConnectorsScreen) ONLY if each row deep-links to a different inner view.
  // Without that, CanvasScreen cannot tell which row to highlight and would
  // silently light the first one for all six.
  describe('shared screens', () => {
    const ownersByScreen = new Map();
    for (const section of ALL_SECTIONS) {
      for (const tab of section.screens) {
        if (!ownersByScreen.has(tab.screen)) ownersByScreen.set(tab.screen, []);
        ownersByScreen.get(tab.screen).push(section);
      }
    }
    const shared = [...ownersByScreen.entries()].filter(([, owners]) => owners.length > 1);

    it('every section that shares a screen declares an inner section', () => {
      const undeclared = shared.flatMap(([screen, owners]) =>
        owners.filter((o) => !o.section).map((o) => `${o.id} -> ${screen}`),
      );
      expect(undeclared).toEqual([]);
    });

    it('sections sharing a screen point at DIFFERENT inner sections', () => {
      const collisions = shared.flatMap(([screen, owners]) => {
        const seen = new Set();
        return owners.filter((o) => (seen.has(o.section) ? true : (seen.add(o.section), false))).map((o) => `${screen}#${o.section}`);
      });
      expect(collisions).toEqual([]);
    });

    it('a section that declares an inner section owns exactly one screen', () => {
      // Otherwise the inner section would be ambiguous across that row's tabs.
      const bad = ALL_SECTIONS.filter((s) => s.section && s.screens.length !== 1).map((s) => s.id);
      expect(bad).toEqual([]);
    });
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

    it('renders the four intended main groups in order', () => {
      expect([...new Set(MAIN_SECTIONS.map((s) => s.group))]).toEqual(['HOME', 'PLAN', 'BUILD', 'CONNECT']);
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
    expect(workspaces.group).toBe('HOME');
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
    const settings = SETTINGS_SECTIONS.find((s) => s.id === 'settings');
    // The sidebar row lands on the first screen — must stay SettingsScreen.
    expect(settings.screens[0].screen).toBe('SettingsScreen');
  });

  it('every CONNECT row opens a distinct view of ConnectorsScreen', () => {
    const connect = MAIN_SECTIONS.filter((s) => s.group === 'CONNECT');
    expect(connect).toHaveLength(6);
    expect(connect.every((s) => s.screens[0].screen === 'ConnectorsScreen')).toBe(true);
    expect(connect.map((s) => s.section).sort()).toEqual(
      ['api-keys', 'email-server', 'mcp-servers', 'oauth', 'plugins', 'webhooks'].sort(),
    );
  });
});
