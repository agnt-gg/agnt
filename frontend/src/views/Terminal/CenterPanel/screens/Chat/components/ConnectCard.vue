<template>
  <!-- Nothing is drawn for an app that cannot be connected: a button that can
       only fail is worse than none, and Annie's reply already says why. -->
  <div v-if="connected || availability === 'available'" class="connect-card" :class="{ 'is-connected': connected }">
    <i class="fas fa-plug connect-card-icon" aria-hidden="true"></i>
    <span class="connect-card-name">{{ name }}</span>
    <span v-if="connected" class="connect-card-status"><i class="fas fa-check"></i> Connected</span>
    <span v-else-if="error" class="connect-card-status is-error">{{ error }}</span>
    <!-- Only ever offered while NOT connected: the shared flow toggles, so the
         same call on a connected provider would begin a disconnect. -->
    <button v-if="!connected" type="button" class="connect-card-button" :disabled="busy" @click="connect">
      {{ busy ? 'Connecting…' : 'Connect' }}
    </button>
    <SimpleModal ref="modalRef" />
  </div>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { useProviderConnection } from '@/composables/useProviderConnection.js';
import { fallbackProviderName } from './connectCards.js';

export default {
  name: 'ConnectCard',
  components: { SimpleModal },
  props: {
    provider: { type: String, required: true },
  },
  setup(props) {
    const modalRef = ref(null);
    const busy = ref(false);
    const error = ref('');
    // 'checking' until the catalog answers; 'unavailable' when AGNT has no
    // connection for this app (a plugin can ship tools for an app no provider
    // exists for — seen live with Pipedrive).
    const availability = ref('checking');
    const details = ref(null);
    // The exact flow the Apps screen runs — OAuth window, device code or API
    // key, chosen from the provider's own capabilities — so a connection made
    // here is indistinguishable from one made there.
    const { isProviderConnected, fetchProviderDetails, handleProviderToggle } = useProviderConnection(modalRef);

    const connected = computed(() => isProviderConnected(props.provider));
    const name = computed(() => details.value?.name || fallbackProviderName(props.provider));

    onMounted(async () => {
      if (connected.value) return;
      try {
        details.value = await fetchProviderDetails(props.provider);
        availability.value = details.value ? 'available' : 'unavailable';
      } catch {
        availability.value = 'unavailable';
      }
    });

    async function connect() {
      if (busy.value || connected.value) return;
      busy.value = true;
      error.value = '';
      try {
        await handleProviderToggle(props.provider);
      } catch (e) {
        error.value = 'Could not connect. Try again.';
        console.error('[ConnectCard]', props.provider, e);
      } finally {
        busy.value = false;
      }
    }

    return { modalRef, busy, error, connected, availability, name, connect };
  },
};
</script>

<style scoped>
/* One line, the same weight as a tool row: this is a step in the run, not a banner. */
.connect-card {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 2px;
  padding: 5px 8px 5px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: var(--color-darker-0);
  font-size: var(--font-size-xs);
  width: fit-content;
  max-width: 100%;
}
.connect-card-icon {
  color: var(--color-text-muted);
  font-size: 11px;
}
.connect-card-name {
  color: var(--color-text);
  font-weight: 500;
}
.connect-card-status {
  color: var(--color-green);
  font-size: 11px;
}
.connect-card-status.is-error {
  color: var(--color-red);
}
.connect-card-button {
  margin-left: 6px;
  padding: 3px 10px;
  border: 1px solid var(--color-green);
  border-radius: 4px;
  background: transparent;
  color: var(--color-green);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.connect-card-button:hover:not(:disabled) {
  background: var(--color-green);
  color: var(--color-darker-0);
}
.connect-card-button:disabled {
  opacity: 0.6;
  cursor: default;
}
.connect-card.is-connected {
  border-color: rgba(25, 239, 131, 0.35);
}
</style>
