<template>
  <div class="page" data-section="connections">
    <div class="page-head">
      <div class="row-gap head-title">
        <h1>Connections</h1>
        <div v-if="teamName" class="seg" role="tablist" aria-label="Whose connections">
          <button type="button" role="tab" :class="{ on: !team }" :aria-selected="!team" data-scope="personal" @click="emit('act', 'scope', 'personal')">Personal</button>
          <button type="button" role="tab" :class="{ on: team }" :aria-selected="team" data-scope="team" @click="emit('act', 'scope', 'team')">{{ teamName }}</button>
        </div>
      </div>
      <div class="row-gap">
        <button v-if="!team || canManage" type="button" class="primary" data-action="add" @click="emit('act', 'add')">
          <AppsGlyph name="plus" size="sm" />{{ team ? 'Connect for the team' : 'Add connection' }}
        </button>
      </div>
    </div>

    <AppsList :rows="rows" :spec="LISTS.connections" :heads="heads" label="Connections" noun="connection" :flash-id="flashId" @open="(row) => emit('act', 'open', row)">
      <template #empty>
        <div class="tbl">
          <div class="empty" data-section="empty">
            <span class="em-icon"><AppsGlyph :name="team ? 'users' : 'plug'" /></span>
            <template v-if="team">
              <h3>No team connections yet</h3>
              <p>Accounts {{ teamName }}’s automations can use, such as GitHub or a model provider. Teammates use them without ever seeing the credentials, and personal connections never leave their owner’s space.</p>
            </template>
            <template v-else>
              <h3>Nothing connected yet</h3>
              <p>Connect the apps you use, and Annie and your agents can work in them.</p>
            </template>
            <div v-if="!team || canManage" class="row-gap">
              <button type="button" class="primary" data-action="add" @click="emit('act', 'add')"><AppsGlyph name="plus" size="sm" />{{ team ? 'Connect for the team' : 'Add connection' }}</button>
            </div>
          </div>
        </div>
      </template>

      <template #cell-name="{ row }">
        <div class="name">
          <span class="logo"><SvgIcon :name="row.icon" /></span>
          <div class="name-text"><strong>{{ row.name }}</strong><small v-if="row.identity">{{ row.identity }}</small></div>
        </div>
      </template>
      <template #cell-app="{ row }">
        <div class="app-cell">
          <div class="app-line"><span>{{ row.appName }}</span><span class="ver">{{ row.kind }}</span></div>
          <div v-if="tagsOf(row).length" class="tags">
            <span v-for="tag in tagsOf(row)" :key="tag.label" class="tag" :class="tag.tone" v-tooltip="tag.tip">{{ tag.label }}</span>
          </div>
        </div>
      </template>
      <template #cell-status="{ row }">
        <div v-if="busy[row.id]" class="st busy"><span class="dot"></span><span>{{ busy[row.id] === 'test' ? 'Testing…' : 'Signing in…' }}</span></div>
        <div v-else class="st" :class="[statusOf(row).tone, { 'has-act': hasAction(row) }]">
          <span class="dot"></span>
          <span class="st-l"><span>{{ statusOf(row).label }}</span><span class="tip-i" v-tooltip="tipOf(row)"><AppsGlyph name="info" size="xs" /></span></span>
          <button v-if="row.status === 'reconnect'" type="button" class="primary sm act" data-action="signin" @click="emit('act', 'signin', row)">Reconnect</button>
          <button v-else-if="row.status === 'connect'" type="button" class="primary sm act" data-action="signin" @click="emit('act', 'signin', row)">Connect</button>
          <button v-else-if="row.testable" type="button" class="btn sm act" data-action="test" @click="emit('act', 'test', row)">Test connection</button>
        </div>
      </template>
      <template #cell-used="{ row }">
        <span v-if="row.team" class="use"><AppsGlyph name="routines" />Team automations</span>
        <span v-else-if="row.ai" class="use" v-tooltip="'Powers Annie and your agents'"><AppsGlyph name="bot" />Annie &amp; agents</span>
        <button v-else-if="row.apps.length" type="button" class="use" data-action="show-plugins" v-tooltip="row.apps.map((app) => app.label).join(', ')" @click="emit('act', 'show-plugins', row)">
          <AppsGlyph name="puzzle" />Plugins {{ row.apps.length }}
        </button>
        <span v-else class="use zero" v-tooltip="'No plugin uses it yet'"><AppsGlyph name="puzzle" />Plugins 0</span>
      </template>
      <template #cell-checked="{ row }">
        <span>{{ row.team || row.status === 'connect' ? '—' : formatChecked(row.checked) }}</span>
      </template>
      <template #cell-access="{ row }">
        <span v-if="row.team" v-tooltip="`${teamName || 'Team'} · ${plural(members.length, 'member')}`" class="stack">
          <span v-for="(person, index) in members.slice(0, 4)" :key="index" class="av" :class="TONES[index % 4]">{{ initials(person.name) }}</span>
        </span>
        <span v-else class="av" v-tooltip="'Only you'">{{ initials(userName) }}</span>
      </template>

      <template #menu="{ row }">
        <button type="button" class="mi" role="menuitem" data-action="open" @click="emit('act', 'open', row)"><AppsGlyph name="doc" />Open details</button>
        <button v-if="row.testable && row.status === 'ready'" type="button" class="mi" role="menuitem" data-action="test" @click="emit('act', 'test', row)"><AppsGlyph name="refresh" />Test connection</button>
        <button v-if="row.status !== 'ready'" type="button" class="mi" role="menuitem" data-action="signin" @click="emit('act', 'signin', row)"><AppsGlyph name="plug" />{{ row.status === 'reconnect' ? 'Reconnect' : 'Connect' }}</button>
        <button v-if="row.ai" type="button" class="mi" role="menuitem" data-action="ai-models" @click="emit('act', 'ai-models', row)"><AppsGlyph name="settings" />Open AI models</button>
        <button v-else-if="row.apps.length" type="button" class="mi" role="menuitem" data-action="show-plugins" @click="emit('act', 'show-plugins', row)"><AppsGlyph name="puzzle" />Show plugins ({{ row.apps.length }})</button>
        <template v-if="row.status !== 'connect' && (!row.team || canManage)">
          <div class="mi-sep"></div>
          <button type="button" class="mi danger" role="menuitem" data-action="disconnect" @click="emit('act', 'disconnect', row)"><AppsGlyph name="trash" />Disconnect</button>
        </template>
      </template>

      <template #bulk="{ rows: chosen, clear }">
        <button type="button" class="btn sm" data-action="bulk-test" @click="emit('act', 'bulk-test', chosen, clear)"><AppsGlyph name="refresh" size="xs" />Test connections</button>
        <button v-if="!team || canManage" type="button" class="btn sm danger" data-action="bulk-disconnect" @click="emit('act', 'bulk-disconnect', chosen, clear)">Disconnect</button>
      </template>

      <template #foot="{ rows: shownRows, all }">
        <span>{{ plural(shownRows.length, 'connection') }}{{ shownRows.length !== all.length ? ` of ${all.length}` : '' }}{{ lastChecked ? ` · Last checked ${formatWhen(lastChecked)}` : '' }}</span>
        <button v-if="!team" type="button" class="btn sm" data-action="check-all" :disabled="checking" @click="emit('act', 'check-all')">
          <AppsGlyph name="refresh" size="xs" />{{ checking ? 'Checking…' : 'Check all' }}
        </button>
      </template>
    </AppsList>
  </div>
