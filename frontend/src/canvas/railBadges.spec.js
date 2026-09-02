import { describe, it, expect } from 'vitest';
import { countExecutingGoals, countRunningExecutions, countConnectorAttention, badgeLabel, RAIL_BADGE_READERS } from './railBadges.js';
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
});
