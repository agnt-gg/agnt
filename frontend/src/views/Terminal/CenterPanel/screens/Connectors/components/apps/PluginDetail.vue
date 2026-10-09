<!-- A plugin's detail: what it brings, how it signs in, who can use it, what
     access it declares, how it updates. The same view serves an installed
     plugin and a Market listing; actions differ, facts do not. Every fact comes
     from the plugin row, its installed assets, the sign-in catalogue or the
     agents store — nothing here is decorative. -->
<template>
  <article class="ap-plugin-detail" :data-plugin="plugin.name">
    <header class="ap-detail-head">
      <button v-if="groupCard" type="button" class="ap-link ap-crumb" data-action="open-account" @click="emit('open-account', groupCard.providerId)">
        <AppsIcon name="back" /> {{ groupCard.name }}
      </button>
      <div class="ap-identity">
        <span class="ap-logo large"><SvgIcon :name="plugin.icon || 'puzzle-piece'" /></span>
        <div>
          <h2 ref="heading" class="ap-detail-name" tabindex="-1">{{ plugin.displayName }}</h2>
          <p class="ap-sub">{{ subline }}</p>
        </div>
      </div>
      <div class="ap-detail-actions">
        <span v-if="tier" class="ap-badge" :class="tier.id" v-tooltip="tier.detail">{{ tier.label }}</span>
        <span v-if="pack" class="ap-badge pack">Capability pack</span>
        <span class="ap-grow"></span>
        <button v-if="plugin.installed" type="button" class="ap-btn small" data-action="open-forge" @click="emit('open-app')">Open in the Forge</button>
        <button v-else type="button" class="ap-btn primary" data-action="install" :disabled="installBusy" @click="emit('install')">
          {{ installing ? 'Checking…' : price ? `Get · ${price}` : `Install ${plugin.displayName}` }}
        </button>
      </div>
    </header>

    <div class="ap-detail-body">
      <section v-if="notice" class="ap-detail-section">
        <div class="ap-review" role="status">
          <h3>An update asks for new access</h3>
          <p class="ap-hint">Nothing was installed. You’re still on v{{ plugin.version }}.</p>
          <ul><li v-for="cap in notice.added" :key="cap">{{ capabilityLabel(cap) }}</li></ul>
          <div class="ap-detail-actions">
            <button type="button" class="ap-btn primary small" data-action="review-update" :disabled="!!busy" @click="emit('review-update')">{{ busy === 'update' ? 'Updating…' : 'Review and update' }}</button>
            <button type="button" class="ap-btn small" data-action="keep-version" :disabled="!!busy" @click="emit('keep-version')">Stay on v{{ plugin.version }}</button>
          </div>
        </div>
      </section>

      <section v-if="plugin.description" class="ap-detail-section">
        <p class="ap-hint">{{ plugin.description }}</p>
      </section>

      <section class="ap-detail-section">
        <h3>What’s inside <small v-if="itemCount">{{ itemCount }} {{ itemCount === 1 ? 'item' : 'items' }}</small></h3>
        <p v-if="plugin.installed && itemCount" class="ap-hint">Installed with the plugin. Each item also shows up on its own page.</p>
        <p v-if="assetsLoading" class="ap-hint" role="status">Loading installed contents…</p>
        <p v-if="assetsError" class="ap-hint" role="alert">{{ assetsError }} <button type="button" class="ap-link" @click="emit('retry-assets')">Retry</button></p>
        <div v-if="groups.length" class="ap-inside">
          <details v-for="(group, index) in groups" :key="`${plugin.name}:${group.key}`" class="ap-inside-group" :data-group="group.key" :open="index === 0">
            <summary>
              <span class="ap-inside-icon"><AppsIcon :name="group.icon" /></span>
              <span class="ap-inside-label"><strong>{{ group.label }}<span>{{ group.items.length }}</span></strong><small>{{ groupSummary(group) }}</small></span>
              <AppsIcon class="ap-inside-chevron" name="chevron" />
            </summary>
            <div class="ap-inside-items">
              <div v-for="item in group.items" :key="item.id" class="ap-inside-item" :data-item="item.id">
                <div>
                  <strong>{{ item.name }}</strong>
                  <small v-if="itemLine(group, item)">{{ itemLine(group, item) }}</small>
                  <div v-if="item.operations && item.operations.length" class="ap-ops">
                    <span v-for="operation in item.operations.slice(0, OPS_SHOWN)" :key="operation" class="ap-op">{{ operation }}</span>
                    <span v-if="item.operations.length > OPS_SHOWN" class="ap-op">+{{ item.operations.length - OPS_SHOWN }} more</span>
                  </div>
                </div>
                <button v-if="group.key === 'widgets' && installedWidgetIds.has(item.id)" type="button" class="ap-btn quiet small" data-action="open-widget" @click="emit('open-widget', item.id)">Open</button>
              </div>
            </div>
          </details>
        </div>
        <p v-else-if="!assetsLoading" class="ap-hint">The publisher hasn’t listed what’s inside yet.</p>
      </section>

      <section class="ap-detail-section" data-section="sign-in">
        <h3>Sign-in</h3>
        <p v-if="!connections.length" class="ap-hint">No sign-in needed. It works as soon as it’s installed.</p>
        <div v-for="connection in connections" :key="connection.providerId" class="ap-account" :class="{ attention: plugin.installed && connection.status !== 'connected' }" :data-provider="connection.providerId">
          <span class="ap-logo small"><SvgIcon :name="connection.icon" /></span>
          <div><strong>{{ connection.name }}</strong><small>{{ connectionLine(connection) }}</small></div>
          <span v-if="connection.status === 'connected'" class="ap-connected"><AppsIcon name="check" /><span class="ap-sr-only">Connected</span></span>
          <button v-else-if="isModelKey(connection)" type="button" class="ap-btn small" data-action="ai-models" @click="emit('open-ai-models')">Open AI Models</button>
          <button v-else type="button" class="ap-btn small" :class="{ primary: plugin.installed }" data-action="connect" :disabled="!connection.known" @click="emit(connection.status === 'reconnect' ? 'reconnect' : 'connect', connection)">
            {{ !connection.known ? 'Unavailable' : connection.status === 'reconnect' ? 'Reconnect' : 'Connect' }}
          </button>
        </div>
      </section>

      <section v-if="plugin.installed && hasTools" class="ap-detail-section" data-section="agents">
        <h3>Agents</h3>
        <p class="ap-hint">Chat can use its tools now. {{ openLine }}</p>
        <div v-if="agents.restricted.length" class="ap-pills">
          <span v-for="agent in agents.restricted" :key="agent.id" class="ap-pill"><AppsIcon name="agent" />{{ agent.name }}</span>
        </div>
        <p v-else class="ap-hint">No restricted agent has been given these tools yet.</p>
      </section>

      <section class="ap-detail-section" data-section="access">
        <h3>Access it declares</h3>
        <ul v-if="access.capabilities.length || access.domains.length" class="ap-caps">
          <li v-for="cap in access.capabilities" :key="cap" :class="{ undeclared: access.undeclared.includes(cap) }">
            <AppsIcon :name="capabilityIcon(cap)" />
            <div>
              {{ capabilityLabel(cap) }}
              <small v-if="cap === 'network' && access.domains.length">{{ access.domains.join(', ') }}</small>
              <small v-if="access.undeclared.includes(cap)">Not declared by the publisher</small>
            </div>
          </li>
          <li v-if="!access.capabilities.includes('network') && access.domains.length"><AppsIcon name="globe" /><div>Contacts {{ access.domains.join(', ') }}</div></li>
        </ul>
        <ul v-else-if="access.known" class="ap-caps">
          <li><AppsIcon name="check" /><div>Declares no special access<small>It works through AGNT’s own sign-in and tool runner.</small></div></li>
        </ul>
        <p v-else class="ap-hint">{{ plugin.installed ? 'No access was recorded for this plugin.' : 'The publisher hasn’t listed the access it needs. You’ll see the package check before you confirm.' }}</p>
        <dl v-if="tier || integrity" class="ap-kv">
          <template v-if="tier"><dt>Trust</dt><dd>{{ tier.label }} · {{ tier.detail }}</dd></template>
          <template v-if="integrity"><dt>Package</dt><dd>{{ integrity }}</dd></template>
        </dl>
        <p class="ap-hint">Plugins run code with access to your device. Only install from publishers you trust.</p>
      </section>

      <section v-if="plugin.installed" class="ap-detail-section" data-section="updates">
        <div class="ap-toggle-row">
          <div><strong>Update automatically</strong><small>An update that asks for new access always waits for you.</small></div>
          <button type="button" class="ap-switch" role="switch" :aria-checked="String(!pinned)" aria-label="Update automatically" :disabled="!!busy" @click="emit('set-policy', pinned ? 'auto' : 'pinned')"></button>
        </div>
      </section>

      <section class="ap-detail-section" data-section="package">
        <h3>Package</h3>
        <dl class="ap-kv">
          <dt>Publisher</dt><dd>{{ plugin.authorName || 'Not listed' }}</dd>
          <dt>Version</dt><dd>{{ plugin.version || 'Not listed' }}{{ plugin.installed && pinned ? ' (pinned)' : '' }}</dd>
          <template v-if="plugin.license"><dt>License</dt><dd>{{ plugin.license }}</dd></template>
          <dt>Category</dt><dd>{{ plugin.category }}</dd>
          <template v-if="!plugin.installed"><dt>Price</dt><dd>{{ price || 'Free' }}</dd></template>
        </dl>
      </section>

      <section v-if="plugin.installed" class="ap-detail-section">
        <button type="button" class="ap-btn quiet danger small" data-action="uninstall" :disabled="!!busy" @click="emit('uninstall')">{{ busy === 'uninstall' ? 'Uninstalling…' : `Uninstall ${plugin.displayName}` }}</button>
      </section>
    </div>
  </article>
