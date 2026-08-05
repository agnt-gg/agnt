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
import { MAIN_SECTIONS, SETTINGS_SECTIONS, ALL_SECTIONS, SECTION_ROUTES } from './sections.js';
import { TOUR_TARGETS } from '@/views/_components/utility/tourTargets.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const terminalSrc = read('../views/Terminal/Terminal.vue');
const routerSrc = read('../router/index.js');

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

  it('no screen belongs to two sections', () => {
    const seen = new Set();
    const dupes = sectionScreens.filter((s) => (seen.has(s) ? true : (seen.add(s), false)));
    expect(dupes).toEqual([]);
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

  // ── Regression locks for the Workspaces re-parent (2026-08-05) ──
  it('WorkspaceScreen is a toolbar tab of the chat section', () => {
    const chat = MAIN_SECTIONS.find((s) => s.id === 'chat');
    expect(chat.screens.map((t) => t.screen)).toEqual(['ChatScreen', 'WorkspaceScreen']);
    // First screen is what the sidebar icon lands on — must stay ChatScreen.
    expect(chat.screens[0].screen).toBe('ChatScreen');
  });

  it('there is no standalone workspace sidebar section', () => {
    expect(ALL_SECTIONS.find((s) => s.id === 'workspace')).toBeUndefined();
  });
});
