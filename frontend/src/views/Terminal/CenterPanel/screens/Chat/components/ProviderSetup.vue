<template>
  <div class="provider-setup">
    <ProviderLanes
      :providers="allProviders"
      :connected-ids="connectedApps"
      :codex-status="codexStatus"
      :active-id="selectedProvider"
      @connect="connect"
      @submit-credential="saveApiKey"
    />
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ProviderLanes from '@/components/ProviderLanes.vue';
import { useAiProviderConnect } from '@/composables/useAiProviderConnect.js';

/**
 * The chat's "no model" card. The grid is ProviderLanes and the connect
 * pipeline is useAiProviderConnect — both shared with onboarding, so the two
 * places a new user picks an AI cannot disagree about the list or the clicks.
 */
export default {
  name: 'ProviderSetup',
  components: { SimpleModal, ProviderLanes },
  emits: ['provider-connected'],
  setup(props, { emit }) {
    const store = useStore();
    const modal = ref(null);

    const allProviders = computed(() => store.state.appAuth.allProviders || []);
    const connectedApps = computed(() => (store.getters['appAuth/connectedApps'] ?? store.state.appAuth?.connectedApps) || []);
    const codexStatus = computed(() => store.state.appAuth.codexStatus || {});
    const selectedProvider = computed(() => store.state.aiProvider?.selectedProvider || '');

    const { connect, saveApiKey } = useAiProviderConnect(modal, {
      store,
      source: 'chat-setup',
      // The card closing into a working chat is the confirmation.
      onSelected: (provider) => emit('provider-connected', provider),
    });

    onMounted(async () => {
      if (allProviders.value.length === 0) await store.dispatch('appAuth/fetchAllProviders');
      await store.dispatch('appAuth/fetchConnectedApps');
    });

    return { allProviders, connectedApps, codexStatus, selectedProvider, connect, saveApiKey, modal };
  },
};
</script>

<style scoped>
/* The grid, tiles and lane copy live in ProviderLanes.vue, shared with the
   onboarding modal. This card kept its own near-copy — a different gap, no
   transition, a different hover colour — which is how the two screens came to
   disagree about the same list. */
.provider-setup {
  width: 100%;
}

/* The shared component centres itself inside the 700px onboarding modal. A
   sidebar-width chat panel wants neither the cap nor the top margin. */
.provider-setup :deep(.provider-lanes) {
  margin-top: 0;
  max-width: none;
}
</style>