</template>

<script setup>
import { computed, ref } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsIcon from '../AppsIcon.vue';
import {
  pluginInventory, declaredAccess, capabilityLabel, CAPABILITIES, trustTier, integrityLabel, isPack, priceLabel,
} from '@/services/pluginDirectory.js';

const OPS_SHOWN = 12;
const props = defineProps({
  plugin: { type: Object, required: true },
  assets: { type: Array, default: () => [] },
  assetsLoading: Boolean,
  assetsError: { type: String, default: '' },
  connections: { type: Array, default: () => [] },
  /** The card this plugin sits in, when it shares a sign-in with others. */
  card: { type: Object, default: null },
  notice: { type: Object, default: null },
  agents: { type: Object, default: () => ({ openCount: 0, restricted: [] }) },
  modelProviderIds: { type: Array, default: () => [] },
  installing: Boolean,
  installBusy: Boolean,
  busy: { type: String, default: null },
  installedWidgetIds: { type: Set, default: () => new Set() },
});
const emit = defineEmits(['install', 'connect', 'reconnect', 'open-app', 'open-widget', 'retry-assets', 'review-update', 'keep-version', 'set-policy', 'uninstall', 'open-account', 'open-ai-models']);
const heading = ref(null);
defineExpose({ focus: () => heading.value?.focus({ preventScroll: true }) });

