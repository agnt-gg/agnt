/**
 * The chat panel's "Awaiting approval": one, or all, through the escalation
 * queue endpoints. Regression: the rows used to call the retired
 * /insights/:id/{apply,reject}, which the server answers 410.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ApprovalQueue from './ApprovalQueue.vue';

const insight = (id) => ({ id, title: 'change ' + id, target_type: 'agent' });

function makeStore(ids, { acceptResult } = {}) {
  const actions = {
    fetchEscalated: vi.fn(),
    fetchStats: vi.fn(),
    acceptEscalated: vi.fn((_ctx, batch) => acceptResult?.(batch) ?? { applied: batch, skipped: [], failed: [] }),
    rejectEscalated: vi.fn((_ctx, batch) => batch.length),
    applyInsight: vi.fn(),
    rejectInsight: vi.fn(),
  };
  const store = createStore({
    modules: {
      insights: {
        namespaced: true,
        state: { escalated: ids.map(insight) },
        getters: { escalatedInsights: (state) => state.escalated },
        actions,
      },
    },
  });
  return { store, actions };
}

const mountWith = (store) => mount(ApprovalQueue, { global: { plugins: [store] } });
const button = (w, text) => w.findAll('button').find((b) => b.text().startsWith(text));
const batchesOf = (spy) => spy.mock.calls.map((call) => call[1]);

describe('ApprovalQueue', () => {
  it('offers Reject all and Approve all with the count', () => {
    const w = mountWith(makeStore(['a', 'b', 'c']).store);
    expect(button(w, 'Reject all').text()).toBe('Reject all (3)');
    expect(button(w, 'Approve all').text()).toBe('Approve all (3)');
  });

  it('Reject all asks once, then rejects every waiting id through the queue endpoint', async () => {
    const { store, actions } = makeStore(['a', 'b', 'c']);
    const w = mountWith(store);
    await button(w, 'Reject all').trigger('click');
    expect(actions.rejectEscalated).not.toHaveBeenCalled();
    expect(w.find('.confirm').text()).toContain('Reject 3 actions?');
    await button(w.find('.confirm'), 'Confirm').trigger('click');
    await flushPromises();
    expect(batchesOf(actions.rejectEscalated)).toEqual([['a', 'b', 'c']]);
    expect(actions.fetchEscalated).toHaveBeenCalled();
  });

  it('Approve all walks the queue in batches of 50', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => 'i' + i);
    const { store, actions } = makeStore(ids);
    const w = mountWith(store);
    await button(w, 'Approve all').trigger('click');
    await button(w.find('.confirm'), 'Confirm').trigger('click');
    await flushPromises();
    expect(batchesOf(actions.acceptEscalated).map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it('Cancel runs nothing', async () => {
    const { store, actions } = makeStore(['a']);
    const w = mountWith(store);
    await button(w, 'Approve all').trigger('click');
    await button(w.find('.confirm'), 'Cancel').trigger('click');
    expect(w.find('.confirm').exists()).toBe(false);
    expect(actions.acceptEscalated).not.toHaveBeenCalled();
  });

  it('a single row uses the queue endpoints, never the retired per-insight ones', async () => {
    const { store, actions } = makeStore(['a', 'b']);
    const w = mountWith(store);
    const second = w.findAll('.card')[1];
    await button(second, 'Approve').trigger('click');
    await flushPromises();
    await button(w.findAll('.card')[0], 'Reject').trigger('click');
    await flushPromises();
    expect(batchesOf(actions.acceptEscalated)).toEqual([['b']]);
    expect(batchesOf(actions.rejectEscalated)).toEqual([['a']]);
    expect(actions.applyInsight).not.toHaveBeenCalled();
    expect(actions.rejectInsight).not.toHaveBeenCalled();
  });

  it('says which approvals failed instead of failing silently', async () => {
    const { store } = makeStore(['a', 'b'], { acceptResult: (batch) => ({ applied: [], skipped: [], failed: batch.map((id) => ({ id, error: 'boom' })) }) });
    const w = mountWith(store);
    await button(w, 'Approve all').trigger('click');
    await button(w.find('.confirm'), 'Confirm').trigger('click');
    await flushPromises();
    expect(w.find('.err').text()).toContain('2 actions could not be applied and are still waiting: boom');
  });

  it('says so when nothing is waiting, with no bulk buttons', () => {
    const w = mountWith(makeStore([]).store);
    expect(w.text()).toContain('Nothing is waiting for approval.');
    expect(button(w, 'Reject all')).toBeUndefined();
  });
});
