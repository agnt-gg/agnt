<template>
  <section class="focused-page focused-editor" :aria-label="card ? card.name : 'Connection'">
    <button type="button" class="focused-page-back" @click="back"><i class="fas fa-arrow-left" aria-hidden="true"></i>Plugins</button>

    <!-- An old link to an AI model (models are not apps). -->
    <section v-if="!card && isModelProvider" class="focused-edit-block">
      <div class="focused-edit-card">
        <div class="focused-edit-row column">
          <span class="focused-edit-hint">AI model connections live in Settings. Choose which model AGNT uses in Settings.</span>
          <button type="button" class="focused-primary" @click="nav.go({ page: 'settings' })">Open Settings</button>
        </div>
      </div>
    </section>
    <p v-else-if="!card" class="focused-empty">{{ loading ? 'Loading…' : 'This connection isn’t available.' }}</p>

    <template v-else>
      <header class="focused-edit-head">
        <FocusedConnectorLogo :provider-id="card.providerId || card.id" :name="card.name" :icon="card.icon" />
        <div class="focused-edit-names">
          <h2 class="focused-plain-title">{{ card.name }}</h2>
          <span class="focused-edit-meta" :class="{ ok: card.status === 'ready' }">{{ STATUS_WORD[card.status] }}</span>
        </div>
        <button type="button" class="focused-btn" @click="nav.ask(editAsk('connection', card.name))">
          <i class="fas fa-comment-dots" aria-hidden="true"></i>Ask about this connection
        </button>
      </header>

      <p v-if="card.description" class="focused-instructions">{{ card.description }}</p>

      <!-- What's inside: every app this card turns on, and what each ships. -->
      <section v-if="card.apps.length" class="focused-edit-block">
        <div class="focused-edit-block-head"><h3>What’s inside</h3></div>
        <div class="focused-edit-card">
          <ul class="focused-app-inside">
            <li v-for="app in card.apps" :key="app.name">
              <strong>{{ app.displayName }}</strong>
              <small>{{ contents(app) }}</small>
              <button v-for="w in app.widgets" :key="w.id" type="button" class="focused-btn" @click="nav.go({ page: 'library', tab: 'widgets', item: w.id })">
                <i class="fas fa-shapes" aria-hidden="true"></i>Open {{ w.name }}
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- A plugin that bills through a model key: the key is shared with the models. -->
      <section v-if="card.usesModelKey" class="focused-edit-block">
        <div class="focused-edit-card">
          <div class="focused-edit-row">
            <span class="focused-edit-label">Sign-in</span>
            <span class="focused-edit-hint" :class="{ ok: card.status === 'ready' }">
              Uses your {{ providerName }} key, the same one your AI models use.
              <template v-if="card.status !== 'ready'"> Add it below to use this plugin.</template>
            </span>
          </div>
          <form v-if="card.status !== 'ready'" class="focused-edit-row" @submit.prevent="saveKey">
            <span class="focused-edit-label">API key</span>
            <div class="focused-edit-pair">
              <input v-model="apiKey" class="focused-input" type="password" autocomplete="off" :placeholder="`Paste your ${providerName} key`" aria-label="API key" />
              <button type="submit" class="focused-primary" :disabled="!apiKey.trim() || busy">Connect</button>
            </div>
          </form>
        </div>
      </section>

      <!-- Signed in (and working) -->
      <section v-else-if="card.providerId && card.status === 'ready'" class="focused-edit-block">
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
        <div class="focused-form-foot">
          <button type="button" class="focused-btn danger" :disabled="busy" @click="disconnect">Disconnect</button>
        </div>
      </section>

      <!-- Needs a sign-in, or the sign-in stopped working -->
      <section v-else-if="card.providerId" class="focused-edit-block">
        <div class="focused-edit-card">
          <div v-if="card.status === 'reconnect'" class="focused-edit-row">
            <span class="focused-edit-hint">The {{ card.name }} sign-in stopped working, so {{ describeApps(card) || card.name }} can’t run. Sign in again to fix it.</span>
          </div>
          <div v-if="card.connectionType === 'oauth'" class="focused-edit-row">
            <span class="focused-edit-label">Sign in</span>
            <button type="button" class="focused-primary" :disabled="busy" @click="connectOAuth">
              {{ busy ? 'Waiting for sign-in…' : `${card.status === 'reconnect' ? 'Reconnect' : 'Connect'} ${card.name}` }}
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
            <button type="button" class="focused-primary" @click="nav.studio('ConnectorsScreen', { section: 'oauth' })">Set up {{ card.name }}</button>
          </div>
          <div v-else class="focused-edit-row column">
            <span class="focused-edit-hint">Ask AGNT to connect this for you.</span>
            <button type="button" class="focused-primary" @click="nav.ask(`Connect ${card.name} to AGNT`)">Ask in chat</button>
          </div>
        </div>
      </section>

      <!-- What else this sign-in can turn on. Offered, never installed silently:
           a marketplace tag is a hint, not a declaration. -->
      <section v-if="card.suggested.length" class="focused-edit-block">
        <div class="focused-edit-card">
          <div class="focused-edit-row column">
            <span class="focused-edit-hint">Also works with your {{ card.name }} account: {{ card.suggested.map((s) => s.displayName).join(', ') }}.</span>
            <button type="button" class="focused-primary" :disabled="busy" @click="addSuggested">
              {{ busy ? 'Adding…' : `Add ${card.suggested.length === 1 ? 'it' : `all ${card.suggested.length}`}` }}
            </button>
          </div>
        </div>
      </section>

      <p v-if="error" class="focused-save-text error">{{ error }}</p>
    </template>
  </section>
