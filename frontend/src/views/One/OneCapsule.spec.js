import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

const dispatch = vi.fn(() => Promise.resolve());
const getters = reactive({ 'userAuth/userEmail': 'maya@example.com' });
const state = reactive({ appAuth: { connectedApps: [] }, aiProvider: { customProviders: [] }, chat: { messages: [] } });
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, getters, state }) }));
const hydrate = vi.hoisted(() => vi.fn(() => Promise.resolve(new Set())));
vi.mock('@/services/accountInventory.js', async (importOriginal) => ({ ...(await importOriginal()), hydrate }));

import OneCapsule from './OneCapsule.vue';
import { AHA_PROMPT, GOOGLE_PROMPT, flagsKey } from './oneModel.js';

const mountCapsule = () => mount(OneCapsule, { attachTo: document.body });
const open = async (w) => { await w.find('[data-testid="one-capsule"]').trigger('click'); };

describe('OneCapsule', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatch.mockClear();
    hydrate.mockClear();
    for (const key of Object.keys(getters)) if (key !== 'userAuth/userEmail') delete getters[key];
    state.appAuth.connectedApps = [];
    state.chat.messages = [];
  });

  it('starts at 2 of 7: getting and opening AGNT are done by the time it shows', () => {
    const w = mountCapsule();
    expect(w.find('[data-testid="one-capsule"]').text()).toBe('2 of 7');
    expect(w.find('.one-ring-value').attributes('style')).toContain('stroke-dashoffset: 35.91');
    w.unmount();
  });

  const hydrated = () => hydrate.mock.calls.flatMap((call) => call[1].map(([getter]) => getter)).sort();

  it('loads only what it reads, and the connected apps', () => {
    const w = mountCapsule();
    expect(dispatch).toHaveBeenCalledWith('appAuth/fetchConnectedApps');
    expect(hydrated()).toEqual(['agents/allAgents', 'contentOutputs/outputs', 'skills/allSkills', 'tools/customTools', 'workflows/allWorkflows']);
    w.unmount();
  });

  // Found on a fresh free account: every load logged a 403 from /api/schedules,
  // which only paid plans may read (planEntitlements.requireScheduledGoals).
  it('asks for schedules only once the plan includes them, even when the plan arrives late', async () => {
    const w = mountCapsule();
    expect(hydrated()).not.toContain('schedules/allSchedules');
    getters['userAuth/planType'] = 'personal';
    await nextTick();
    expect(hydrated()).toContain('schedules/allSchedules');
    w.unmount();
  });

  it('opens on all seven steps, with the next one marked and finished ones inert', async () => {
    getters['contentOutputs/totalCount'] = 4;
    const w = mountCapsule();
    await open(w);
    const steps = w.findAll('.one-step');
    expect(steps).toHaveLength(7);
    expect(w.find('.one-step.is-current').attributes('data-testid')).toBe('one-step-google');
    expect(w.find('[data-testid="one-step-chat"]').attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="one-step-brain"]').text()).toContain('optional');
    w.unmount();
  });

  it('a step asks Annie, and closes', async () => {
    const w = mountCapsule();
    await open(w);
    await w.find('[data-testid="one-step-google"]').trigger('click');
    expect(w.emitted('ask')).toEqual([[GOOGLE_PROMPT]]);
    expect(w.find('[data-testid="one-pop"]').exists()).toBe(false);
    w.unmount();
  });

  it('the model step opens the picker instead of asking in the chat', async () => {
    const w = mountCapsule();
    await open(w);
    await w.find('[data-testid="one-step-brain"]').trigger('click');
    expect(w.emitted('open-models')).toHaveLength(1);
    expect(w.emitted('ask')).toBeUndefined();
    w.unmount();
  });

  it('the ah-ha counts only once it is asked with Google there to answer it', async () => {
    const w = mountCapsule();
    state.chat.messages = [{ role: 'user', content: AHA_PROMPT }];
    await nextTick();
    expect(JSON.parse(localStorage.getItem(flagsKey('maya@example.com')) || '{}').aha).not.toBe(true);

    state.appAuth.connectedApps = ['google'];
    state.chat.messages = [{ role: 'user', content: AHA_PROMPT }, { role: 'assistant', content: 'Connected.' }, { role: 'user', content: 'ok, prep me for tomorrow' }];
    await nextTick();
    expect(JSON.parse(localStorage.getItem(flagsKey('maya@example.com'))).aha).toBe(true);
    await open(w);
    expect(w.find('[data-testid="one-step-aha"]').classes()).toContain('is-done');
    w.unmount();
  });

  it('says All set once every required step is done, the optional one aside', async () => {
    getters['contentOutputs/totalCount'] = 2;
    getters['workflows/allWorkflows'] = [{ id: 'w1' }];
    state.appAuth.connectedApps = ['google'];
    localStorage.setItem(flagsKey('maya@example.com'), JSON.stringify({ aha: true }));
    const w = mountCapsule();
    expect(w.find('[data-testid="one-capsule"]').text()).toBe('All set');
    expect(w.find('.one-capsule').classes()).toContain('is-set');
    w.unmount();
  });

  it('Hide puts it away for this account, for good', async () => {
    const w = mountCapsule();
    await open(w);
    await w.find('[data-testid="one-capsule-hide"]').trigger('click');
    expect(w.find('[data-testid="one-capsule"]').exists()).toBe(false);
    expect(JSON.parse(localStorage.getItem(flagsKey('maya@example.com'))).hidden).toBe(true);
    w.unmount();
    const again = mountCapsule();
    expect(again.find('[data-testid="one-capsule"]').exists()).toBe(false);
    again.unmount();
  });

  it('closes on a click outside and on Escape', async () => {
    const w = mountCapsule();
    await open(w);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(w.find('[data-testid="one-pop"]').exists()).toBe(false);
    await open(w);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(w.find('[data-testid="one-pop"]').exists()).toBe(false);
    w.unmount();
  });
});
