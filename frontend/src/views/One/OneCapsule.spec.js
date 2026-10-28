import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

const dispatch = vi.fn(() => Promise.resolve());
const getters = reactive({ 'userAuth/userEmail': 'maya@example.com' });
const state = reactive({ appAuth: { connectedApps: [] }, aiProvider: { customProviders: [] }, chat: { messages: [] } });
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, getters, state }) }));
const hydrate = vi.hoisted(() => vi.fn(() => Promise.resolve(new Set())));
vi.mock('@/services/accountInventory.js', async (importOriginal) => ({ ...(await importOriginal()), hydrate }));
const getStatus = vi.hoisted(() => vi.fn());
vi.mock('@/services/textAnnieService.js', () => ({ getStatus }));

import OneCapsule from './OneCapsule.vue';
import { flagsKey } from './oneModel.js';

const NO_PHONE = { phones: [], plan: { eligible: true } };
const LINKED = { phones: [{ id: 'p1', state: 'active' }], plan: { eligible: true } };
const mountCapsule = async () => {
  const w = mount(OneCapsule, { attachTo: document.body });
  await flushPromises();
  return w;
};
const open = async (w) => {
  await w.find('[data-testid="one-capsule"]').trigger('click');
  await flushPromises();
};

describe('OneCapsule', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatch.mockClear();
    hydrate.mockClear();
    getStatus.mockReset();
    getStatus.mockResolvedValue(NO_PHONE);
    for (const key of Object.keys(getters)) if (key !== 'userAuth/userEmail') delete getters[key];
    state.appAuth.connectedApps = [];
  });

  it('starts at 0 of 3: the first-run setup\'s three steps', async () => {
    const w = await mountCapsule();
    expect(w.find('[data-testid="one-capsule"]').text()).toBe('0 of 3');
    expect(w.find('.one-ring-value').attributes('style')).toContain('stroke-dashoffset: 50.27');
    w.unmount();
  });

  const hydrated = () => hydrate.mock.calls.flatMap((call) => call[1].map(([getter]) => getter)).sort();

  it('loads only what it reads: the connected apps and Text Annie\'s status', async () => {
    const w = await mountCapsule();
    expect(dispatch).toHaveBeenCalledWith('appAuth/fetchConnectedApps');
    expect(getStatus).toHaveBeenCalled();
    expect(hydrated()).toEqual(['agents/allAgents', 'contentOutputs/outputs', 'skills/allSkills', 'tools/customTools', 'workflows/allWorkflows']);
    w.unmount();
  });

  // Found on a fresh free account: every load logged a 403 from /api/schedules,
  // which only paid plans may read (planEntitlements.requireScheduledGoals).
  it('asks for schedules only once the plan includes them, even when the plan arrives late', async () => {
    const w = await mountCapsule();
    expect(hydrated()).not.toContain('schedules/allSchedules');
    getters['userAuth/planType'] = 'personal';
    await nextTick();
    expect(hydrated()).toContain('schedules/allSchedules');
    w.unmount();
  });

  it('opens on the three steps, your AI next, the phone marked Pro', async () => {
    getters['contentOutputs/totalCount'] = 4;
    const w = await mountCapsule();
    await open(w);
    expect(w.findAll('.one-step').map((s) => s.attributes('data-testid'))).toEqual(['one-step-ai', 'one-step-google', 'one-step-phone']);
    // Connect your AI comes first and is required (2026-10-21): next even after chatting on Flash.
    expect(w.find('.one-step.is-current').attributes('data-testid')).toBe('one-step-ai');
    expect(w.find('.one-step.is-current .one-step-ask').text()).toBe('Connect');
    expect(w.find('[data-testid="one-step-phone"] .one-step-optional').text()).toBe('Pro');
    w.unmount();
  });

  it('a step opens the setup at that step, and closes', async () => {
    const w = await mountCapsule();
    await open(w);
    await w.find('[data-testid="one-step-google"]').trigger('click');
    expect(w.emitted('open-setup')).toEqual([['google']]);
    expect(w.emitted('ask')).toBeUndefined();
    expect(w.find('[data-testid="one-pop"]').exists()).toBe(false);
    w.unmount();
  });

  // A phone links inside the setup; the capsule hears about it the next time it opens.
  it('looks at Text Annie again each time it opens', async () => {
    state.appAuth.connectedApps = ['google', 'openai-codex'];
    const w = await mountCapsule();
    expect(w.find('[data-testid="one-capsule"]').text()).toBe('2 of 3');
    getStatus.mockResolvedValue(LINKED);
    await open(w);
    expect(w.find('[data-testid="one-step-phone"]').classes()).toContain('is-done');
    w.unmount();
  });

  it('says All set once every step is done, an AI of your own included', async () => {
    state.appAuth.connectedApps = ['google', 'openai-codex'];
    getStatus.mockResolvedValue(LINKED);
    const w = await mountCapsule();
    expect(w.find('[data-testid="one-capsule"]').text()).toBe('All set');
    expect(w.find('.one-capsule').classes()).toContain('is-set');
    w.unmount();
  });

  it('is All set without a phone on a plan that cannot text', async () => {
    state.appAuth.connectedApps = ['google', 'openai-codex'];
    getStatus.mockResolvedValue({ phones: [], plan: { eligible: false } });
    const w = await mountCapsule();
    expect(w.find('[data-testid="one-capsule"]').text()).toBe('All set');
    w.unmount();
  });

  it('still counts what it can see when Text Annie cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getStatus.mockRejectedValue(new Error('offline'));
    state.appAuth.connectedApps = ['openai-codex'];
    const w = await mountCapsule();
    expect(w.find('[data-testid="one-capsule"]').text()).toBe('1 of 3');
    w.unmount();
    warn.mockRestore();
  });

  it('Hide puts it away for this account, for good', async () => {
    const w = await mountCapsule();
    await open(w);
    await w.find('[data-testid="one-capsule-hide"]').trigger('click');
    expect(w.find('[data-testid="one-capsule"]').exists()).toBe(false);
    expect(JSON.parse(localStorage.getItem(flagsKey('maya@example.com'))).hidden).toBe(true);
    w.unmount();
    const again = await mountCapsule();
    expect(again.find('[data-testid="one-capsule"]').exists()).toBe(false);
    again.unmount();
  });

  it('closes on a click outside and on Escape', async () => {
    const w = await mountCapsule();
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
