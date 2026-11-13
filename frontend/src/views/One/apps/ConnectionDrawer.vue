<template>
  <AppsDrawer :title="row.name" @close="emit('close')">
    <template #logo><span class="logo lg"><SvgIcon :name="row.icon" /></span></template>
    <template #sub>
      <span>{{ row.appName }} · {{ row.kind }}</span>
      <span v-if="row.ai" class="tag blue">AI model</span>
      <span v-if="row.local" class="tag">On this computer</span>
      <span v-if="row.fromPlugin" class="tag">Plugin sign-in</span>
      <span v-if="row.custom" class="tag">Custom app</span>
      <span v-if="row.team" class="tag">Team</span>
    </template>

    <div class="dr-status" :class="status.tone === 'ok' ? '' : status.tone" data-section="status">
      <span class="dot" :class="status.tone"></span>
      <div class="grow">
        <strong>{{ status.label }}</strong>
        <small v-for="(line, index) in statusLines" :key="index">{{ line }}</small>
      </div>
      <button v-if="busy" type="button" class="btn sm" disabled>{{ busy === 'test' ? 'Testing…' : 'Signing in…' }}</button>
      <button v-else-if="row.status === 'reconnect'" type="button" class="primary sm" data-action="signin" @click="emit('act', 'signin', row)">Reconnect</button>
      <button v-else-if="row.status === 'connect'" type="button" class="primary sm" data-action="signin" @click="emit('act', 'signin', row)">Connect</button>
      <button v-else-if="row.testable" type="button" class="btn sm" data-action="test" @click="emit('act', 'test', row)">Test connection</button>
    </div>

    <section class="dr-sec">
      <h4>Details</h4>
      <dl class="kv">
        <template v-if="row.appName !== row.name"><dt>App</dt><dd>{{ row.appName }}</dd></template>
        <dt>Connects with</dt><dd>{{ row.kind }}{{ row.local ? ' · on this computer' : '' }}</dd>
        <template v-if="row.identity"><dt>Signed in as</dt><dd class="ellipsis">{{ row.identity }}</dd></template>
        <template v-if="row.fromPlugin"><dt>Added by</dt><dd>{{ row.fromPlugin }} plugin</dd></template>
        <template v-else-if="row.custom"><dt>Added by</dt><dd>You, as a custom app</dd></template>
        <template v-if="!row.team"><dt>Last checked</dt><dd>{{ row.checked ? formatWhen(row.checked) : '—' }}</dd></template>
        <dt>Access</dt>
        <dd class="row-gap">
          <template v-if="row.team">
            <span class="stack"><span v-for="(person, index) in members.slice(0, 4)" :key="index" class="av" :class="tones[index % 4]">{{ initials(person.name) }}</span></span>
            <span>{{ teamName }}</span>
          </template>
          <template v-else><span class="av">{{ initials(userName) }}</span><span>Only you</span></template>
        </dd>
      </dl>
    </section>

    <section class="dr-sec" data-section="used-by">
      <h4>Used by{{ !row.ai && !row.team && row.apps.length ? ` · ${row.apps.length}` : '' }}</h4>
      <div v-if="row.ai" class="dr-card">
        <div class="dr-row">
          <span class="logo sm"><AppsGlyph name="bot" size="xs" /></span>
          <div class="grow"><strong>Annie and your agents</strong><small>Model keys and sign-ins are managed in Settings › AI models</small></div>
          <button type="button" class="btn sm" data-action="ai-models" @click="emit('act', 'ai-models', row)">Open AI models</button>
        </div>
      </div>
      <div v-else-if="row.team" class="dr-card">
        <div class="dr-row">
          <span class="logo sm"><AppsGlyph name="routines" size="xs" /></span>
          <div class="grow"><strong>{{ teamName }} automations</strong><small>Teammates use it without seeing the credentials</small></div>
        </div>
      </div>
      <div v-else-if="row.apps.length" class="dr-card">
        <button v-for="app in row.apps" :key="app.name" type="button" class="dr-row" :data-plugin="app.name" @click="emit('act', 'open-plugin', row, app.name)">
          <span class="logo sm"><SvgIcon :name="app.icon" /></span>
          <div class="grow"><strong>{{ app.label }}</strong><small>{{ plural(app.tools, 'tool') }}</small></div>
          <AppsGlyph name="chev" size="sm" />
        </button>
      </div>
      <p v-else class="muted dr-desc">No plugin uses it yet. Annie can still call it through custom tools.</p>
    </section>

    <section v-if="row.suggested.length && !row.team" class="dr-sec" data-section="suggested">
      <h4>More for {{ row.appName }}</h4>
      <div class="dr-card">
        <div v-for="plugin in row.suggested" :key="plugin.name" class="dr-row">
          <span class="logo sm"><AppsGlyph name="puzzle" size="xs" /></span>
          <div class="grow"><strong>{{ plugin.displayName }}</strong><small>On the Market · uses this connection</small></div>
          <button type="button" class="btn sm" :data-market="plugin.name" @click="emit('act', 'market', row, plugin.name)">View</button>
        </div>
      </div>
    </section>

    <template #foot>
      <button v-if="row.status === 'ready' && !row.ai && !row.team && !busy" type="button" class="btn" data-action="reconnect" @click="emit('act', 'signin', row)">
        <AppsGlyph name="refresh" size="sm" />Reconnect
      </button>
      <button v-if="row.custom" type="button" class="btn" data-action="edit-app" @click="emit('act', 'edit-app', row)"><AppsGlyph name="pen" size="sm" />Edit app</button>
      <span class="grow"></span>
      <button v-if="row.status !== 'connect' && (!row.team || canManage)" type="button" class="btn danger" data-action="disconnect" @click="emit('act', 'disconnect', row)">
        <AppsGlyph name="trash" size="sm" />Disconnect
      </button>
    </template>
  </AppsDrawer>
</template>

<script setup>
// A connection's details: whether it works, who it is signed in as, and what uses it.
import { computed } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsDrawer from './AppsDrawer.vue';
import AppsGlyph from './AppsGlyph.vue';
import { CONNECTION_STATUS, formatWhen, initials, plural } from './appsModel.js';

const props = defineProps({
  row: { type: Object, required: true },
  busy: { type: String, default: null },
  userName: { type: String, default: 'You' },
  teamName: { type: String, default: 'Team' },
  members: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false },
});
const emit = defineEmits(['act', 'close']);
const tones = ['', 'b', 'c', 'd'];

const status = computed(() => CONNECTION_STATUS[props.row.status] || CONNECTION_STATUS.ready);
const statusLines = computed(() => {
  const { row } = props;
  const checked = row.checked ? `Checked ${formatWhen(row.checked)}` : '';
  if (row.team) return ['Shared with the team'];
  if (row.status === 'ready') return [checked || 'Working'];
  if (row.status === 'reconnect') return [row.problem || 'It stopped working', checked].filter(Boolean);
  const needs = row.apps.map((app) => app.label);
  return [needs.length ? `${needs.join(', ')} ${needs.length === 1 ? 'needs' : 'need'} it` : 'Not connected yet'];
});
</script>