</template>

<script setup>
// One app's page: what it turns on, how it signs in, what else it could turn
// on. The account card comes from services/appCards; package browsing is shared separately;
// every action goes through the shared stores — Focused never calls the API.
import { ref, computed, inject, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import FocusedConnectorLogo from './FocusedConnectorLogo.vue';
import { CLI_DISCONNECT_ACTIONS, editAsk } from './focusedModel.js';
import { useAppCards } from '@/composables/useAppCards.js';
import { findAppCard, describeApps } from '@/services/appCards.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';

/** Legacy account links still work; in-app sign-in can return to its package details. */
const props = defineProps({
  cardId: { type: String, required: true },
  returnItem: { type: String, default: null },
});
const store = useStore();
const nav = inject('focusedNav');

const busy = ref(false);
const error = ref('');
const apiKey = ref('');
const { cards, loading } = useAppCards();
const card = computed(() => findAppCard(cards.value, props.cardId));
const isModelProvider = computed(() => AI_PROVIDERS_WITH_API.includes(String(props.cardId).toLowerCase()));

const STATUS_WORD = Object.freeze({ ready: 'Ready', connect: 'Not connected', reconnect: 'Sign-in stopped working' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function contents(app) {
  return [app.tools && plural(app.tools, 'tool'), app.widgets.length && plural(app.widgets.length, 'widget'), app.skills.length && plural(app.skills.length, 'skill')]
    .filter(Boolean)
    .join(' · ');
}

// The catalogue keeps its own id casing ('Slack'); the auth endpoints want it.
const catalogueEntry = computed(() =>
  (store.state.appAuth?.allProviders || []).find((p) => String(p.id).toLowerCase() === card.value?.providerId),
);
const providerId = computed(() => (catalogueEntry.value ? String(catalogueEntry.value.id) : card.value?.providerId));
const providerName = computed(() => catalogueEntry.value?.name || card.value?.providerId || '');

const back = () => nav.go(props.returnItem ? { page: 'connectors', item: props.returnItem } : { page: 'connectors' });

// OAuth opens the provider's consent page in a popup (as Connectors does) and
// re-reads the connections once it closes. The interval is cleared on close
// and on leaving the page, so nothing polls after this view is gone.
let popupTimer = null;
async function connectOAuth() {
  error.value = '';
  busy.value = true;
  try {
    const authUrl = await store.dispatch('appAuth/requestOAuthUrl', providerId.value);
    const w = 600;
    const h = 700;
    const popup = window.open(
      authUrl,
      `oauth_${providerId.value}`,
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
      // A reconnect clears the failing state only once health is re-read.
      await store.dispatch('appAuth/checkConnectionHealth').catch(() => {});
      busy.value = false;
      if (card.value?.status === 'ready') nav.toast(`${card.value.name} connected.`);
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
    await store.dispatch('appAuth/saveApiKey', { providerId: providerId.value, apiKey: key });
    apiKey.value = '';
    await store.dispatch('appAuth/checkConnectionHealth').catch(() => {});
    nav.toast(`${card.value.name} connected.`);
  } catch (e) {
    error.value = `Couldn’t save the key. ${e?.message || e}`;
  } finally {
    busy.value = false;
  }
}

async function disconnect() {
  const name = card.value.name;
  // One sign-in can power several apps; say which ones stop.
  const stops = describeApps(card.value);
  const message = stops && card.value.apps.length > 1
    ? `${stops} will stop working until you connect ${name} again.`
    : `AGNT won’t be able to use ${name} until you connect it again.`;
  if (!(await nav.confirm({ title: `Disconnect ${name}?`, message, confirmText: 'Disconnect', danger: true }))) return;
  error.value = '';
  busy.value = true;
  try {
    const cliAction = CLI_DISCONNECT_ACTIONS[card.value.providerId];
    if (cliAction) {
      const result = await store.dispatch(cliAction);
      if (result && result.success === false) throw new Error(result.error || 'Failed to disconnect.');
      await store.dispatch('appAuth/fetchConnectedApps', { forceRefresh: true });
    } else {
      await store.dispatch('appAuth/disconnectApp', providerId.value);
    }
    nav.toast(`${name} disconnected.`);
  } catch (e) {
    error.value = `Couldn’t disconnect. ${e?.message || e}`;
  } finally {
    busy.value = false;
  }
}

async function addSuggested() {
  const names = card.value.suggested.map((s) => s.name);
  error.value = '';
  busy.value = true;
  try {
    const { failed } = await store.dispatch('apps/installMany', names);
    if (failed.length) error.value = `Couldn’t add ${failed.join(', ')}.`;
    else nav.toast(names.length === 1 ? 'Plugin added.' : `${names.length} plugins added.`);
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => clearInterval(popupTimer));
</script>
