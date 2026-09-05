import { mount, flushPromises } from '@vue/test-utils';
import { reactive, nextTick } from 'vue';
import { storeKey } from 'vuex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemOverviewPanel from './SystemOverviewPanel.vue';

const wrappers = [];
const sampleGetters = () => ({
  'executionHistory/getExecutions': [{ status: 'RUNNING' }, { status: 'executing' }, { status: 'in_progress' }, { status: 'completed' }],
  'goals/allGoals': [{ status: 'executing' }, { status: 'completed' }],
  'insights/escalatedInsights': [{ id: 'approval' }],
  'agents/allAgents': [{ id: 'agent' }],
  'workflows/allWorkflows': [{ id: 'workflow' }],
  'tools/customTools': [{ id: 'tool' }],
  'skills/allSkills': [{ id: 'skill' }],
  'widgetDefinitions/allDefinitions': [{ id: 'widget' }],
  'insights/agentMemories': [{ id: 'memory' }],
  'insights/allInsights': [{ id: 'insight' }],
  'schedules/allSchedules': [{ id: 'schedule' }],
  'contentOutputs/outputs': [{ id: 'chat' }],
  'contentOutputs/totalCount': 1234567,
  'appAuth/healthyConnectionsCount': 3,
  'appAuth/totalConnectionsCount': 4,
});

function renderPanel(getters = sampleGetters(), dispatch = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stats: { total: 7 } }) }));
  const store = { getters: reactive(getters), dispatch };
  const wrapper = mount(SystemOverviewPanel, { global: { provide: { [storeKey]: store } } });
  wrappers.push(wrapper);
  return { wrapper, store };
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});

describe('SystemOverviewPanel presentation', () => {
  it('gives live activity and inventory distinct labelled sections', async () => {
    const { wrapper } = renderPanel();
    await flushPromises();
    expect(wrapper.find('section[aria-label="Right now"]').exists()).toBe(true);
    expect(wrapper.find('section[aria-label="Inventory"]').exists()).toBe(true);
    expect(wrapper.findAll('.sys-activity')).toHaveLength(3);
    expect(wrapper.findAll('.sys-tile')).toHaveLength(11);
    expect(wrapper.findAll('.sys-tile--wide')).toHaveLength(1);
    expect(wrapper.find('.sys-tile--wide').text()).toContain('Connections');
    expect(wrapper.find('.sys-tile--wide').text()).toContain('3 / 4');
  });

  it('preserves every destination and its navigation options', async () => {
    const { wrapper } = renderPanel();
    await flushPromises();
    const destinations = [
      { screen: 'TracesScreen', opts: { status: 'running' } },
      'GoalsScreen', 'AutonomyScreen', 'ChatScreen', 'GoalsScreen', 'AgentsScreen',
      'WorkflowsScreen', 'ToolsScreen', 'SkillsScreen', 'WidgetManagerScreen', 'PluginsScreen',
      'MemoryScreen', { screen: 'AutonomyScreen', opts: { section: 'schedules' } }, 'ConnectorsScreen',
    ];
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(destinations.length);
    for (const button of buttons) {
      expect(button.attributes('type')).toBe('button');
      expect(button.attributes('aria-label')).toMatch(/\S/);
      await button.trigger('click');
    }
    expect(wrapper.emitted('panel-action')).toEqual(destinations.map((destination) => ['navigate', destination]));
  });

  it('retains exact large counts, add-on totals and reactive live state', async () => {
    const { wrapper, store } = renderPanel();
    await flushPromises();
    expect(wrapper.findAll('.sys-tile')[0].text()).toContain('1234567');
    expect(wrapper.findAll('.sys-tile')[7].text()).toContain('7');
    expect(wrapper.findAll('.sys-activity')[0].find('.sys-activity-value').text()).toBe('3');
    store.getters['executionHistory/getExecutions'] = [];
    store.getters['goals/allGoals'].push({ status: 'executing' });
    await nextTick();
    expect(wrapper.findAll('.sys-activity')[0].find('.sys-activity-value').text()).toBe('0');
    expect(wrapper.findAll('.sys-activity')[0].classes()).not.toContain('is-hot');
    expect(wrapper.findAll('.sys-activity')[1].find('.sys-activity-value').text()).toBe('2');
    expect(wrapper.findAll('.sys-tile')[1].find('.sys-tile-value').text()).toBe('3');
  });

  it('keeps unloaded counts unknown, then displays confirmed zeroes', async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { wrapper } = renderPanel({}, vi.fn(() => pending));
    expect(wrapper.find('.sys-live').text()).toBe('— running');
    expect(wrapper.findAll('.sys-tile')[0].find('.sys-tile-value').text()).toBe('—');
    finish();
    await flushPromises();
    expect(wrapper.find('.sys-live').text()).toBe('0 running');
    expect(wrapper.findAll('.sys-tile')[0].find('.sys-tile-value').text()).toBe('0');
    expect(wrapper.find('.sys-tile--wide').find('.sys-tile-value').text()).toBe('0 / 0');
  });
});
