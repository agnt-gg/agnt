<template>
  <div class="data-panel">
    <section class="panel-card" aria-labelledby="backup-first-title">
      <div class="panel-head">
        <div class="panel-title">
          <span class="panel-icon" aria-hidden="true"><i class="fas fa-shield-alt"></i></span>
          <div>
            <h3 id="backup-first-title">Take a backup first</h3>
            <p>A reset cannot be undone. A full backup lets you restore any of it later from Backup &amp; Restore.</p>
          </div>
        </div>
        <button type="button" class="btn btn-quiet" :disabled="backingUp" @click="backUpEverything">
          <i class="fas" :class="backingUp ? 'fa-spinner fa-spin' : 'fa-download'" aria-hidden="true"></i>
          {{ backupStarted ? 'Download started' : 'Download a full backup' }}
        </button>
      </div>
      <p v-if="backupError" class="notice bad" role="alert"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i>{{ backupError }}</p>
    </section>

    <section class="panel-card danger-zone" aria-labelledby="reset-title">
      <div class="panel-head">
        <div class="panel-title">
          <span class="panel-icon" aria-hidden="true"><i class="fas fa-undo-alt"></i></span>
          <div>
            <h3 id="reset-title">Reset</h3>
            <p>Choose what to clear. Only your own data is touched; your account, plan and billing records are never reset.</p>
          </div>
        </div>
        <div class="text-actions">
          <button type="button" class="text-button" :disabled="!groups.length || done" @click="selectAllSafe">Select all</button>
          <button type="button" class="text-button" :disabled="!selected.length || done" @click="selected = []">Clear</button>
        </div>
      </div>

      <p v-if="loadError" class="notice bad" role="alert">
        <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>Couldn’t check what can be reset: {{ loadError }}
        <button type="button" class="text-button" @click="load">Try again</button>
      </p>
      <div v-else-if="!groups.length" class="option-grid" aria-busy="true" aria-label="Loading">
        <div v-for="n in 6" :key="n" class="skeleton"></div>
      </div>
      <div v-else class="option-grid" role="group" aria-label="What to reset">
        <button
          v-for="group in groups"
          :key="group.id"
          type="button"
          class="option"
          :class="{ danger: group.danger }"
          role="checkbox"
          :aria-checked="selected.includes(group.id) ? 'true' : 'false'"
          :disabled="busy || done"
          :data-group="group.id"
          @click="toggle(group.id)"
        >
          <span class="box" aria-hidden="true"><i class="fas fa-check"></i></span>
          <span class="option-body">
            <span class="option-top">
              <span class="option-label">{{ group.label }}</span>
              <span class="option-count">{{ group.client ? 'Settings' : itemCount(group.count) }}</span>
            </span>
            <span class="option-description">{{ group.description }}</span>
          </span>
        </button>
      </div>

      <template v-if="done">
        <p class="notice" :class="{ warn: problems.length }">
          <i class="fas" :class="problems.length ? 'fa-exclamation-triangle' : 'fa-check-circle'" aria-hidden="true"></i>
          Reset complete. Removed {{ itemCount(removedTotal) }}.
          <template v-for="problem in problems" :key="problem"> {{ problem }}</template>
        </p>
        <div class="panel-footer">
          <p class="footer-status">Reload AGNT to start fresh.</p>
          <div class="button-row"><button type="button" class="btn btn-primary" @click="reload"><i class="fas fa-redo" aria-hidden="true"></i> Reload AGNT</button></div>
        </div>
      </template>

      <div v-else class="panel-footer">
        <div class="confirm">
          <label for="reset-confirm" class="field-label">Type <strong>RESET</strong> to confirm</label>
          <input id="reset-confirm" v-model="confirmText" class="text-input" autocomplete="off" spellcheck="false" :disabled="busy" placeholder="RESET" />
        </div>
        <div class="button-row">
          <button type="button" class="btn btn-danger" :disabled="!canReset" @click="reset">
            <i class="fas" :class="busy ? 'fa-spinner fa-spin' : 'fa-undo-alt'" aria-hidden="true"></i>
            {{ busy ? 'Resetting…' : resetLabel }}
          </button>
        </div>
      </div>
      <p v-if="error" class="notice bad" role="alert"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i>{{ error }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { resetSummary, runReset, clearLocalPreferences, itemCount } from '@/services/dataBackupService.js';
import { requestExport, startDownload } from '@/services/dataExportService.js';
import './dataPanel.css';

const CONFIRMATION = 'RESET';
const groups = ref([]);
const selected = ref([]);
const confirmText = ref('');
const loadError = ref('');
const error = ref('');
const busy = ref(false);
const done = ref(false);
const removedTotal = ref(0);
const problems = ref([]);
const backingUp = ref(false);
const backupStarted = ref(false);
const backupError = ref('');

const canReset = computed(() => !busy.value && selected.value.length > 0 && confirmText.value.trim() === CONFIRMATION);
const resetLabel = computed(() => (selected.value.length === groups.value.length && groups.value.length ? 'Reset everything' : 'Reset selected'));
const toggle = (id) => { selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]; };
// "All" means everything except disconnecting accounts, which is always its own deliberate choice.
const selectAllSafe = () => { selected.value = groups.value.filter((g) => !g.danger).map((g) => g.id); };

async function load() {
  loadError.value = '';
  try { groups.value = await resetSummary(); } catch (err) { loadError.value = err.message; }
}

async function reset() {
  if (!canReset.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await runReset(selected.value, CONFIRMATION);
    removedTotal.value = Object.values(result.removed || {}).reduce((sum, n) => sum + n, 0);
    problems.value = result.problems || [];
    if (selected.value.includes('preferences')) clearLocalPreferences();
    done.value = true;
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function backUpEverything() {
  backingUp.value = true;
  backupError.value = '';
  try {
    const reply = await requestExport({ categories: 'all', compress: true });
    startDownload(reply.ticket, reply.filename);
    backupStarted.value = true;
  } catch (err) {
    backupError.value = err.message;
  } finally {
    backingUp.value = false;
  }
}

const reload = () => window.location.reload();
onMounted(load);
</script>

<style scoped>
.confirm { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex: 1 1 280px; }
/* The global `label { width: 100% }` would push the input onto its own line. */
.confirm .field-label { width: auto; margin: 0; font-weight: 400; color: var(--color-text); font-size: 0.92em; }
.confirm .text-input { width: 140px; letter-spacing: 0.08em; }
</style>
