<template>
  <div class="page" data-section="plugins">
    <div class="page-head">
      <h1>Add-ons</h1>
      <div class="row-gap">
        <button type="button" class="btn" data-action="build" @click="emit('act', 'build')"><AppsGlyph name="plus" size="sm" />Build an add-on</button>
        <button type="button" class="primary" data-action="browse" @click="emit('act', 'browse')"><AppsGlyph name="grid" size="sm" />Browse Market</button>
      </div>
    </div>

    <AppsList :rows="rows" :spec="LISTS.plugins" :heads="HEADS" label="Add-ons" noun="add-on" :preset-query="presetQuery" @open="(row) => emit('act', 'open', row)">
      <template #empty>
        <div class="tbl">
          <div class="empty" data-section="empty">
            <span class="em-icon"><AppsGlyph name="puzzle" /></span>
            <h3>No add-ons installed yet</h3>
            <p>Add-ons add actions, assistants, automations and dashboard cards to AGNT, and connect it to the apps you use.</p>
            <div class="row-gap"><button type="button" class="primary" data-action="browse" @click="emit('act', 'browse')"><AppsGlyph name="grid" size="sm" />Browse Market</button></div>
          </div>
        </div>
      </template>

      <template #cell-name="{ row }">
        <div class="name">
          <span class="logo"><SvgIcon :name="row.icon" /></span>
          <div class="name-text"><strong>{{ row.label }}</strong><small v-if="row.desc">{{ row.desc }}</small></div>
        </div>
      </template>
      <template #cell-uses="{ row }">
        <span v-if="!row.provider" class="muted ellipsis" v-tooltip="'Works without a sign-in'">None needed</span>
        <span v-else-if="row.provider.model" class="muted row-gap"><AppsGlyph name="bot" size="sm" /><span class="ellipsis">Your AI model</span></span>
        <button v-else type="button" class="row-gap" data-action="open-connection" style="max-width: 100%" @click="emit('act', 'open-connection', row)">
          <span class="logo sm"><SvgIcon :name="row.provider.icon" /></span><span class="ellipsis">{{ row.provider.name }}</span>
        </button>
      </template>
      <template #cell-status="{ row }">
        <div v-if="row.provider && busy[row.provider.id] === 'signin'" class="st busy"><span class="dot"></span><span>Signing in…</span></div>
        <div v-else class="st" :class="[statusOf(row).tone, { 'has-act': row.status !== 'off' }]">
          <span class="dot"></span>
          <span class="st-l"><span>{{ statusOf(row).label }}</span><span class="tip-i" v-tooltip="tipOf(row)"><AppsGlyph name="info" size="xs" /></span></span>
          <button v-if="row.status === 'reconnect'" type="button" class="primary sm act" data-action="signin" @click="emit('act', 'signin', row)">Reconnect</button>
          <button v-else-if="row.status === 'connect'" type="button" class="primary sm act" data-action="signin" @click="emit('act', 'signin', row)">Connect</button>
          <button v-else-if="row.status === 'ready'" type="button" class="btn sm act" data-action="try" @click="emit('act', 'try', row)">Try</button>
        </div>
      </template>
      <template #cell-contents="{ row }">
        <div v-if="phrases(row).length" class="tags nowrap">
          <span class="use">{{ phrases(row)[0] }}</span>
          <span v-if="phrases(row).length > 1" class="use zero" v-tooltip="phrases(row).slice(1).join(', ')">+{{ phrases(row).length - 1 }}</span>
        </div>
        <span v-else class="muted">—</span>
      </template>
      <template #cell-version="{ row }">
        <div class="app-cell">
          <span class="ver-num">{{ row.version || '—' }}</span>
          <div class="tags">
            <span v-if="row.update" class="tag blue" v-tooltip="`Version ${row.update} is on the Market`">Update</span>
            <span v-else class="tag" :class="TRUST_TONES[row.trust] || ''" v-tooltip="TRUST_DETAIL[row.trust]">{{ row.trust }}</span>
          </div>
        </div>
      </template>
      <template #cell-updated="{ row }"><span>{{ formatDate(row.updated) }}</span></template>

      <template #menu="{ row }">
        <button type="button" class="mi" role="menuitem" data-action="open" @click="emit('act', 'open', row)"><AppsGlyph name="doc" />Open details</button>
        <button v-if="row.status === 'ready'" type="button" class="mi" role="menuitem" data-action="try" @click="emit('act', 'try', row)"><AppsGlyph name="chats" />Try with Annie</button>
        <button v-if="row.update" type="button" class="mi" role="menuitem" data-action="update" @click="emit('act', 'update', row)"><AppsGlyph name="update" />Update to {{ row.update }}</button>
        <button v-if="row.provider && !row.provider.model" type="button" class="mi" role="menuitem" data-action="open-connection" @click="emit('act', 'open-connection', row)"><AppsGlyph name="plug" />Open {{ row.provider.name }} connection</button>
        <button type="button" class="mi" role="menuitem" data-action="details" @click="emit('act', 'details', row)"><AppsGlyph name="external" />Full details</button>
        <div class="mi-sep"></div>
        <button type="button" class="mi danger" role="menuitem" data-action="uninstall" @click="emit('act', 'uninstall', row)"><AppsGlyph name="trash" />Uninstall</button>
      </template>

      <template #bulk="{ rows: chosen, clear }">
        <button v-if="chosen.some((row) => row.update)" type="button" class="btn sm" data-action="bulk-update" @click="emit('act', 'bulk-update', chosen, clear)"><AppsGlyph name="update" size="xs" />Update</button>
        <button type="button" class="btn sm danger" data-action="bulk-uninstall" @click="emit('act', 'bulk-uninstall', chosen, clear)">Uninstall</button>
      </template>

      <template #foot="{ rows: shownRows, all }">
        <span>{{ plural(shownRows.length, 'add-on') }}{{ shownRows.length !== all.length ? ` of ${all.length}` : '' }} · {{ all.filter((row) => row.triggers).length }} with triggers · {{ needYou(all.filter((row) => row.status === 'reconnect' || row.status === 'connect').length) }}</span>
        <button type="button" class="btn sm" data-action="browse" @click="emit('act', 'browse')"><AppsGlyph name="grid" size="xs" />Browse Market</button>
      </template>
    </AppsList>
  </div>
