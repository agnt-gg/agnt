<!-- One row on the Installed tab: a card from services/appCards.
     Three shapes, one per kind of thing a person connected:
       • several plugins on one sign-in (Google → Gmail, Calendar, Drive…)
       • one plugin (shown as the plugin; its sign-in is a line under it)
       • a sign-in with no plugin (used through Custom API) -->
<template>
  <div class="ap-row" :class="{ selected }" :data-card="card.id" :data-app="solo ? solo.name : null">
    <span class="ap-logo"><SvgIcon :name="(solo && solo.icon) || card.icon || 'puzzle-piece'" /></span>
    <div class="ap-row-body">
      <div class="ap-row-title">
        <button type="button" class="ap-row-open" @click="openSelf">{{ solo ? solo.displayName : card.name }}</button>
        <span v-if="solo && soloIsPack" class="ap-badge pack">Capability pack</span>
        <span v-if="soloTier" class="ap-badge" :class="soloTier.id" v-tooltip="soloTier.detail">{{ soloTier.label }}</span>
        <span v-if="!card.apps.length" class="ap-badge">{{ kind }}</span>
      </div>
      <p v-if="solo && solo.description" class="ap-row-desc">{{ solo.description }}</p>
      <p v-else-if="!card.apps.length" class="ap-row-desc">No plugin uses it. Agents can still reach it through Custom API.</p>
      <div v-if="card.apps.length > 1" class="ap-plugin-strip">
        <button v-for="app in card.apps" :key="app.name" type="button" class="ap-plugin-chip" :data-plugin="app.name" @click="emit('open-plugin', app.name)">
          <span class="ap-logo"><SvgIcon :name="app.icon || card.icon || 'puzzle-piece'" /></span>{{ shortName(app.displayName) }}
        </button>
      </div>
      <div class="ap-row-meta">
        <span v-if="card.apps.length > 1" class="ap-meta-item">{{ card.apps.length }} plugins on one sign-in</span>
        <span v-for="part in composition" :key="part.key" class="ap-meta-item"><AppsIcon :name="part.icon" />{{ part.label }}</span>
        <span v-if="solo && card.kind === 'account'" class="ap-meta-item">Uses your {{ card.name }} sign-in</span>
        <span v-else-if="solo && card.usesModelKey" class="ap-meta-item">Billed through an AI model key</span>
        <span v-else-if="solo && !card.providerId" class="ap-meta-item">No sign-in needed</span>
        <span v-if="soloRow && soloRow.updatePolicy === 'pinned'" class="ap-meta-item">Pinned to v{{ soloRow.version }}</span>
      </div>
    </div>
    <div class="ap-row-side">
      <span class="ap-status" :class="statusView.tone">{{ statusView.label }}</span>
      <button v-if="card.status === 'reconnect'" type="button" class="ap-btn primary small" data-action="reconnect" @click="emit('reconnect', card)">Reconnect {{ card.name }}</button>
      <button v-else-if="card.status === 'connect' && card.usesModelKey" type="button" class="ap-btn primary small" data-action="ai-models" @click="emit('open-ai-models')">Open AI Models</button>
      <button v-else-if="card.status === 'connect'" type="button" class="ap-btn primary small" data-action="connect" @click="emit('connect', card)">Connect {{ card.name }}</button>
      <button v-else-if="reviewName" type="button" class="ap-btn small" data-action="review" @click="emit('open-plugin', reviewName)">Review update</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsIcon from '../AppsIcon.vue';
import { pluginInventory, compositionOf, isPack, trustTier, connectionKind, INVENTORY_GROUPS } from '@/services/pluginDirectory.js';

const props = defineProps({
  card: { type: Object, required: true },
  rows: { type: Map, required: true },
  notices: { type: Map, required: true },
  selectedKey: { type: String, default: null },
});
const emit = defineEmits(['open-card', 'open-plugin', 'connect', 'reconnect', 'open-ai-models']);

const solo = computed(() => (props.card.apps.length === 1 ? props.card.apps[0] : null));
const soloRow = computed(() => (solo.value ? props.rows.get(solo.value.name) || null : null));
const soloIsPack = computed(() => !!soloRow.value && isPack(soloRow.value));
const soloTier = computed(() => (soloRow.value ? trustTier(soloRow.value) : null));
const kind = computed(() => connectionKind(props.card.connectionType));
const selected = computed(() => props.selectedKey === props.card.id || props.card.apps.some((app) => app.name === props.selectedKey));
const reviewName = computed(() => props.card.apps.find((app) => props.notices.has(app.name))?.name || null);

// Summed across the card's plugins: "12 tools · 3 triggers".
const composition = computed(() => {
  const totals = new Map();
  for (const app of props.card.apps) {
    const row = props.rows.get(app.name);
    if (!row) continue;
    for (const part of compositionOf(pluginInventory(row))) {
      const group = INVENTORY_GROUPS.find((g) => g.key === part.key);
      const count = (totals.get(part.key)?.count || 0) + part.count;
      totals.set(part.key, { key: part.key, icon: part.icon, count, label: `${count} ${count === 1 ? group.one : group.label.toLowerCase()}` });
    }
  }
  return INVENTORY_GROUPS.map((group) => totals.get(group.key)).filter(Boolean);
});

const statusView = computed(() => {
  if (props.card.status === 'reconnect') return { tone: 'bad', label: 'Sign-in stopped working' };
  if (props.card.status === 'connect') return { tone: 'warn', label: 'Not connected' };
  if (reviewName.value) return { tone: 'warn', label: 'Update needs review' };
  return { tone: 'ok', label: 'Ready' };
});

function shortName(name) {
  // "Google Calendar" on a Google card reads as "Calendar".
  const prefix = `${props.card.name} `;
  return name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
}
function openSelf() {
  if (solo.value) emit('open-plugin', solo.value.name);
  else emit('open-card', props.card);
}
</script>
