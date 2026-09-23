<template>
  <div class="data-panel">
  <section class="panel-card data-export" aria-labelledby="backup-title">
    <div class="panel-head">
      <div class="panel-title">
        <span class="panel-icon" aria-hidden="true"><i class="fas fa-download"></i></span>
        <div>
          <h3 id="backup-title">Back up</h3>
          <p>Download your work and history as one file. Keep it somewhere safe, or restore it into a fresh copy of AGNT. Connected accounts and API keys are never included.</p>
        </div>
      </div>
      <div class="text-actions">
        <button type="button" class="text-button" :disabled="allSelected || !categories.length" @click="selectAll">Select all</button>
        <button type="button" class="text-button" :disabled="!selected.length" @click="selectNone">Clear</button>
      </div>
    </div>

    <p v-if="loadError" class="notice bad" role="alert">
      <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>Couldn’t load what’s available: {{ loadError }}
      <button type="button" class="text-button" @click="loadCategories">Try again</button>
    </p>

    <div v-else-if="!categories.length" class="option-grid" aria-busy="true" aria-label="Loading">
      <div v-for="n in 6" :key="n" class="skeleton"></div>
    </div>

    <template v-else>
      <div v-for="group in groups" :key="group.id" class="option-group" :aria-busy="loading">
        <p class="option-group-title"><span>{{ group.title }}</span><span>{{ groupCount(group) }}</span></p>
        <div class="option-grid" role="group" :aria-label="group.title">
          <button
            v-for="category in group.items"
            :key="category.id"
            type="button"
            class="option"
            role="checkbox"
            :aria-checked="isSelected(category.id) ? 'true' : 'false'"
            :data-category="category.id"
            @click="toggle(category.id)"
          >
            <span class="box" aria-hidden="true"><i class="fas fa-check"></i></span>
            <span class="option-body">
              <span class="option-top">
                <span class="option-label">{{ category.label }}</span>
                <span class="option-count" v-tooltip="category.error || ''">{{ itemCount(category.count) }}</span>
              </span>
              <span class="option-description">{{ category.description }}</span>
            </span>
          </button>
        </div>
      </div>
    </template>

    <div class="field-row">
      <div>
        <span class="field-label" id="range-label">Date range</span>
        <span class="field-hint">Only history from these days. Your work is always included whole.</span>
      </div>
      <div class="field-controls" role="group" aria-labelledby="range-label">
        <input v-model="since" type="date" class="date-input" aria-label="From date" :max="until || undefined" />
        <span class="muted">to</span>
        <input v-model="until" type="date" class="date-input" aria-label="To date" :min="since || undefined" />
        <button v-if="since || until" type="button" class="text-button" @click="clearDates">Clear</button>
      </div>
    </div>

    <div class="field-row">
      <div>
        <span class="field-label" id="compress-label">Compress the file</span>
        <span class="field-hint">Much smaller. Recommended when including workflow runs, usually the largest part.</span>
      </div>
      <label class="switch">
        <input v-model="compress" type="checkbox" aria-labelledby="compress-label" />
        <span class="track"></span>
      </label>
    </div>

    <div class="panel-footer">
      <p class="footer-status" aria-live="polite">
        <template v-if="status === 'started'">
          <span class="ok"><i class="fas fa-check-circle" aria-hidden="true"></i> Download started<span v-if="lastFilename">: {{ lastFilename }}</span>.</span> Large backups can take a few minutes.
        </template>
        <span v-else-if="status === 'error'" class="bad"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i> {{ exportError }}</span>
        <template v-else-if="selected.length">{{ selected.length }} of {{ categories.length }} selected · {{ selectedRowLabel }}</template>
        <template v-else>Select at least one thing to back up.</template>
      </p>
      <div class="button-row">
        <button type="button" class="btn btn-quiet" :disabled="exporting || !categories.length" @click="exportEverything">Back up everything</button>
        <button type="button" class="btn btn-primary" :disabled="exporting || !selected.length" @click="exportSelected">
          <i class="fas" :class="exporting ? 'fa-spinner fa-spin' : 'fa-download'" aria-hidden="true"></i>
          {{ exporting ? 'Preparing…' : 'Download backup' }}
        </button>
      </div>
    </div>
  </section>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import { fetchExportCategories, requestExport, startDownload } from '@/services/dataExportService.js';
