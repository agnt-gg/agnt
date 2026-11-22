<template>
  <div class="page" data-section="mcp">
    <div class="page-head">
      <h1>MCP servers</h1>
      <div class="row-gap">
        <button type="button" class="primary" data-action="mcp-manage" @click="emit('act', 'mcp-manage')"><AppsGlyph name="plus" size="sm" />Add MCP server</button>
      </div>
    </div>

    <AppsList :rows="rows" :spec="LISTS.mcp" :heads="HEADS" label="MCP servers" noun="server" :openable="false">
      <template #empty>
        <div class="tbl">
          <div class="empty" data-section="empty">
            <span class="em-icon"><AppsGlyph name="server" /></span>
            <h3>No MCP servers yet</h3>
            <p>An MCP server gives Annie and your agents more tools: your files, a browser, a database, another app.</p>
            <div class="row-gap"><button type="button" class="primary" data-action="mcp-manage" @click="emit('act', 'mcp-manage')"><AppsGlyph name="plus" size="sm" />Add MCP server</button></div>
          </div>
        </div>
      </template>

      <template #cell-name="{ row }">
        <div class="name">
          <span class="logo"><AppsGlyph :name="row.remote ? 'globe' : 'terminal'" size="sm" /></span>
          <div class="name-text"><strong>{{ row.name }}</strong><small>{{ row.transport }}</small></div>
        </div>
      </template>
      <template #cell-runs="{ row }"><span>{{ row.runs }}</span></template>
      <template #cell-status="{ row }">
        <div v-if="busy[`mcp:${row.id}`]" class="st busy"><span class="dot"></span><span>Testing…</span></div>
        <div v-else class="st has-act" :class="statusOf(row).tone">
          <span class="dot"></span>
          <span class="st-l"><span>{{ statusOf(row).label }}</span><span class="tip-i" v-tooltip="tipOf(row)"><AppsGlyph name="info" size="xs" /></span></span>
          <button type="button" class="btn sm act" data-action="mcp-test" @click="emit('act', 'mcp-test', row)">Test server</button>
        </div>
      </template>
      <template #cell-used="{ row }">
        <span class="use"><AppsGlyph name="bot" />{{ row.tools != null ? plural(row.tools, 'tool') : 'Annie & agents' }}</span>
      </template>

      <template #menu="{ row }">
        <button type="button" class="mi" role="menuitem" data-action="mcp-test" @click="emit('act', 'mcp-test', row)"><AppsGlyph name="refresh" />Test server</button>
        <button type="button" class="mi" role="menuitem" data-action="mcp-manage" @click="emit('act', 'mcp-manage', row)"><AppsGlyph name="pen" />Edit in the MCP manager</button>
        <div class="mi-sep"></div>
        <button type="button" class="mi danger" role="menuitem" data-action="mcp-remove" @click="emit('act', 'mcp-remove', row)"><AppsGlyph name="trash" />Remove server</button>
      </template>

      <template #bulk="{ rows: chosen, clear }">
        <button type="button" class="btn sm" data-action="mcp-bulk-test" @click="emit('act', 'mcp-bulk-test', chosen, clear)"><AppsGlyph name="refresh" size="xs" />Test servers</button>
        <button type="button" class="btn sm danger" data-action="mcp-bulk-remove" @click="emit('act', 'mcp-bulk-remove', chosen, clear)">Remove</button>
      </template>

      <template #foot="{ rows: shownRows, all }">
        <span>{{ plural(shownRows.length, 'server') }}{{ shownRows.length !== all.length ? ` of ${all.length}` : '' }}</span>
        <button type="button" class="btn sm" data-action="mcp-manage" @click="emit('act', 'mcp-manage')"><AppsGlyph name="find" size="xs" />Browse the MCP library</button>
      </template>
    </AppsList>
  </div>
</template>

<script setup>
// MCP servers: where each runs and whether it answers. Adding and editing happen in the MCP manager.
import AppsGlyph from './AppsGlyph.vue';
import AppsList from './AppsList.vue';
import { LISTS, MCP_STATUS, formatWhen, plural } from './appsModel.js';

defineProps({
  rows: { type: Array, required: true },
  busy: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['act']);

const HEADS = [
  { id: 'name', label: 'Name', min: 220, fr: 2 },
  { id: 'runs', label: 'Runs', min: 140, fr: 1, drop: 1 },
  { id: 'status', label: 'Status', min: 250, fr: 1.3 },
  { id: 'used', label: 'Offers', min: 130, fr: 1, sort: false, drop: 2 },
];

const statusOf = (row) => MCP_STATUS[row.status] || MCP_STATUS.unchecked;
function tipOf(row) {
  if (row.status === 'unchecked') return 'Test starts the server and lists what it offers';
  return [row.message, row.checked && `Checked ${formatWhen(row.checked)}`].filter(Boolean).join(' · ');
}
</script>
