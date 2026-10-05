import { describe, expect, it } from 'vitest';
import { MAIN_SECTIONS } from '@/canvas/sections.js';
import { VIRTUAL_SECTIONS } from '@/services/navigationPreferences.js';
import {
  ALWAYS_UNLOCKED,
  UNLOCK_RULES,
  countUserConnections,
  emptyOnionState,
  evaluateUnlocks,
  isUnlocked,
  loadOnionState,
  markSeen,
  ONION_STORAGE_KEY,
  saveOnionState,
} from './navigationOnion.js';

const ALL_FACTS = ['connectedApps', 'chats', 'executions', 'goals', 'workflows', 'agents', 'tools', 'widgets', 'skills', 'teams'];
const known = (names = ALL_FACTS) => new Set(names);
const nothing = { connectedApps: [], chats: 0, executions: [], goals: [], workflows: [], agents: [], tools: [], widgets: [], skills: [], teams: [] };

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

describe('navigationOnion', () => {
  it('has exactly one rule per rail row other than the always-on ones', () => {
    const railIds = [...MAIN_SECTIONS.map((s) => s.id), ...VIRTUAL_SECTIONS.map((v) => v.id)];
    const ruled = UNLOCK_RULES.map((r) => r.id);
    expect(new Set(ruled).size).toBe(ruled.length);
    expect([...ruled, ...ALWAYS_UNLOCKED].sort()).toEqual(railIds.sort());
  });

  it('gives a brand-new account Chat and nothing else, and announces nothing', () => {
    const { state, announced } = evaluateUnlocks(nothing, known(), emptyOnionState());
    expect(state.unlocked).toEqual([]);
    expect(announced).toEqual([]);
    expect(isUnlocked('chat', state)).toBe(true);
    expect(isUnlocked('apps', state)).toBe(false);
  });

  it('upgrades an existing account silently: everything it has earned, zero announcements', () => {
    const busy = {
      connectedApps: ['openai', 'gmail'], chats: 40, executions: [{}], goals: [{}], workflows: [{}, {}],
      agents: [{}], tools: [{}], widgets: [], skills: [{}], teams: [{}],
    };
    const { state, announced } = evaluateUnlocks(busy, known(), emptyOnionState());
    expect(announced).toEqual([]);
    expect(state.fresh).toEqual([]);
    for (const id of ['apps', 'artifacts', 'traces', 'goals', 'workflows', 'agents', 'tools', 'skills', 'store', 'dashboard']) {
      expect(isUnlocked(id, state)).toBe(true);
    }
    // No widgets yet, so no Widgets row.
    expect(isUnlocked('widgets', state)).toBe(false);
  });

  it('a row added to the rail later (Skills, Widgets) appears silently for an account that already has the thing', () => {
    // An account seeded before these rows existed has every OTHER rule seeded.
    const before = { version: 1, unlocked: ['tools'], seeded: ['apps', 'artifacts', 'traces', 'goals', 'workflows', 'agents', 'tools', 'store', 'teams', 'dashboard'], fresh: [] };
    const { state, announced } = evaluateUnlocks({ ...nothing, skills: [{}], widgets: [{}] }, known(), before);
    expect(isUnlocked('skills', state)).toBe(true);
    expect(isUnlocked('widgets', state)).toBe(true);
    expect(announced).toEqual([]);
  });

  it('announces a row the moment its thing first exists — and only once', () => {
    const seeded = evaluateUnlocks(nothing, known(), emptyOnionState()).state;
    const first = evaluateUnlocks({ ...nothing, connectedApps: ['gmail'] }, known(), seeded);
    expect(first.announced).toEqual(['apps']);
    expect(first.state.fresh).toEqual(['apps']);
    const again = evaluateUnlocks({ ...nothing, connectedApps: ['gmail', 'slack'] }, known(), first.state);
    expect(again.announced).toEqual([]);
  });

  it('never re-locks a row when its count drops back to zero', () => {
    const seeded = evaluateUnlocks(nothing, known(), emptyOnionState()).state;
    const unlocked = evaluateUnlocks({ ...nothing, workflows: [{}] }, known(), seeded).state;
    const deleted = evaluateUnlocks(nothing, known(), unlocked).state;
    expect(isUnlocked('workflows', deleted)).toBe(true);
  });

  it('does not judge a rule whose facts have not loaded, so a slow load cannot fake an unlock', () => {
    const partial = evaluateUnlocks(nothing, known(['connectedApps']), emptyOnionState()).state;
    expect(partial.seeded).toContain('apps');
    expect(partial.seeded).not.toContain('workflows');
    // Workflows loads later and is already non-empty: that is history, not news.
    const later = evaluateUnlocks({ ...nothing, workflows: [{}] }, known(), partial);
    expect(later.announced).not.toContain('workflows');
    expect(isUnlocked('workflows', later.state)).toBe(true);
  });

  it('ignores the connections AGNT holds for every account', () => {
    expect(countUserConnections(['agnt', 'agnt-backup-escrow'])).toBe(0);
    expect(countUserConnections(['agnt', 'anthropic'])).toBe(1);
    const seeded = evaluateUnlocks({ ...nothing, connectedApps: ['agnt'] }, known(), emptyOnionState()).state;
    expect(isUnlocked('apps', seeded)).toBe(false);
  });

  it('opens the Dashboard only once there are five rows to overview, and only after every primary rule is seeded', () => {
    const halfLoaded = evaluateUnlocks(
      { ...nothing, connectedApps: ['x'], chats: 1, executions: [{}], goals: [{}], workflows: [{}] },
      known(['connectedApps', 'chats', 'executions', 'goals', 'workflows']),
      emptyOnionState(),
    ).state;
    expect(isUnlocked('dashboard', halfLoaded)).toBe(false);

    const seeded = evaluateUnlocks(nothing, known(), emptyOnionState()).state;
    let state = seeded;
    const steps = [{ connectedApps: ['x'] }, { chats: 1 }, { executions: [{}] }, { goals: [{}] }];
    let facts = { ...nothing };
    for (const step of steps) {
      facts = { ...facts, ...step };
      state = evaluateUnlocks(facts, known(), state).state;
    }
    expect(isUnlocked('dashboard', state)).toBe(false);
    const fifth = evaluateUnlocks({ ...facts, workflows: [{}] }, known(), state);
    // workflows + store both open here, so the overview crosses the bar in the same pass.
    expect(fifth.announced).toEqual(expect.arrayContaining(['workflows', 'store', 'dashboard']));
  });

  it('does not announce the retired Members row or count it toward unlocking Dashboard', () => {
    const old = { version: 1, unlocked: ['teams'], seeded: ['teams'], fresh: ['teams'] };
    const { state, announced } = evaluateUnlocks({ ...nothing, teams: [{}] }, known(), old);
    expect(state.unlocked).not.toContain('teams');
    expect(state.fresh).not.toContain('teams');
    expect(announced).not.toContain('teams');
  });

  it('clears the new-marker when the row is visited', () => {
    const state = { ...emptyOnionState(), unlocked: ['apps'], seeded: ['apps'], fresh: ['apps'] };
    expect(markSeen('apps', state).fresh).toEqual([]);
    expect(markSeen('goals', state)).toBe(state);
  });

  it('round-trips through storage and survives garbage', () => {
    const storage = memoryStorage();
    saveOnionState({ version: 1, unlocked: ['apps'], seeded: ['apps'], fresh: [] }, storage);
    expect(loadOnionState(storage).unlocked).toEqual(['apps']);
    storage.setItem(ONION_STORAGE_KEY, '{not json');
    expect(loadOnionState(storage)).toEqual(emptyOnionState());
    storage.setItem(ONION_STORAGE_KEY, JSON.stringify({ version: 2, unlocked: ['x'] }));
    expect(loadOnionState(storage)).toEqual(emptyOnionState());
  });
});
