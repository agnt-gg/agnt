<template>
  <div class="page" data-section="triggers">
    <div class="page-head">
      <h1>Email &amp; web triggers</h1>
      <div class="row-gap">
        <button type="button" class="btn" data-action="workflows" @click="emit('act', 'workflows')"><AppsGlyph name="routines" size="sm" />Open automations</button>
      </div>
    </div>

    <div v-if="lockedNote" class="note pro-note" data-section="locked">
      <span class="logo"><AppsGlyph name="lock" size="sm" /></span>
      <div class="grow">
        <strong>{{ lockedNote }}</strong>
        <p>Automations can start from an email to their own address, or a call to their own web trigger URL.</p>
      </div>
      <button type="button" class="primary sm" data-action="upgrade" @click="emit('act', 'upgrade')">Go Pro</button>
    </div>

    <AppsList :rows="rows" :spec="LISTS.triggers" :heads="HEADS" label="Email and web triggers" noun="trigger" :openable="false">
      <template #empty>
        <div v-if="!(locked.email && locked.webhooks)" class="tbl">
          <div class="empty" data-section="empty">
            <span class="em-icon"><AppsGlyph name="mail" /></span>
            <h3>No email or web triggers yet</h3>
            <p>An automation that starts from an email or a web trigger gets its own address here.</p>
            <div class="row-gap"><button type="button" class="btn" data-action="workflows" @click="emit('act', 'workflows')"><AppsGlyph name="routines" size="sm" />Open automations</button></div>
          </div>
        </div>
      </template>

      <template #cell-workflow="{ row }">
        <div class="name">
          <span class="logo"><AppsGlyph :name="row.kind === 'Email' ? 'mail' : 'link'" size="sm" /></span>
          <div class="name-text"><strong>{{ row.workflow }}</strong><small>{{ row.kind === 'Email' ? 'Email trigger' : 'Web trigger' }}</small></div>
        </div>
      </template>
      <template #cell-trigger="{ row }">
        <span v-if="row.kind === 'Email'" class="mono ellipsis" style="font-size: 12.5px" v-tooltip="row.address">{{ row.address }}</span>
        <div v-else class="tags nowrap">
          <span class="tag mono">{{ row.method }}</span>
          <span class="tag" :class="row.protected ? 'green' : ''">{{ row.protected ? 'Protected' : 'Open' }}</span>
        </div>
      </template>
      <template #cell-wf="{ row }">
        <div class="st" :class="row.wfStatus === 'listening' ? 'ok' : 'off'">
          <span class="dot"></span>
          <span class="st-l">
            <span>{{ row.wfStatus === 'listening' ? 'Listening' : 'Stopped' }}</span>
            <span class="tip-i" v-tooltip="row.wfStatus === 'listening' ? 'The automation is running and waiting for this trigger' : 'Start the automation to listen again'"><AppsGlyph name="info" size="xs" /></span>
          </span>
        </div>
      </template>
      <template #cell-created="{ row }"><span>{{ formatDate(row.created) }}</span></template>
      <template #cell-updated="{ row }"><span>{{ formatDate(row.updated) }}</span></template>

      <template #menu="{ row }">
        <button type="button" class="mi" role="menuitem" data-action="open-workflow" @click="emit('act', 'open-workflow', row)"><AppsGlyph name="routines" />Open automation</button>
        <button type="button" class="mi" role="menuitem" data-action="copy" @click="emit('act', 'copy', row)"><AppsGlyph name="copy" />{{ row.kind === 'Email' ? 'Copy address' : 'Copy web trigger URL' }}</button>
        <template v-if="row.kind === 'Webhook'">
          <div class="mi-sep"></div>
          <button type="button" class="mi danger" role="menuitem" data-action="remove-webhook" @click="emit('act', 'remove-webhook', row)"><AppsGlyph name="trash" />Remove web trigger</button>
        </template>
      </template>

      <template #bulk="{ rows: chosen, clear }">
        <button v-if="chosen.some((row) => row.kind === 'Webhook')" type="button" class="btn sm danger" data-action="bulk-remove-webhooks" @click="emit('act', 'bulk-remove-webhooks', chosen, clear)">
          Remove {{ plural(chosen.filter((row) => row.kind === 'Webhook').length, 'web trigger') }}
        </button>
      </template>

      <template #foot="{ rows: shownRows, all }">
        <span>{{ plural(shownRows.length, 'trigger') }}{{ shownRows.length !== all.length ? ` of ${all.length}` : '' }} · {{ all.filter((row) => row.wfStatus === 'listening').length }} listening</span>
      </template>
    </AppsList>
  </div>
</template>

<script setup>
// The email addresses and webhook URLs that start workflows, and whether each workflow is listening.
import { computed } from 'vue';
import AppsGlyph from './AppsGlyph.vue';
import AppsList from './AppsList.vue';
import { LISTS, formatDate, plural } from './appsModel.js';

const props = defineProps({
  rows: { type: Array, required: true },
  // Which kinds this plan does not include: { email, webhooks }
  locked: { type: Object, default: () => ({ email: false, webhooks: false }) },
});
const emit = defineEmits(['act']);

const lockedNote = computed(() => {
  const { email, webhooks } = props.locked;
  if (email && webhooks) return 'Email and web triggers are included with AGNT Pro';
  if (email) return 'Email triggers are included with AGNT Pro';
  if (webhooks) return 'Web triggers are included with AGNT Pro';
  return '';
});

const HEADS = [
  { id: 'workflow', label: 'Automation', min: 220, fr: 1.8 },
  { id: 'trigger', label: 'Trigger', min: 190, fr: 1.4 },
  { id: 'wf', label: 'Automation status', min: 140, fr: 0.9, drop: 1 },
  { id: 'created', label: 'Created', min: 104, fr: 0.8, drop: 3 },
  { id: 'updated', label: 'Last updated', min: 116, fr: 0.8, drop: 2 },
];
</script>