const groups = computed(() => pluginInventory(props.plugin, props.assets).filter((group) => group.items.length));
const itemCount = computed(() => groups.value.reduce((total, group) => total + group.items.length, 0));
const hasTools = computed(() => Array.isArray(props.plugin.tools) && props.plugin.tools.length > 0);
const access = computed(() => declaredAccess(props.plugin));
const tier = computed(() => trustTier(props.plugin));
const integrity = computed(() => (props.plugin.installed ? integrityLabel(props.plugin.integrityState) : ''));
const pack = computed(() => isPack(props.plugin));
const price = computed(() => priceLabel(props.plugin));
const pinned = computed(() => props.plugin.updatePolicy === 'pinned');
const groupCard = computed(() => (props.card?.kind === 'account' && props.card.apps?.length > 1 ? props.card : null));

const subline = computed(() => {
  const parts = [];
  if (props.plugin.authorName) parts.push(`by ${props.plugin.authorName}`);
  if (props.plugin.version) parts.push(`v${props.plugin.version}`);
  if (!props.plugin.installed) parts.push(price.value || 'Free');
  return parts.join(' · ');
});
const openLine = computed(() => {
  const n = props.agents.openCount;
  if (!n) return 'Agents set to Open tool access get them automatically.';
  return `${n} ${n === 1 ? 'agent has' : 'agents have'} Open tool access and get${n === 1 ? 's' : ''} them automatically.`;
});

const capabilityIcon = (id) => CAPABILITIES[id]?.icon || 'shield';
const isModelKey = (connection) => props.modelProviderIds.includes(String(connection.providerId).toLowerCase());

function groupSummary(group) {
  if (group.key === 'tools') {
    return group.items.map((item) => (item.operations.length ? `${item.name} · ${item.operations.length} operations` : item.name)).join(', ');
  }
  return group.items.map((item) => item.name).join(' · ');
}
function itemLine(group, item) {
  if (group.key === 'tools' || group.key === 'triggers') {
    if (item.operations?.length) return `${item.operations.length} ${group.key === 'tools' ? 'operations agents can call' : 'events'}`;
    return item.description;
  }
  return item.description;
}
function connectionLine(connection) {
  if (isModelKey(connection)) return 'Billed through an AI model key in Settings › AI Models';
  if (connection.status === 'reconnect') return 'Sign-in stopped working. Reconnect to keep it running.';
  if (connection.status === 'connect') return props.plugin.installed ? 'Its tools can’t run until you connect.' : 'You’ll connect after installing.';
  const others = props.card && props.card.providerId === connection.providerId
    ? props.card.apps.filter((app) => app.name !== props.plugin.name).map((app) => app.displayName)
    : [];
  return others.length ? `Connected · also turns on ${others.join(', ')}` : 'Connected';
}
</script>
