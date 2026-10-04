/**
 * useAppCards — the Apps page's data, for both shells.
 *
 * Studio's Apps view and Focused's Apps page render the same cards. Reading
 * the stores and calling buildAppCards in ONE place is what keeps them from
 * drifting into two definitions of "what is connected".
 *
 * Loads only what is missing (each store keeps its own freshness), so opening
 * the page twice does not refetch everything twice.
 */
import { computed, onMounted, unref } from 'vue';
import { useStore } from 'vuex';
import { buildAppCards } from '@/services/appCards.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';

export function useAppCards(queryRef = '') {
  const store = useStore();

  const cards = computed(() =>
    buildAppCards(
      {
        installed: store.getters['apps/installed'],
        available: store.getters['apps/available'],
        catalogue: store.state.appAuth?.allProviders,
        connectedApps: store.getters['appAuth/connectedApps'],
        health: store.state.appAuth?.connectionHealth?.providers,
        widgets: store.getters['widgetDefinitions/allDefinitions'],
        skills: store.getters['skills/allSkills'],
        aiProviderIds: AI_PROVIDERS_WITH_API,
      },
      unref(queryRef),
    ),
  );

  const loading = computed(() => !store.state.apps?.installedAt);

  function load({ force = false } = {}) {
    const quiet = (promise) => Promise.resolve(promise).catch(() => {});
    return Promise.all([
      quiet(store.dispatch('apps/fetchInstalled', { force })),
      quiet(store.dispatch('apps/fetchAvailable', { force })),
      store.state.appAuth?.allProviders?.length && !force ? null : quiet(store.dispatch('appAuth/fetchAllProviders')),
      quiet(store.dispatch('appAuth/fetchConnectedApps', force ? { forceRefresh: true } : undefined)),
      store.state.appAuth?.connectionHealth && !force ? null : quiet(store.dispatch('appAuth/checkConnectionHealth')),
      store.getters['widgetDefinitions/allDefinitions']?.length ? null : quiet(store.dispatch('widgetDefinitions/fetchDefinitions')),
      store.getters['skills/allSkills']?.length ? null : quiet(store.dispatch('skills/fetchSkills')),
    ]);
  }

  onMounted(() => load());

  return { cards, loading, reload: () => load({ force: true }) };
}
