<template>
  <div class="data-export">
    <div class="setting-group">
      <div class="group-header">
        <div>
          <h3>Export your data</h3>
          <p class="description">
            Download your memories, conversations, run traces and more as a single JSON file. Pick what to include, or take everything.
          </p>
        </div>
        <div class="select-actions">
          <button type="button" class="btn-link" :disabled="allSelected || !categories.length" @click="selectAll">Select all</button>
          <button type="button" class="btn-link" :disabled="!selected.length" @click="selectNone">Clear</button>
        </div>
      </div>

      <p v-if="loadError" class="notice notice-error" role="alert">
        Couldn’t load what’s available to export: {{ loadError }}
        <button type="button" class="btn-link" @click="loadCategories">Try again</button>
      </p>

      <div v-else class="category-list" :class="{ loading }" :aria-busy="loading">
        <label
          v-for="category in categories"
          :key="category.id"
          class="category-row"
          :class="{ checked: isSelected(category.id), empty: category.count === 0 }"
          :data-category="category.id"
        >
          <input type="checkbox" class="category-check" :value="category.id" v-model="selected" />
          <span class="checkmark" aria-hidden="true"><i class="fas fa-check"></i></span>
          <span class="category-info">
            <span class="category-label">{{ category.label }}</span>
            <span class="category-description">{{ category.description }}</span>
          </span>
          <span class="category-count" :title="category.error || ''">{{ formatCount(category) }}</span>
        </label>
      </div>
    </div>

    <div class="setting-group">
      <h3>Options</h3>

      <div class="setting-row">
        <div class="setting-info">
          <label class="setting-label">Date range</label>
          <p class="setting-description">Only include items from these dates. Leave empty to include all history.</p>
        </div>
        <div class="setting-control date-range">
          <input type="date" class="date-input" aria-label="From date" v-model="since" :max="until || undefined" />
          <span class="date-sep">to</span>
          <input type="date" class="date-input" aria-label="To date" v-model="until" :min="since || undefined" />
          <button v-if="since || until" type="button" class="btn-link" @click="clearDates">Clear</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <label class="setting-label">Compress file (.gz)</label>
          <p class="setting-description">
            Much smaller download. Recommended when including workflow runs, which are usually the largest category.
          </p>
        </div>
        <div class="setting-control">
          <label class="toggle-switch">
            <input type="checkbox" v-model="compress" aria-label="Compress file" />
            <span class="slider"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="export-footer">
      <p class="summary" aria-live="polite">
        <template v-if="status === 'started'">
          <i class="fas fa-circle-check"></i> Your download has started<span v-if="lastFilename">: {{ lastFilename }}</span>. Large exports can take a few minutes to finish.
        </template>
        <template v-else-if="status === 'error'">
          <span class="text-error"><i class="fas fa-triangle-exclamation"></i> {{ exportError }}</span>
        </template>
        <template v-else-if="selected.length">
          {{ selected.length }} of {{ categories.length }} categories selected · {{ selectedRowLabel }}
        </template>
        <template v-else>Select at least one category to export.</template>
      </p>
      <div class="footer-actions">
        <button type="button" class="btn-secondary" :disabled="exporting || !categories.length" @click="exportEverything">
          Export everything
        </button>
        <button type="button" class="btn-primary" :disabled="exporting || !selected.length" @click="exportSelected">
          <i class="fas" :class="exporting ? 'fa-spinner fa-spin' : 'fa-download'"></i>
          {{ exporting ? 'Preparing…' : 'Export selected' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import { fetchExportCategories, requestExport, startDownload } from '@/services/dataExportService.js';

export default {
  name: 'DataExportSection',
  setup() {
    const categories = ref([]);
    const selected = ref([]);
    const since = ref('');
    const until = ref('');
    const compress = ref(false);
    const loading = ref(false);
    const loadError = ref('');
    const exporting = ref(false);
    const status = ref('idle');
    const exportError = ref('');
    const lastFilename = ref('');

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
        const firstLoad = categories.value.length === 0;
        categories.value = next;
        // Everything is selected by default; keep the user's choice after that.
        if (firstLoad) selected.value = next.map((c) => c.id);
      } catch (err) {
        if (seq !== loadSeq) return;
        loadError.value = err.message;
      } finally {
        if (seq === loadSeq) loading.value = false;
      }
    };

    const isSelected = (id) => selected.value.includes(id);
    const allSelected = computed(() => categories.value.length > 0 && selected.value.length === categories.value.length);
    const selectAll = () => { selected.value = categories.value.map((c) => c.id); };
    const selectNone = () => { selected.value = []; };
    const clearDates = () => { since.value = ''; until.value = ''; };

    const numberFormat = new Intl.NumberFormat();
    const formatCount = (category) => {
      if (category.count === null || category.count === undefined) return '—';
      return `${numberFormat.format(category.count)} ${category.count === 1 ? 'item' : 'items'}`;
    };
    const selectedRowLabel = computed(() => {
      const total = categories.value
        .filter((c) => selected.value.includes(c.id))
        .reduce((sum, c) => sum + (c.count || 0), 0);
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

    watch([since, until], () => {
      status.value = 'idle';
      loadCategories();
    });
    watch(selected, () => { if (status.value !== 'idle') status.value = 'idle'; });

    onMounted(loadCategories);

    return {
      categories, selected, since, until, compress, loading, loadError, exporting, status, exportError, lastFilename,
      loadCategories, isSelected, allSelected, selectAll, selectNone, clearDates, formatCount, selectedRowLabel,
      exportSelected, exportEverything,
    };
  },
};
</script>

<style scoped>
.data-export {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-group h3 {
  color: var(--color-primary);
  font-size: 1.2em;
  font-weight: 500;
  margin: 0;
}

.group-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.group-header h3 {
  margin-bottom: 6px;
}

.description {
  color: var(--color-text-muted);
  font-size: 0.95em;
  margin: 0;
  opacity: 0.9;
}

.select-actions {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

button.btn-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-primary);
  font-size: 0.9em;
  cursor: pointer;
}

button.btn-link:disabled {
  color: var(--color-text-muted);
  opacity: 0.5;
  cursor: default;
}

.category-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
  transition: opacity 0.2s ease;
}

.category-list.loading {
  opacity: 0.6;
}

.category-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.category-row:hover {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
}

.category-row.checked {
  border-color: var(--color-primary);
}

.category-check {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkmark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: var(--color-darker-1);
  color: transparent;
  font-size: 0.7em;
  transition: all 0.2s ease;
}

.category-row.checked .checkmark {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--on-fill-accent);
}

