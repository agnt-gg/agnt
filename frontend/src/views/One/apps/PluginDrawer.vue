<template>
  <AppsDrawer :title="row.label" @close="emit('close')">
    <template #logo><span class="logo lg"><SvgIcon :name="row.icon" /></span></template>
    <template #sub>
      <span>{{ row.kind }}<template v-if="row.version"> · <span class="mono">{{ row.version }}</span></template></span>
      <span class="tag" :class="trustTone" v-tooltip="TRUST_DETAIL[row.trust]">{{ row.trust }}</span>
      <span v-if="row.triggers" class="tag blue">Has triggers</span>
    </template>

    <div class="dr-status" :class="['bad', 'warn'].includes(status.tone) ? status.tone : ''" data-section="status">
      <span class="dot" :class="status.tone"></span>
      <div class="grow"><strong>{{ status.label }}</strong><small>{{ statusLine }}</small></div>
      <button v-if="busy === 'signin'" type="button" class="btn sm" disabled>Signing in…</button>
      <button v-else-if="row.status === 'reconnect'" type="button" class="primary sm" data-action="signin" @click="emit('act', 'signin', row)">Reconnect</button>
      <button v-else-if="row.status === 'connect'" type="button" class="primary sm" data-action="signin" @click="emit('act', 'signin', row)">Connect</button>
      <button v-else-if="row.status === 'ready'" type="button" class="btn sm" data-action="try" @click="emit('act', 'try', row)">Try</button>
    </div>

    <p v-if="row.desc" class="dr-desc">{{ row.desc }}</p>

    <div v-if="row.update" class="dr-status" data-section="update">
      <span class="logo sm"><AppsGlyph name="update" size="xs" /></span>
      <div class="grow"><strong>Version {{ row.update }} is available</strong><small>You have {{ row.version || 'an older version' }}</small></div>
      <button type="button" class="btn sm" data-action="update" :disabled="busy === 'update'" @click="emit('act', 'update', row)">{{ busy === 'update' ? 'Updating…' : 'Update' }}</button>
    </div>

    <section v-if="row.provider" class="dr-sec" data-section="signs-in">
      <h4>Signs in with</h4>
      <div class="dr-card">
        <div v-if="row.provider.model" class="dr-row">
          <span class="logo sm"><AppsGlyph name="bot" size="xs" /></span>
          <div class="grow"><strong>Your AI model</strong><small>Uses the model key in Settings › AI models</small></div>
        </div>
        <button v-else type="button" class="dr-row" data-action="open-connection" @click="emit('act', 'open-connection', row)">
          <span class="logo sm"><SvgIcon :name="row.provider.icon" /></span>
          <div class="grow"><strong>{{ row.provider.name }}</strong><small>{{ connectionStatus.label }}</small></div>
          <span class="dot" :class="connectionStatus.tone"></span>
          <AppsGlyph name="chev" size="sm" />
        </button>
      </div>
    </section>

    <section v-if="row.contents.length" class="dr-sec" data-section="contents">
      <h4>What’s inside</h4>
      <div class="dr-card">
        <div v-for="group in row.contents" :key="group.key" class="dr-row" :data-group="group.key">
          <div class="grow"><strong>{{ GROUP_TITLES[group.key] || group.key }}</strong></div>
          <span class="muted">{{ group.count }}</span>
        </div>
      </div>
    </section>

    <section class="dr-sec">
      <h4>Details</h4>
      <dl class="kv">
        <dt>Kind</dt><dd>{{ row.kind }}</dd>
        <dt>Published by</dt><dd>{{ row.trust }}<template v-if="TRUST_DETAIL[row.trust]"> · {{ TRUST_DETAIL[row.trust] }}</template></dd>
        <template v-if="row.author"><dt>Author</dt><dd class="ellipsis">{{ row.author }}</dd></template>
        <dt>Installed</dt><dd>{{ formatDate(row.installedAt) }}</dd>
        <dt>Last updated</dt><dd>{{ formatDate(row.updated) }}</dd>
      </dl>
    </section>

    <template #foot>
      <button v-if="row.status === 'ready'" type="button" class="primary" data-action="try" @click="emit('act', 'try', row)"><AppsGlyph name="chats" size="sm" />Try with Annie</button>
      <button type="button" class="btn" data-action="details" @click="emit('act', 'details', row)"><AppsGlyph name="external" size="sm" />Full details</button>
      <span class="grow"></span>
      <button type="button" class="btn danger" data-action="uninstall" :disabled="busy === 'uninstall'" @click="emit('act', 'uninstall', row)">
        <AppsGlyph name="trash" size="sm" />{{ busy === 'uninstall' ? 'Uninstalling…' : 'Uninstall' }}
      </button>
    </template>
  </AppsDrawer>
</template>

<script setup>
// An installed plugin at a glance: whether it can run, the sign-in it needs, what it holds.
import { computed } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsDrawer from './AppsDrawer.vue';
import AppsGlyph from './AppsGlyph.vue';
import { CONNECTION_STATUS, PLUGIN_STATUS, TRUST_DETAIL, formatDate } from './appsModel.js';

const props = defineProps({
  row: { type: Object, required: true },
  connection: { type: Object, default: null },
  busy: { type: String, default: null },
});
const emit = defineEmits(['act', 'close']);

const GROUP_TITLES = Object.freeze({ tools: 'Actions', triggers: 'Triggers', agents: 'Assistants', workflows: 'Automations', skills: 'Playbooks', widgets: 'Dashboard cards' });
const TRUST_TONES = Object.freeze({ Unverified: 'amber', Unaudited: 'red' });

const status = computed(() => PLUGIN_STATUS[props.row.status] || PLUGIN_STATUS.ready);
const trustTone = computed(() => TRUST_TONES[props.row.trust] || '');
const connectionStatus = computed(() => (props.connection ? CONNECTION_STATUS[props.connection.status] : CONNECTION_STATUS.connect));
const statusLine = computed(() => {
  const name = props.row.provider?.name;
  return {
    ready: 'Ask Annie to use it, or add it to an assistant',
    reconnect: `Its ${name} sign-in stopped working`,
    connect: `Connect ${name} to use it`,
    off: 'Annie and your assistants cannot use it',
  }[props.row.status];
});
</script>