</template>

<script setup>
// Installed plugins: what each one needs to run, what it put into AGNT, and its version.
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsGlyph from './AppsGlyph.vue';
import AppsList from './AppsList.vue';
import { needYou, LISTS, PLUGIN_STATUS, TRUST_DETAIL, contentPhrases, formatDate, plural } from './appsModel.js';

defineProps({
  rows: { type: Array, required: true },
  busy: { type: Object, default: () => ({}) },
  presetQuery: { type: Object, default: null },
});
const emit = defineEmits(['act']);

const TRUST_TONES = Object.freeze({ Unverified: 'amber', Unaudited: 'red' });
const HEADS = [
  { id: 'name', label: 'Name', min: 210, fr: 2.6 },
  { id: 'uses', label: 'Uses', min: 110, fr: 0.85, drop: 2 },
  { id: 'status', label: 'Status', min: 236, fr: 1.3 },
  { id: 'contents', label: 'Contents', min: 124, fr: 1, drop: 1 },
  { id: 'version', label: 'Version', min: 86, fr: 0.7, drop: 4 },
  { id: 'updated', label: 'Last updated', min: 110, fr: 0.75, drop: 3 },
];

const statusOf = (row) => PLUGIN_STATUS[row.status] || PLUGIN_STATUS.ready;
const phrases = (row) => contentPhrases(row.contents);
function tipOf(row) {
  if (row.status === 'reconnect') return `Its ${row.provider.name} sign-in stopped working`;
  if (row.status === 'connect') return `Connect ${row.provider.name} to use it`;
  if (row.status === 'off') return 'Turned off. Annie and your assistants cannot use it.';
  return 'Ready to use. Ask Annie, or add it to an assistant.';
}
</script>