import { itemCount, numberFormat } from '@/services/dataBackupService.js';
import './dataPanel.css';

const GROUPS = [
  { id: 'work', title: 'Your work' },
  { id: 'history', title: 'History' },
];

export default {
  name: 'DataExportSection',
  setup() {
    const categories = ref([]);
    const selected = ref([]);
    const since = ref('');
    const until = ref('');
    const compress = ref(true);
    const loading = ref(false);
    const loadError = ref('');
    const exporting = ref(false);
    const status = ref('idle');
    const exportError = ref('');
    const lastFilename = ref('');
    // True once the user has changed the selection; until then, everything stays selected.
    let customized = false;

    // Only the latest count request may write its result: changing the
    // dates quickly must not let an older, slower response win.
    let loadSeq = 0;
    const loadCategories = async () => {
      const seq = ++loadSeq;
      loading.value = true;
      loadError.value = '';
      try {
        const next = await fetchExportCategories({ since: since.value, until: until.value });
        if (seq !== loadSeq) return;
        categories.value = next;
        const known = new Set(next.map((c) => c.id));
        selected.value = customized ? selected.value.filter((id) => known.has(id)) : next.map((c) => c.id);
      } catch (err) {
        if (seq !== loadSeq) return;
        loadError.value = err.message;
      } finally {
        if (seq === loadSeq) loading.value = false;
      }
    };

    const groups = computed(() => GROUPS
      .map((group) => ({ ...group, items: categories.value.filter((c) => (c.group || 'history') === group.id) }))
      .filter((group) => group.items.length));
    const groupCount = (group) => itemCount(group.items.reduce((sum, c) => sum + (c.count || 0), 0));

    const isSelected = (id) => selected.value.includes(id);
    const toggle = (id) => {
      customized = true;
      selected.value = isSelected(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id];
    };
    const allSelected = computed(() => categories.value.length > 0 && selected.value.length === categories.value.length);
    const selectAll = () => { customized = true; selected.value = categories.value.map((c) => c.id); };
    const selectNone = () => { customized = true; selected.value = []; };
    const clearDates = () => { since.value = ''; until.value = ''; };

    const selectedRowLabel = computed(() => {
      const total = categories.value.filter((c) => selected.value.includes(c.id)).reduce((sum, c) => sum + (c.count || 0), 0);
      return `${numberFormat.format(total)} ${total === 1 ? 'item' : 'items'}`;
    });

    const runExport = async (ids) => {
      if (exporting.value || ids.length === 0) return;
      exporting.value = true;
      status.value = 'idle';
      exportError.value = '';
      try {
        const reply = await requestExport({ categories: ids, since: since.value, until: until.value, compress: compress.value });
        startDownload(reply.ticket, reply.filename);
        lastFilename.value = reply.filename || '';
        status.value = 'started';
      } catch (err) {
        exportError.value = err.message;
        status.value = 'error';
      } finally {
        exporting.value = false;
      }
    };

    // Canonical order comes from the server list, not click order.
    const exportSelected = () => runExport(categories.value.map((c) => c.id).filter((id) => selected.value.includes(id)));
    const exportEverything = () => runExport(categories.value.map((c) => c.id));

    watch([since, until], () => { status.value = 'idle'; loadCategories(); });
    watch(selected, () => { if (status.value !== 'idle') status.value = 'idle'; });
    onMounted(loadCategories);

    return {
      categories, selected, since, until, compress, loading, loadError, exporting, status, exportError, lastFilename,
      groups, groupCount, itemCount, loadCategories, isSelected, toggle, allSelected, selectAll, selectNone, clearDates,
      selectedRowLabel, exportSelected, exportEverything,
    };
  },
};
</script>
