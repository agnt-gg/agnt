import { describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import RefreshModelsButton from './RefreshModelsButton.vue';

/**
 * The picker's refresh button is where a stale model list becomes visible.
 * Before, a vendor outage produced a "Refreshed" check mark over a week-old
 * list; now it stays in a warning state that names the reason.
 */

function mountWith({ listing = null, refreshTo } = {}) {
  const store = createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({ customProviders: [], modelListing: listing ? { GrokAI: listing } : {} }),
        getters: { modelListingFor: (s) => (p) => s.modelListing[p] || null },
        mutations: { SET_MODEL_LISTING(s, { provider, listing: l }) { s.modelListing = { ...s.modelListing, [provider]: l }; } },
        actions: {
          hardRefreshProviderModels: vi.fn(async ({ commit }, { provider }) => {
            if (refreshTo !== undefined) commit('SET_MODEL_LISTING', { provider, listing: refreshTo });
          }),
        },
      },
    },
  });
  const tip = { mounted(el, b) { el.dataset.tip = b.value; }, updated(el, b) { el.dataset.tip = b.value; } };
  return mount(RefreshModelsButton, {
    props: { provider: 'GrokAI', variant: 'icon+label' },
    global: { plugins: [store], directives: { tooltip: tip } },
  });
}

const STALE = { source: 'persisted', stale: true, fetchedAt: '2026-09-23T04:00:00.000Z', upstreamError: '403 used all available credits' };
const LIVE = { source: 'live', stale: false, fetchedAt: '2026-09-30T21:00:00.000Z', upstreamError: null };

describe('RefreshModelsButton — list provenance', () => {
  it('a live list shows the plain refresh button', () => {
    const w = mountWith({ listing: LIVE });
    expect(w.classes()).not.toContain('stale');
    expect(w.text()).toBe('Refresh');
    expect(w.find('i').classes()).toContain('fa-sync-alt');
  });

  it('a stale list shows a persistent warning that names the reason', () => {
    const w = mountWith({ listing: STALE });
    expect(w.classes()).toContain('stale');
    expect(w.text()).toBe('Not live');
    expect(w.find('i').classes()).toContain('fa-exclamation-triangle');
    expect(w.attributes('data-tip')).toMatch(/GrokAI did not return its model list.*used all available credits.*Click to retry\./);
    expect(w.attributes('disabled')).toBeUndefined(); // still retryable
  });

  it('REGRESSION: a refresh the vendor did not answer is not shown as a success', async () => {
    const w = mountWith({ listing: LIVE, refreshTo: STALE });
    await w.trigger('click');
    await flushPromises();
    expect(w.classes()).not.toContain('success');
    expect(w.classes()).toContain('stale');
  });

  it('a refresh that brings the list back live clears the warning', async () => {
    const w = mountWith({ listing: STALE, refreshTo: LIVE });
    await w.trigger('click');
    await flushPromises();
    expect(w.classes()).toContain('success');
    expect(w.classes()).not.toContain('stale');
  });

  it('no provenance from the backend (older build) behaves as before', () => {
    const w = mountWith({ listing: null });
    expect(w.classes()).not.toContain('stale');
    expect(w.text()).toBe('Refresh');
  });
});
