/**
 * THE JOURNEY POINTS AT THINGS THAT EXIST.
 *
 * The tours this replaced pointed at selectors nobody checked: a target that
 * was renamed or never existed made the step silently skip, and "Tool Forge
 * step 2" targeted `tool-menu` (a tag name, not a class) for as long as it
 * existed. Every selector, screen and store signal the journey depends on is
 * checked here against the source, so a rename fails the build instead of a
 * new user's first five minutes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { MILESTONES, MISSIONS, PROMPT_ROUTE } from './missions.js';
import { ACTION_EVENTS, MUTATION_EVENTS } from './journeySignals.js';
import { SCREEN_ROUTES } from '@/views/Terminal/screenRoute.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir, pattern, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pattern, out);
    else if (pattern.test(entry.name) && !/\.spec\.|\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}
const VUE_SOURCE = walk(SRC, /\.vue$/).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const STORE_SOURCE = walk(path.join(SRC, 'store'), /\.js$/).map((file) => fs.readFileSync(file, 'utf8')).join('\n');

/** The literal attribute text a selector needs somewhere in a template. */
function markersFor(selector) {
  let m = /^\[data-tour-id="([^"]+)"\]$/.exec(selector);
  if (m) return [`data-tour-id="${m[1]}"`, `tour-id="${m[1]}"`];
  m = /^\[data-section="([^"]+)"\]$/.exec(selector);
  if (m) return [`data-section="${m[1]}"`];
  m = /^#([\w-]+)$/.exec(selector);
  if (m) return [`id="${m[1]}"`];
  return null; // anything fancier is not allowed: see the test below
}

const steps = Object.entries(MISSIONS).flatMap(([id, mission]) => mission.steps.map((step, index) => ({ id, index, step })));
const selectorsOf = (step) => {
  const found = step.target ? [step.target] : [];
  const walkUntil = (until) => {
    if (!until || typeof until !== 'object') return;
    (until.any || until.all || []).forEach(walkUntil);
    if (until.clickOn) found.push(until.clickOn);
  };
  walkUntil(step.until);
  return found;
};

describe('journey content', () => {
  it('every target is a stable hook (data-tour-id, data-section or #id) that exists in a template', () => {
    const problems = [];
    for (const { id, index, step } of steps) {
      for (const selector of selectorsOf(step)) {
        const markers = markersFor(selector);
        if (!markers) problems.push(`${id}[${index}] ${selector}: use [data-tour-id="…"], [data-section="…"] or #id`);
        else if (!markers.some((marker) => VUE_SOURCE.includes(marker))) problems.push(`${id}[${index}] ${selector}: no element carries it`);
      }
    }
    expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
  });

  it('every screen a mission names or offers on is a real screen', () => {
    const screens = new Set(Object.keys(SCREEN_ROUTES));
    const problems = [];
    for (const [id, mission] of Object.entries(MISSIONS)) {
      for (const screen of mission.screens || []) if (!screens.has(screen)) problems.push(`${id}: offers on unknown ${screen}`);
      mission.steps.forEach((step, index) => {
        if (step.route && !screens.has(step.route.screen)) problems.push(`${id}[${index}]: routes to unknown ${step.route.screen}`);
      });
    }
    if (!screens.has(PROMPT_ROUTE.screen)) problems.push(`prompts route to unknown ${PROMPT_ROUTE.screen}`);
    expect(problems).toEqual([]);
  });

  it('missions are short and say what to do', () => {
    for (const [id, mission] of Object.entries(MISSIONS)) {
      expect(mission.title, id).toBeTruthy();
      expect(mission.pitch, id).toBeTruthy();
      expect(mission.steps.length, `${id} has ${mission.steps.length} steps`).toBeGreaterThan(0);
      expect(mission.steps.length, `${id}: a mission is at most three steps`).toBeLessThanOrEqual(3);
      for (const step of mission.steps) {
        expect(step.title && step.content, id).toBeTruthy();
      }
    }
  });

  it('every milestone has its mission, and the mission points back', () => {
    for (const milestone of MILESTONES) {
      expect(MISSIONS[milestone.mission], milestone.id).toBeTruthy();
      expect(MISSIONS[milestone.mission].milestone).toBe(milestone.id);
    }
    const milestoneMissions = Object.entries(MISSIONS).filter(([, mission]) => mission.milestone);
    expect(milestoneMissions.length).toBe(MILESTONES.length);
  });

  it('every page that has a screen is covered by a mission, except the deliberate few', () => {
    // Dashboard offers the next milestone (JOURNEY_SCREEN); BallJumper is a game;
    // the Learning-family screens all redirect to LearningScreen.
    const exempt = new Set(['DashboardScreen', 'BallJumperScreen', 'ExperimentsScreen', 'AutonomyScreen']);
    const covered = new Set(Object.values(MISSIONS).flatMap((mission) => mission.screens || []));
    const missing = Object.keys(SCREEN_ROUTES).filter((screen) => !exempt.has(screen) && !covered.has(screen));
    expect(missing).toEqual([]);
  });

  it('every store signal the journey listens for exists', () => {
    const missing = [...Object.keys(MUTATION_EVENTS), ...Object.keys(ACTION_EVENTS), 'workflows/UPDATE_WORKFLOW_STATUS'].filter((type) => {
      const name = type.split('/')[1];
      return !new RegExp(`\\b${name}\\s*\\(`).test(STORE_SOURCE);
    });
    expect(missing).toEqual([]);
  });
});
