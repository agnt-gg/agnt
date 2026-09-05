import { shallowMount, flushPromises } from '@vue/test-utils';
import { reactive, ref, nextTick } from 'vue';
import { storeKey } from 'vuex';
import { createRouter, createMemoryHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard.vue';
import BaseScreen from '../../BaseScreen.vue';
import LeftPanel from '../../../LeftPanel/LeftPanel.vue';
import SystemOverviewPanel from '../../../LeftPanel/types/SystemOverviewPanel/SystemOverviewPanel.vue';
import Traces from '../Traces/Traces.vue';

// Keep the navigation components real; isolate unrelated voice/tutorial IO.
vi.mock('@/composables/useVoiceEngines', () => ({
  useVoiceEngines: () => ({
    voiceActive: ref(false), voiceState: ref('idle'), voicePartial: ref(''),
    voiceError: ref(''), voiceNatural: ref(false), voiceLevel: ref(0),
    toggleVoice: vi.fn(), stopVoice: vi.fn(),
  }),
}));
vi.mock('./useDashboardTutorial.js', () => ({
  useDashboardTutorial: () => ({ tutorialConfig: ref(null), startTutorial: ref(false), onTutorialClose: vi.fn(), initializeDashboardTutorial: vi.fn() }),
}));
vi.mock('../Traces/useTracesTutorial.js', () => ({
  useTracesTutorial: () => ({ tutorialConfig: ref(null), startTutorial: ref(false), onTutorialClose: vi.fn(), initializeTracesTutorial: vi.fn() }),
}));

const wrappers = [];
let store;
function mountComponent(component, options = {}) {
  const { global = {}, ...rest } = options;
  const wrapper = shallowMount(component, {
    ...rest,
    global: {
      provide: { [storeKey]: store, isMobile: ref(false), playSound: vi.fn() },
      mocks: { $store: store },
      ...global,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function mountDashboard() {
  const wrapper = mountComponent(Dashboard, {
    global: { stubs: { BaseScreen: false, LeftPanel: false, SystemOverviewPanel: false, AsyncComponentWrapper: false } },
  });
  await flushPromises();
  await vi.waitFor(() => expect(wrapper.find('button[aria-label^="Running:"]').exists()).toBe(true));
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('requestIdleCallback', vi.fn());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stats: { total: 0 } }) }));
  store = {
    state: reactive({ chat: { isStreaming: false, messages: [] }, agents: { agents: [] }, userStats: {} }),
    getters: reactive({
      criticalDataReady: false,
      'theme/showLeftPanel': true,
      'theme/showRightPanel': true,
      'theme/leftPanelCollapsed': false,
      'theme/rightPanelCollapsed': false,
      'executionHistory/getExecutions': [
        { id: 'live', status: 'running', workflowName: 'Live job', startTime: new Date().toISOString() },
        { id: 'done', status: 'completed', workflowName: 'Finished job', startTime: new Date().toISOString() },
      ],
    }),
    dispatch: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  };
});

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dashboard panel navigation through the real component chain', () => {
  it('clicking Running reaches the screen-change boundary with its filter intact', async () => {
    const dashboard = await mountDashboard();
    await dashboard.get('button[aria-label^="Running:"]').trigger('click');
    expect(dashboard.emitted('screen-change')).toEqual([['TracesScreen', { status: 'running' }]]);
  });

  it('preserves all 14 sidebar destinations, including options on Schedules', async () => {
    const dashboard = await mountDashboard();
    const buttons = dashboard.findComponent(SystemOverviewPanel).findAll('button');
    expect(buttons).toHaveLength(14);
    for (const button of buttons) await button.trigger('click');
    expect(dashboard.emitted('screen-change')).toEqual([
      ['TracesScreen', { status: 'running' }], ['GoalsScreen'], ['AutonomyScreen'],
      ['ChatScreen'], ['GoalsScreen'], ['AgentsScreen'], ['WorkflowsScreen'],
      ['ToolsScreen'], ['SkillsScreen'], ['WidgetManagerScreen'], ['PluginsScreen'],
      ['MemoryScreen'], ['AutonomyScreen', { section: 'schedules' }], ['ConnectorsScreen'],
    ]);
  });

  it('forwards a right-panel navigation intent with options as well', async () => {
    const dashboard = await mountDashboard();
    dashboard.findComponent({ name: 'RightPanel' }).vm.$emit('panel-action', 'navigate', {
      screen: 'TracesScreen', opts: { status: 'running' },
    });
    await nextTick();
    expect(dashboard.emitted('screen-change')).toEqual([['TracesScreen', { status: 'running' }]]);
  });

  it('keeps left-panel close and non-navigation actions on their existing paths', async () => {
    const dashboard = await mountDashboard();
    const left = dashboard.findComponent(LeftPanel);
    left.vm.$emit('panel-action', 'close-left-panel');
    expect(store.dispatch).toHaveBeenCalledWith('theme/setShowLeftPanel', false);
    left.vm.$emit('panel-action', 'log-message', 'Panel message');
    await nextTick();
    expect(dashboard.vm.terminalLines).toContain('Panel message');
    expect(dashboard.emitted('screen-change')).toBeUndefined();
  });

  it('unwraps an object without options while leaving bare-string navigation to the screen', async () => {
    const dashboard = await mountDashboard();
    const left = dashboard.findComponent(LeftPanel);
    left.vm.$emit('panel-action', 'navigate', { screen: 'AgentsScreen' });
    left.vm.$emit('panel-action', 'navigate', 'GoalsScreen');
    await nextTick();
    expect(dashboard.emitted('screen-change')).toEqual([['AgentsScreen', {}], ['GoalsScreen']]);
  });

  it.each(['fresh', 'already mounted'])('the forwarded intent selects only running activity when %s', async (state) => {
    const dashboard = await mountDashboard();
    await dashboard.get('button[aria-label^="Running:"]').trigger('click');
    const [screen, options] = dashboard.emitted('screen-change')[0];
    expect(screen).toBe('TracesScreen');
    expect(options).toEqual({ status: 'running' });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/traces', component: { template: '<div />' } }],
    });
    await router.push(state === 'fresh' ? { path: '/traces', query: options } : '/traces');
    await router.isReady();
    const traces = mountComponent(Traces, { global: { plugins: [router], stubs: { BaseScreen: false } } });
    await flushPromises();
    if (state === 'already mounted') {
      traces.vm.activeTab = 'completed';
      await nextTick();
      expect(traces.vm.filteredExecutions.map((execution) => execution.id)).toEqual(['done']);
      await router.push({ path: '/traces', query: options });
      await flushPromises();
    }
    expect(traces.vm.activeTab).toBe('running');
    expect(traces.vm.filteredExecutions.map((execution) => execution.id)).toEqual(['live']);
    expect(traces.findComponent(BaseScreen).props('leftPanelProps').executions.map((execution) => execution.id)).toEqual(['live']);
    expect(traces.findComponent({ name: 'BaseTable' }).props('items').map((execution) => execution.id)).toEqual(['live']);
  });
});