.category-check:focus-visible + .checkmark {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.category-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.category-label {
  color: var(--color-text);
  font-weight: 500;
}

.category-description {
  color: var(--color-text-muted);
  font-size: 0.85em;
  opacity: 0.85;
}

.category-count {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 12px;
  background: var(--color-darker-1);
  color: var(--color-text-secondary);
  font-size: 0.8em;
  font-variant-numeric: tabular-nums;
}

.category-row.empty .category-count {
  opacity: 0.6;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.setting-row:hover {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
}

.setting-info {
  flex: 1;
}

.setting-label {
  display: block;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 500;
  margin-bottom: 4px;
}

.setting-description {
  color: var(--color-text-muted);
  font-size: 0.9em;
  margin: 0;
  opacity: 0.8;
}

.date-range {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.date-input {
  padding: 8px 10px;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-family: inherit;
}

.date-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.date-sep {
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: rgba(127, 129, 147, 0.3);
  transition: 0.3s;
  border-radius: 28px;
  border: 1px solid var(--terminal-border-color);
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: var(--color-text-muted);
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

input:checked + .slider:before {
  transform: translateX(24px);
  background-color: var(--color-white);
}

.export-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 20px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
}

.summary {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.95em;
}

.summary .fa-circle-check {
  color: var(--color-primary);
}

.text-error,
.notice-error {
  color: var(--color-red);
}

.notice {
  margin: 0;
  padding: 12px 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  background: var(--color-darker-0);
  font-size: 0.95em;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

button.btn-primary,
button.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 0.95em;
  cursor: pointer;
  transition: all 0.2s ease;
}

button.btn-primary {
  background: var(--color-primary);
  color: var(--on-fill-accent) !important;
}

button.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

button.btn-secondary {
  background: var(--color-darker-1);
  color: var(--color-text) !important;
}

button.btn-secondary:hover:not(:disabled) {
  background: var(--color-darker-2);
}

button.btn-primary:disabled,
button.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
  transform: none;
}
</style>
