import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const teamState = { team: null, spaces: [], members: [], inbox: [] };
vi.mock('@/views/One/team/useTeam.js', () => ({ useTeam: () => ({ state: teamState }) }));
import TeamPanel from './TeamPanel.vue';

const store = createStore({ getters: { 'agents/allAgents': () => [{}, {}], 'schedules/allSchedules': () => [{}] } });
const mountPanel = (props = {}) => mount(TeamPanel, { props, global: { plugins: [store] } });

beforeEach(() => Object.assign(teamState, {
  team: { id: 't1', name: 'bravo' },
  spaces: [{ id: 's1', name: 'General', access: 'team' }, { id: 's2', name: 'Sales', access: 'team' }, { id: 's3', name: 'Product', access: 'invited' }],
  members: [{ id: 'a' }, { id: 'b' }],
  inbox: [{ id: 'i1', read: false }, { id: 'i2', read: true }],
}));

describe('TeamPanel: Activity-panel parts, not bare rows', () => {
  it('shows the team at a glance, My Space with counts, teamspaces with icons, and quick actions', () => {
    const w = mountPanel({ active: 'space:s2' });
    expect(w.find('.title').text()).toBe('/ Bravo');
    expect(w.findAll('.stat-value').map((n) => n.text())).toEqual(['1', '3', '2', '2']);
    expect(w.findAll('.section-title').map((n) => n.text())).toEqual(['Team at a glance', 'My Space', 'Teamspaces', 'Quick Actions']);
    expect(w.find('[data-nav="mine-agents"] .filter-count').text()).toBe('2');
    expect(w.find('[data-nav="space:s2"] i').classes()).toContain('fa-briefcase');
    expect(w.find('[data-nav="space:s2"]').classes()).toContain('active');
    expect(w.find('[data-nav="space:s3"] .lock').exists()).toBe(true);
  });
  it('every row asks the screen to go', async () => {
    const w = mountPanel();
    await w.find('[data-nav="space:s1"]').trigger('click');
    await w.find('[data-nav="mine-tasks"]').trigger('click');
    await w.find('[data-nav="new-doc"]').trigger('click');
    await w.find('[data-nav="new-space"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([['team-go', { view: 'space', space: 's1' }], ['team-pick', 'mine-tasks'], ['team-pick', 'new-doc'], ['team-new-space']]);
  });
  it('off a team it says so instead of showing empty team cards', () => {
    teamState.team = null;
    const w = mountPanel();
    expect(w.find('.stats-grid').exists()).toBe(false);
    expect(w.text()).toContain('not on a team yet');
  });
});
