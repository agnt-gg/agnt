<!-- A sign-in's detail: one card from services/appCards. Shows what this one
     sign-in turns on, what else it could turn on with no new sign-in, and the
     connect / reconnect / sign-out actions. The flows themselves belong to the
     host (Studio's Connectors, Focused's account page). -->
<template>
  <article class="ap-account-detail" :data-account="card.providerId">
    <header class="ap-detail-head">
      <div class="ap-identity">
        <span class="ap-logo large"><SvgIcon :name="card.icon || 'connect'" /></span>
        <div>
          <h2 ref="heading" class="ap-detail-name" tabindex="-1">{{ card.name }}</h2>
          <p class="ap-sub">{{ kind }}<template v-if="plugins.length"> · turns on {{ plugins.length }} {{ plugins.length === 1 ? 'plugin' : 'plugins' }}</template></p>
        </div>
      </div>
      <div class="ap-detail-actions">
        <span class="ap-status" :class="statusView.tone">{{ statusView.label }}</span>
        <span class="ap-grow"></span>
        <button v-if="card.status === 'connect'" type="button" class="ap-btn primary small" data-action="connect" @click="emit('connect', card)">Connect {{ card.name }}</button>
        <button v-else-if="card.status === 'reconnect'" type="button" class="ap-btn primary small" data-action="reconnect" @click="emit('reconnect', card)">Reconnect</button>
        <button v-else type="button" class="ap-btn small" data-action="reconnect" @click="emit('reconnect', card)">{{ card.connectionType === 'apikey' ? 'Replace key' : 'Sign in again' }}</button>
      </div>
    </header>

    <div class="ap-detail-body">
      <section class="ap-detail-section" data-section="turns-on">
        <h3>Turns on <small v-if="plugins.length">{{ plugins.length }} {{ plugins.length === 1 ? 'plugin' : 'plugins' }}</small></h3>
        <p v-if="!plugins.length" class="ap-hint">No installed plugin uses it. Agents can still reach it through Custom API.</p>
        <div v-else class="ap-inside">
          <div v-for="plugin in plugins" :key="plugin.name" class="ap-inside-group">
            <button type="button" class="ap-account-plugin" :data-plugin="plugin.name" @click="emit('open-plugin', plugin.name)">
              <span class="ap-logo small"><SvgIcon :name="plugin.icon || card.icon || 'puzzle-piece'" /></span>
              <span class="ap-inside-label"><strong>{{ plugin.displayName }}</strong><small>{{ plugin.line }}</small></span>
              <AppsIcon class="ap-inside-chevron" name="chevron" />
            </button>
          </div>
        </div>
      </section>

      <section v-if="suggested.length" class="ap-detail-section" data-section="suggested">
        <h3>Also ready with this sign-in</h3>
        <p class="ap-hint">Install one and it works right away, with no new sign-in.</p>
        <div class="ap-inside">
          <div v-for="item in suggested" :key="item.name" class="ap-inside-group">
            <div class="ap-account-plugin">
              <span class="ap-logo small"><SvgIcon :name="item.icon || card.icon || 'puzzle-piece'" /></span>
              <span class="ap-inside-label"><strong>{{ item.displayName }}</strong><small>{{ item.description }}</small></span>
              <span v-if="item.installed" class="ap-installed"><AppsIcon name="check" />Installed</span>
              <button v-else type="button" class="ap-btn small" data-action="install" :disabled="installBusy" @click="emit('install', item.name)">{{ installingName === item.name ? 'Checking…' : 'Install' }}</button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="card.status !== 'connect'" class="ap-detail-section">
        <button type="button" class="ap-btn quiet danger small" data-action="disconnect" @click="emit('disconnect', card)">{{ card.connectionType === 'apikey' ? `Remove the ${card.name} key` : `Sign out of ${card.name}` }}</button>
        <p v-if="stops" class="ap-hint">{{ stops }} will stop working until you connect again.</p>
      </section>
    </div>
  </article>
</template>

<script setup>
import { computed, ref } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsIcon from '../AppsIcon.vue';
import { describeApps } from '@/services/appCards.js';
import { connectionKind, pluginInventory, compositionOf } from '@/services/pluginDirectory.js';

const props = defineProps({
  card: { type: Object, required: true },
  /** Catalog rows by plugin name, for each plugin's contents. */
  rows: { type: Map, required: true },
  notices: { type: Map, default: () => new Map() },
  installBusy: Boolean,
  installingName: { type: String, default: null },
});
const emit = defineEmits(['connect', 'reconnect', 'disconnect', 'open-plugin', 'install']);
const heading = ref(null);
defineExpose({ focus: () => heading.value?.focus({ preventScroll: true }) });

const kind = computed(() => connectionKind(props.card.connectionType));
const stops = computed(() => describeApps(props.card));
const plugins = computed(() => props.card.apps.map((app) => {
  const row = props.rows.get(app.name);
  const parts = row ? compositionOf(pluginInventory(row)).map((part) => part.label) : [];
  if (props.notices.has(app.name)) parts.push('update needs review');
  return { name: app.name, displayName: app.displayName, icon: app.icon, line: parts.join(' · ') || app.description };
}));
const suggested = computed(() => (props.card.suggested || []).map((item) => {
  const row = props.rows.get(item.name);
  return { name: item.name, displayName: item.displayName, icon: row?.icon || '', description: row?.description || '', installed: !!row?.installed };
}));
const statusView = computed(() => {
  if (props.card.status === 'reconnect') return { tone: 'bad', label: 'Sign-in stopped working' };
  if (props.card.status === 'connect') return { tone: 'warn', label: 'Not connected' };
  return { tone: 'ok', label: 'Connected' };
});
</script>

<style scoped>
.ap-account-plugin { display: flex; width: 100%; align-items: center; gap: var(--spacing-sm); min-height: 52px; padding: var(--spacing-sm); border: 0; background: none; text-align: left; }
button.ap-account-plugin:hover { background: var(--surface-hover); }
</style>
