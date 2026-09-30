import { describe, it, expect } from 'vitest';
import {
  countExecutingGoals,
  countRunningExecutions,
  countConnectorAttention,
  badgeLabel,
  isRunningExecution,
  RAIL_BADGE_READERS,
} from './railBadges.js';
import { ALL_SECTIONS } from './sections.js';

describe('railBadges', () => {
  it('counts only executing goals', () => {
    expect(countExecutingGoals([{ status: 'executing' }, { status: 'completed' }, null, { status: 'executing' }])).toBe(2);
    expect(countExecutingGoals(undefined)).toBe(0);
  });

  it('counts running executions across the status spellings the API uses', () => {
    expect(countRunningExecutions([{ status: 'running' }, { status: 'RUNNING' }, { status: 'completed' }, { status: 'in_progress' }])).toBe(3);
  });

  it('reads connector attention defensively', () => {
    expect(countConnectorAttention(undefined)).toBe(0);
    expect(countConnectorAttention({ attentionCount: 2 })).toBe(2);
    expect(countConnectorAttention({ attentionCount: 'x' })).toBe(0);
  });

  it('renders nothing for zero and caps at 99+', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(7)).toBe('7');
    expect(badgeLabel(140)).toBe('99+');
  });

  it('every badge declared in sections.js has a reader here', () => {
    for (const s of ALL_SECTIONS.filter((x) => x.badge)) {
      expect(typeof RAIL_BADGE_READERS[s.badge]).toBe('function');
    }
  });

  it('readers tolerate an empty store', () => {
    const store = { getters: {}, state: {} };
    for (const key of Object.keys(RAIL_BADGE_READERS)) expect(RAIL_BADGE_READERS[key](store)).toBe(0);
  });

  it('counts a started run, which the Runs page has always counted', () => {
    expect(countRunningExecutions([{ status: 'started' }])).toBe(1);
  });

  // The "1 running" that never went away: a goal deleted mid-run keeps status
  // 'executing' forever, and the Runs history loads deleted goals.
  it('never counts a deleted goal, whatever its status says', () => {
    const zombie = { id: 'goal-244abef9', type: 'goal', status: 'executing', deleted: true };
    expect(isRunningExecution(zombie)).toBe(false);
    expect(isRunningExecution({ status: 'executing', deleted_at: '2026-07-03T06:47:36.585Z' })).toBe(false);
    expect(countRunningExecutions([zombie, { status: 'running' }])).toBe(1);
    expect(countExecutingGoals([{ status: 'executing', deleted_at: '2026-07-03T06:47:36.585Z' }])).toBe(0);
  });

  it('is false for nothing and for finished runs', () => {
    for (const e of [null, undefined, {}, { status: 'completed' }, { status: 'stopped' }, { status: 'interrupted' }]) {
      expect(isRunningExecution(e)).toBe(false);
    }
  });

  it('the header pill reads the same predicate the Runs page filters by', () => {
    const executions = [{ status: 'executing', deleted: true }, { status: 'executing' }, { status: 'started' }, { status: 'completed' }];
    const store = { getters: { 'executionHistory/getExecutions': executions }, state: {} };
    expect(RAIL_BADGE_READERS.traces(store)).toBe(executions.filter(isRunningExecution).length);
    expect(RAIL_BADGE_READERS.traces(store)).toBe(2);
  });
});
