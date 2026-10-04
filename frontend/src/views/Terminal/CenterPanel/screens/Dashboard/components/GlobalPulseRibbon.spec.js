import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GlobalPulseRibbon from './GlobalPulseRibbon.vue';

// The streak belongs to the credits chart's badge, directly above. The ribbon
// showed it a second time.
describe('Global Pulse ribbon', () => {
  it('shows the live counts and no streak', () => {
    const w = mount(GlobalPulseRibbon, { props: { agentsData: { active: 3 }, runsData: { queued: 1, daily: 1500 }, daysStreak: 12 } });
    expect(w.text()).toContain('Agents:');
    expect(w.text()).toContain('1.5k/24h');
    expect(w.text()).not.toMatch(/Streak|days 🔥/);
  });
});
