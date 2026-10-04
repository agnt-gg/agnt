<!-- AppsSection — Studio's "Your apps": one card per thing you connect.

     Rendered from services/appCards (the same model Focused's Apps page uses):
     plugins that share a sign-in are one card (Google = Gmail, Sheets, Drive …),
     a plugin with no sign-in is its own card, and a sign-in with no plugin is
     still listed because it is still something you connected.

     This component never connects anything itself. Connect / Reconnect /
     Disconnect are emitted to Connectors.vue, which runs the flows it already
     owns (OAuth popup, API-key prompt, on-this-computer CLIs), so there is one
     sign-in path in Studio, not two. -->
<template>
  <div class="apps-section">
    <div class="apps-head">
      <div>
        <h2 class="content-title">Your apps</h2>
        <p class="content-subtitle">Everything AGNT can use for you. Connect a service once and every app that uses it is on.</p>
      </div>
      <div class="apps-actions">
        <div class="apps-tabs" role="tablist" aria-label="Which apps">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            role="tab"
            class="apps-tab"
            :class="{ active: tab === t.id }"
            :aria-selected="tab === t.id ? 'true' : 'false'"
            @click="tab = t.id"
          >
            {{ t.label }} <span class="apps-count">{{ (t.id === 'yours' ? cards.yours : cards.discover).length }}</span>
          </button>
        </div>
        <input v-model="query" class="apps-search" type="search" placeholder="Search apps" aria-label="Search apps" />
        <button type="button" class="apps-btn" @click="$emit('build-app')"><i class="fas fa-hammer"></i> New app</button>
        <button type="button" class="apps-btn quiet" @click="$emit('add-account')"><i class="fas fa-plus"></i> Custom sign-in</button>
      </div>
    </div>

    <p v-if="attention" class="apps-attention" role="status">
      <i class="fas fa-exclamation-triangle"></i> {{ attention }}
    </p>

    <p v-if="loading && !list.length" class="apps-empty">Loading apps…</p>
    <p v-else-if="!list.length" class="apps-empty">
      <template v-if="query">No apps match “{{ query }}”.</template>
      <template v-else-if="tab === 'yours'">Nothing connected yet. <button type="button" class="apps-link" @click="tab = 'discover'">Discover apps</button></template>
      <template v-else>Everything available is already yours.</template>
    </p>

    <div v-else class="apps-grid">
      <article
        v-for="card in list"
        :key="card.id"
        class="app-card"
        :class="[`is-${card.status}`, { open: openId === card.id }]"
        :data-app="card.id"
      >
        <button type="button" class="app-card-main" :aria-expanded="openId === card.id ? 'true' : 'false'" @click="toggle(card)">
          <span class="app-icon"><SvgIcon :name="card.icon || 'custom'" /></span>
          <span class="app-copy">
            <strong class="app-name">{{ card.name }}</strong>
            <small class="app-line">{{ summaryLine(card) }}</small>
          </span>
          <span class="app-status" :class="card.status">{{ STATUS_LABEL[card.status] }}</span>
        </button>

        <div v-if="card.apps.length > 1" class="app-chips">
          <span v-for="app in card.apps.slice(0, 5)" :key="app.name" class="app-chip">{{ app.displayName }}</span>
          <span v-if="card.apps.length > 5" class="app-chip more">+{{ card.apps.length - 5 }}</span>
        </div>

        <div class="app-card-actions">
          <button v-if="card.status === 'connect' && card.providerId" type="button" class="apps-btn" @click="$emit('connect', card)">
            {{ card.usesModelKey ? `Add ${providerName(card)} key` : 'Connect' }}
          </button>
          <button v-else-if="card.status === 'reconnect' && card.providerId" type="button" class="apps-btn warn" @click="$emit('reconnect', card)">Reconnect</button>
          <button v-if="card.apps.length" type="button" class="apps-link" @click="toggle(card)">{{ openId === card.id ? 'Close' : 'What’s inside' }}</button>
        </div>

        <!-- Detail: what is inside, what else this sign-in can turn on, and the one destructive verb. -->
        <div v-if="openId === card.id" class="app-detail">
          <p v-if="card.description" class="app-desc">{{ card.description }}</p>
          <!-- The key is shared with the models, so it is never disconnected from here. -->
          <p v-if="card.usesModelKey" class="app-note">Uses your {{ providerName(card) }} key, the same one your AI models use.</p>

          <ul v-if="card.apps.length" class="app-inside">
            <li v-for="app in card.apps" :key="app.name">
              <span class="inside-name">{{ app.displayName }}</span>
              <span class="inside-meta">{{ plural(app.tools, 'tool') }}</span>
              <button v-for="w in app.widgets" :key="w.id" type="button" class="apps-link" @click="$emit('open-widget', w.id)">
                <i class="fas fa-shapes"></i> Open {{ w.name }}
              </button>
              <button type="button" class="apps-link quiet" @click="$emit('open-app', app.name)">Details</button>
            </li>
          </ul>

          <div v-if="card.suggested.length" class="app-suggest">
            <span>Also works with your {{ card.name }} account: {{ card.suggested.map((s) => s.displayName).join(', ') }}</span>
            <button type="button" class="apps-btn" :disabled="installing === card.id" @click="addSuggested(card)">
              {{ installing === card.id ? 'Adding…' : `Add ${card.suggested.length === 1 ? 'it' : `all ${card.suggested.length}`}` }}
            </button>
          </div>

          <div v-if="card.status !== 'connect' && card.providerId && !card.usesModelKey" class="app-danger">
            <button type="button" class="apps-btn danger" @click="$emit('disconnect', card)">Disconnect {{ card.name }}</button>
            <small v-if="card.apps.length">{{ describeApps(card) }} will stop working until you connect again.</small>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { useAppCards } from '@/composables/useAppCards.js';
import { describeApps } from '@/services/appCards.js';

defineEmits(['connect', 'reconnect', 'disconnect', 'open-app', 'open-widget', 'build-app', 'add-account']);

const store = useStore();
const TABS = Object.freeze([
  { id: 'yours', label: 'Yours' },
  { id: 'discover', label: 'Discover' },
]);
const STATUS_LABEL = Object.freeze({ ready: 'Ready', connect: 'Connect', reconnect: 'Reconnect' });

const query = ref('');
const tab = ref('yours');
const openId = ref(null);
const installing = ref(null);
const { cards, loading } = useAppCards(query);

const list = computed(() => (tab.value === 'yours' ? cards.value.yours : cards.value.discover));
const attention = computed(() => {
  const broken = cards.value.yours.filter((c) => c.status === 'reconnect').length;
  const waiting = cards.value.yours.filter((c) => c.status === 'connect').length;
  const parts = [];
  if (broken) parts.push(`${broken} sign-in${broken === 1 ? '' : 's'} stopped working`);
  if (waiting) parts.push(`${waiting} installed app${waiting === 1 ? ' needs' : 's need'} a sign-in`);
  return parts.join(' · ');
});

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function summaryLine(card) {
  const parts = [];
  if (card.apps.length > 1) parts.push(plural(card.apps.length, 'app'));
  if (card.counts.tools) parts.push(plural(card.counts.tools, 'tool'));
  if (card.counts.widgets) parts.push(plural(card.counts.widgets, 'widget'));
  if (card.counts.skills) parts.push(plural(card.counts.skills, 'skill'));
  if (!parts.length) parts.push(card.providerId ? 'Sign-in' : 'Installed');
  return parts.join(' · ');
}
function providerName(card) {
  const entry = (store.state.appAuth?.allProviders || []).find((p) => String(p.id).toLowerCase() === card.providerId);
  return entry?.name || card.providerId;
}
function toggle(card) {
  openId.value = openId.value === card.id ? null : card.id;
}

async function addSuggested(card) {
  installing.value = card.id;
  try {
    const { failed } = await store.dispatch('apps/installMany', card.suggested.map((s) => s.name));
    if (failed.length) console.error(`[AppsSection] could not add: ${failed.join(', ')}`);
  } finally {
    installing.value = null;
  }
}
</script>

<style scoped>
.apps-section { display: flex; flex-direction: column; gap: 14px; }
.apps-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.apps-head .content-title { margin: 0 0 4px; }
.apps-head .content-subtitle { margin: 0; color: var(--color-text-muted); font-size: 0.9em; }
.apps-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.apps-tabs { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--terminal-border-color); border-radius: 8px; }
.apps-tab { background: none; border: 0; color: var(--color-text-muted); padding: 5px 10px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 0.85em; }
.apps-tab.active { background: rgba(var(--primary-rgb), 0.15); color: var(--color-text); }
.apps-count { opacity: 0.6; margin-left: 2px; }
.apps-search { background: var(--color-darker-0); border: 1px solid var(--terminal-border-color); color: var(--color-text); border-radius: 6px; padding: 6px 10px; font: inherit; font-size: 0.85em; min-width: 180px; }
.apps-btn { display: inline-flex; align-items: center; gap: 6px; background: rgba(var(--primary-rgb), 0.15); color: var(--color-primary); border: 1px solid rgba(var(--primary-rgb), 0.35); border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 0.82em; white-space: nowrap; }
.apps-btn:hover:not(:disabled) { background: rgba(var(--primary-rgb), 0.25); }
.apps-btn:disabled { opacity: 0.6; cursor: default; }
.apps-btn.quiet { background: none; color: var(--color-text-muted); border-color: var(--terminal-border-color); }
.apps-btn.warn { color: var(--color-yellow, #ffb547); border-color: rgba(255, 181, 71, 0.45); background: rgba(255, 181, 71, 0.1); }
.apps-btn.danger { color: var(--color-red, #ff5d73); border-color: rgba(255, 93, 115, 0.4); background: rgba(255, 93, 115, 0.08); }
.apps-link { background: none; border: 0; padding: 0; color: var(--color-primary); cursor: pointer; font: inherit; font-size: 0.82em; }
.apps-link.quiet { color: var(--color-text-muted); }
.apps-attention { margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 0.85em; color: var(--color-yellow, #ffb547); background: rgba(255, 181, 71, 0.08); border: 1px solid rgba(255, 181, 71, 0.25); }
.apps-empty { color: var(--color-text-muted); font-size: 0.9em; }
.apps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; align-items: start; }
.app-card { border: 1px solid var(--terminal-border-color); border-radius: 10px; background: var(--color-darker-0); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.app-card.is-reconnect { border-color: rgba(255, 181, 71, 0.45); }
.app-card.open { grid-column: span 2; }
.app-card-main { display: flex; align-items: center; gap: 10px; background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; width: 100%; }
.app-icon { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; border-radius: 8px; background: rgba(var(--primary-rgb), 0.08); }
.app-icon :deep(svg) { width: 18px; height: 18px; }
.app-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.app-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-line { color: var(--color-text-muted); font-size: 0.78em; }
.app-status { font-size: 0.72em; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.app-status.ready { color: var(--color-green, #2fd6a0); background: rgba(47, 214, 160, 0.1); }
.app-status.connect { color: var(--color-text-muted); background: rgba(127, 127, 160, 0.12); }
.app-status.reconnect { color: var(--color-yellow, #ffb547); background: rgba(255, 181, 71, 0.12); }
.app-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.app-chip { font-size: 0.72em; padding: 1px 7px; border-radius: 5px; background: rgba(var(--primary-rgb), 0.08); color: var(--color-text-muted); }
.app-card-actions { display: flex; align-items: center; gap: 10px; min-height: 0; }
.app-card-actions:empty { display: none; }
.app-detail { border-top: 1px solid var(--terminal-border-color); padding-top: 8px; display: flex; flex-direction: column; gap: 10px; font-size: 0.85em; }
.app-desc, .app-note { margin: 0; color: var(--color-text-muted); }
.app-inside { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.app-inside li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.inside-name { font-weight: 500; }
.inside-meta { color: var(--color-text-muted); font-size: 0.9em; }
.app-suggest { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px; border-radius: 8px; background: rgba(var(--primary-rgb), 0.06); }
.app-danger { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.app-danger small { color: var(--color-text-muted); }
@media (max-width: 720px) { .app-card.open { grid-column: auto; } }
</style>
