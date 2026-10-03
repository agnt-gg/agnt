<template>
  <section class="focused-page focused-editor" :aria-label="card ? card.name : 'Plugin'">
    <button type="button" class="focused-page-back" @click="back"><i class="fas fa-arrow-left" aria-hidden="true"></i>Plugins</button>

    <p v-if="!card" class="focused-empty">{{ loading ? 'Loading…' : 'This plugin isn’t available.' }}</p>
    <template v-else>
      <header class="focused-edit-head">
        <FocusedPluginLogo :provider-id="card.providerId" :name="card.name" :icon="card.icon" />
        <div class="focused-edit-names">
          <h2 class="focused-plain-title">{{ card.name }}</h2>
          <span class="focused-edit-meta" :class="{ ok: card.connected }">{{ card.connected ? card.status : 'Not connected' }}</span>
        </div>
        <button type="button" class="focused-btn" @click="nav.ask(editAsk('plugin', card.name))">
          <i class="fas fa-comment-dots" aria-hidden="true"></i>Edit plugin
        </button>
      </header>

      <p v-if="card.instructions" class="focused-instructions">{{ card.instructions }}</p>

      <!-- Connected -->
      <section v-if="card.connected" class="focused-edit-block">
        <div class="focused-edit-card">
          <div class="focused-edit-row">
            <span class="focused-edit-label">Status</span>
            <span class="focused-edit-hint ok"><i class="fas fa-check" aria-hidden="true"></i> AGNT can use {{ card.name }}. It asks before sending, buying or changing anything.</span>
          </div>
          <div v-if="card.connectionType === 'apikey'" class="focused-edit-row">
            <span class="focused-edit-label">Replace key</span>
            <form class="focused-edit-pair" @submit.prevent="saveKey">
              <input v-model="apiKey" class="focused-input" type="password" autocomplete="off" placeholder="New API key" aria-label="New API key" />
              <button type="submit" class="focused-btn" :disabled="!apiKey.trim() || busy">Save key</button>
            </form>
          </div>
        </div>
        <div v-if="card.id !== 'agnt'" class="focused-form-foot">
          <button type="button" class="focused-btn danger" :disabled="busy" @click="disconnect">Disconnect</button>
        </div>
      </section>

      <!-- Not connected -->
      <section v-else class="focused-edit-block">
        <div class="focused-edit-card">
          <div v-if="card.connectionType === 'oauth'" class="focused-edit-row">
            <span class="focused-edit-label">Sign in</span>
            <button type="button" class="focused-primary" :disabled="busy" @click="connectOAuth">
              {{ busy ? 'Waiting for sign-in…' : `Connect ${card.name}` }}
            </button>
          </div>
          <form v-else-if="card.connectionType === 'apikey'" class="focused-edit-row" @submit.prevent="saveKey">
            <span class="focused-edit-label">API key</span>
            <div class="focused-edit-pair">
              <input v-model="apiKey" class="focused-input" type="password" autocomplete="off" placeholder="Paste your API key" aria-label="API key" />
              <button type="submit" class="focused-primary" :disabled="!apiKey.trim() || busy">Connect</button>
            </div>
          </form>
          <div v-else-if="card.connectionType === 'cli'" class="focused-edit-row column">
            <span class="focused-edit-hint">{{ card.name }} signs in on this computer, with a code from its own app. That setup has a few steps, so it opens in Studio.</span>
            <button type="button" class="focused-primary" @click="nav.studio('ConnectorsScreen', { section: 'providers' })">Set up {{ card.name }}</button>
          </div>
          <div v-else class="focused-edit-row column">
            <span class="focused-edit-hint">Ask AGNT to connect this for you.</span>
            <button type="button" class="focused-primary" @click="nav.ask(`Connect ${card.name} to AGNT`)">Ask in chat</button>
          </div>
        </div>
      </section>

      <p v-if="error" class="focused-save-text error">{{ error }}</p>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import FocusedPluginLogo from './FocusedPluginLogo.vue';
import { pluginCard, CLI_DISCONNECT_ACTIONS, editAsk } from './focusedModel.js';

const props = defineProps({ providerId: { type: String, required: true } });
const store = useStore();
const nav = inject('focusedNav');

const loading = ref(false);
const busy = ref(false);
const error = ref('');
const apiKey = ref('');
const card = computed(() => pluginCard(store.state.appAuth?.allProviders, store.getters['appAuth/connectedApps'], props.providerId));

const back = () => nav.go({ page: 'plugins' });

// OAuth opens the provider's consent page in a popup (as Connectors does) and
// re-reads the connections once it closes. The interval is cleared on close
// and on leaving the page, so nothing polls after this view is gone.
let popupTimer = null;
async function connectOAuth() {
  error.value = '';
  busy.value = true;
  try {
    const authUrl = await store.dispatch('appAuth/requestOAuthUrl', card.value.providerId);
    const w = 600;
    const h = 700;
    const popup = window.open(
      authUrl,
      `oauth_${card.value.providerId}`,
      `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`,
    );
    if (!popup) {
      busy.value = false;
      error.value = 'Your browser blocked the sign-in window. Allow pop-ups for AGNT and try again.';
      return;
    }
    clearInterval(popupTimer);
    popupTimer = setInterval(async () => {
      if (!popup.closed) return;
      clearInterval(popupTimer);
      popupTimer = null;
      await store.dispatch('appAuth/refreshAfterConnect').catch(() => {});
      busy.value = false;
      if (card.value?.connected) nav.toast(`${card.value.name} connected.`);
    }, 500);
  } catch (e) {
    busy.value = false;
    error.value = `Couldn’t start connecting ${card.value.name}. ${e?.message || e}`;
  }
}

async function saveKey() {
  const key = apiKey.value.trim();
  if (!key) return;
  error.value = '';
  busy.value = true;
  try {
    await store.dispatch('appAuth/saveApiKey', { providerId: card.value.providerId, apiKey: key });
    apiKey.value = '';
    nav.toast(`${card.value.name} connected.`);
  } catch (e) {
    error.value = `Couldn’t save the key. ${e?.message || e}`;
  } finally {
    busy.value = false;
  }
}

async function disconnect() {
  const name = card.value.name;
  if (!(await nav.confirm({ title: `Disconnect ${name}?`, message: `AGNT won’t be able to use ${name} until you connect it again.`, confirmText: 'Disconnect', danger: true }))) return;
  error.value = '';
  busy.value = true;
  try {
    const cliAction = CLI_DISCONNECT_ACTIONS[card.value.id];
    if (cliAction) {
      const result = await store.dispatch(cliAction);
      if (result && result.success === false) throw new Error(result.error || 'Failed to disconnect.');
      await store.dispatch('appAuth/fetchConnectedApps', { forceRefresh: true });
    } else {
      await store.dispatch('appAuth/disconnectApp', card.value.providerId);
    }
    nav.toast(`${name} disconnected.`);
  } catch (e) {
    error.value = `Couldn’t disconnect. ${e?.message || e}`;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  if (!store.state.appAuth?.allProviders?.length) {
    loading.value = true;
    await store.dispatch('appAuth/fetchAllProviders').catch(() => {});
    loading.value = false;
  }
});
onBeforeUnmount(() => clearInterval(popupTimer));
</script>