</template>

<script setup>
// App connections: every sign-in and key AGNT holds for you (or for your team),
// whether it works, and what uses it. The section reports clicks; OneApps acts.
import { computed } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsGlyph from './AppsGlyph.vue';
import AppsList from './AppsList.vue';
import { CONNECTION_STATUS, LISTS, formatChecked, formatWhen, initials, listNames, plural } from './appsModel.js';

const props = defineProps({
  rows: { type: Array, required: true },
  // 'personal', or 'team' for the team's shared connections
  scope: { type: String, default: 'personal' },
  // The team you belong to, if any; offers the switch between the two.
  teamName: { type: String, default: '' },
  members: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false },
  userName: { type: String, default: 'You' },
  busy: { type: Object, default: () => ({}) },
  checking: { type: Boolean, default: false },
  flashId: { type: String, default: null },
});
const emit = defineEmits(['act']);

const TONES = ['', 'b', 'c', 'd'];
const HEADS = [
  { id: 'name', label: 'Name', min: 190, fr: 1.6 },
  { id: 'app', label: 'App', min: 110, fr: 1.15, drop: 2 },
  { id: 'status', label: 'Status', min: 270, fr: 1.2 },
  { id: 'used', label: 'Used by', min: 130, fr: 0.8, tip: 'Plugins that sign in with this connection', drop: 1 },
  { id: 'checked', label: 'Last checked', min: 116, fr: 0.75, tip: 'When AGNT last checked that this connection works', drop: 3 },
  { id: 'access', label: 'Access', min: 52, fr: 0.45, sort: false, drop: 4 },
];

const team = computed(() => props.scope === 'team');
// A personal connection is only ever yours, so Access says something only for the team's.
const heads = computed(() => (team.value ? HEADS : HEADS.filter((head) => head.id !== 'access')));
const lastChecked = computed(() => props.rows.map((row) => row.checked).filter(Boolean).sort().pop() || null);
const statusOf = (row) => CONNECTION_STATUS[row.status] || CONNECTION_STATUS.ready;
const hasAction = (row) => row.status !== 'ready' || row.testable;

function tagsOf(row) {
  const tags = [];
  if (row.ai) tags.push({ label: 'AI model', tone: 'blue', tip: row.local ? 'Signs in on this computer' : '' });
  if (row.fromPlugin) tags.push({ label: 'Plugin sign-in', tone: '', tip: `Added by the ${row.fromPlugin} plugin` });
  if (row.custom) tags.push({ label: 'Custom app', tone: '', tip: 'An app you added yourself' });
  if (row.team) tags.push({ label: 'Team', tone: '' });
  return tags;
}

function tipOf(row) {
  const checked = row.checked ? `Checked ${formatWhen(row.checked)}` : '';
  if (row.team) return `Shared with ${props.teamName || 'the team'}. Teammates use it without seeing the credentials.`;
  if (row.status === 'ready') return [row.identity && `Signed in as ${row.identity}`, checked].filter(Boolean).join(' · ') || 'Connected';
  if (row.status === 'reconnect') return [row.problem || 'It stopped working', checked && checked.toLowerCase()].filter(Boolean).join(' · ');
  const needs = row.apps.map((app) => app.label);
  if (!needs.length) return 'Not connected yet';
  return `${listNames(needs)} ${needs.length === 1 ? 'needs' : 'need'} this ${row.kind === 'API key' ? 'key' : 'sign-in'}`;
}
</script>
