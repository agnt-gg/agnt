<template>
  <div class="data-panel">
    <section class="panel-card data-restore" aria-labelledby="restore-title">
      <div class="panel-head">
        <div class="panel-title">
          <span class="panel-icon" aria-hidden="true"><i class="fas fa-upload"></i></span>
          <div>
            <h3 id="restore-title">Restore from a backup</h3>
            <p>Bring a backup into this copy of AGNT, including a brand-new one. Nothing already here is changed or replaced, so restoring the same file twice is safe.</p>
          </div>
        </div>
      </div>

      <!-- 1. Choose a file -->
      <div
        v-if="step === 'choose'"
        class="drop-zone"
        :class="{ over: dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <i class="fas fa-file-archive" aria-hidden="true"></i>
        <p><strong>Drop a backup file here</strong><span class="muted"> or</span></p>
        <button type="button" class="btn btn-quiet" @click="fileInput?.click()">Choose file…</button>
        <p class="muted">An AGNT backup ends in .json or .json.gz</p>
        <input ref="fileInput" type="file" class="visually-hidden" accept=".json,.gz,application/json,application/gzip" @change="onPick" />
      </div>

      <!-- 2. Uploading and checking -->
      <div v-else-if="step === 'uploading'" class="progress-block" role="status">
        <p><strong>{{ fileName }}</strong> <span class="muted">· {{ formatBytes(fileSize) }}</span></p>
        <div class="progress" :aria-label="'Reading backup ' + percent(uploadFraction)"><span :style="{ width: percent(uploadFraction) }"></span></div>
        <p class="muted">{{ uploadFraction < 1 ? 'Reading the backup… ' + percent(uploadFraction) : 'Checking what’s inside…' }}</p>
      </div>

      <!-- 3. Review what is inside -->
      <template v-else-if="step === 'review'">
        <p class="muted">
          <strong class="file-name">{{ fileName }}</strong> · made {{ formatDate(summary.exportedAt) }}
          <template v-if="summary.filters?.since || summary.filters?.until"> · history from {{ summary.filters.since || 'the start' }} to {{ summary.filters.until || 'the end' }}</template>
        </p>
        <p v-if="!summary.complete" class="notice warn"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i>This backup was cut short when it was made. Everything in it can still be restored; the rest was never saved.</p>
        <div v-for="group in groups" :key="group.id" class="option-group">
          <p class="option-group-title"><span>{{ group.title }}</span></p>
          <div class="option-grid" role="group" :aria-label="group.title">
            <button
              v-for="category in group.items"
              :key="category.id"
              type="button"
              class="option"
              role="checkbox"
              :aria-checked="chosen.includes(category.id) ? 'true' : 'false'"
              :disabled="!category.restorable || !category.count"
              :data-category="category.id"
              @click="toggle(category.id)"
            >
              <span class="box" aria-hidden="true"><i class="fas fa-check"></i></span>
              <span class="option-body">
                <span class="option-top">
                  <span class="option-label">{{ category.label }}</span>
                  <span class="option-count">{{ itemCount(category.count) }}</span>
                </span>
                <span class="option-description">{{ category.restorable ? category.description : 'Made by a newer AGNT. Update to restore this part.' }}</span>
              </span>
            </button>
          </div>
        </div>
        <p class="notice"><i class="fas fa-plug" aria-hidden="true"></i>Connected accounts and API keys are never in a backup. Connect them again in Settings after restoring. Restored workflows start switched off.</p>
        <div class="panel-footer">
          <p class="footer-status">{{ chosen.length ? chosen.length + ' of ' + restorableCount + ' selected · ' + chosenItems : 'Select at least one thing to restore.' }}</p>
          <div class="button-row">
            <button type="button" class="btn btn-quiet" @click="startOver">Choose a different file</button>
            <button type="button" class="btn btn-primary" :disabled="!chosen.length || busy" @click="restore"><i class="fas fa-upload" aria-hidden="true"></i> Restore</button>
          </div>
        </div>
      </template>

      <!-- 4. Restoring -->
      <div v-else-if="step === 'restoring'" class="progress-block" role="status">
        <p><strong>Restoring {{ fileName }}</strong></p>
        <div class="progress" :aria-label="'Restored ' + percent(restoreFraction)"><span :style="{ width: percent(restoreFraction) }"></span></div>
        <p class="muted">{{ percent(restoreFraction) }} · You can keep using AGNT while this runs.</p>
      </div>

      <!-- 5. Done -->
      <template v-else-if="step === 'done'">
        <p class="notice" :class="{ warn: result.problems?.length }">
          <i class="fas" :class="result.problems?.length ? 'fa-exclamation-triangle' : 'fa-check-circle'" aria-hidden="true"></i>
          Restored {{ itemCount(totals.added) }}<template v-if="totals.existing">; {{ itemCount(totals.existing) }} {{ totals.existing === 1 ? 'was' : 'were' }} already here</template><template v-if="totals.skipped">; {{ itemCount(totals.skipped) }} could not be restored</template>.
        </p>
        <ul class="result-list">
          <li v-for="row in resultRows" :key="row.id">
            <span>{{ row.label }}</span>
            <span class="muted">{{ row.added }} added<template v-if="row.existing"> · {{ row.existing }} already here</template><template v-if="row.skipped"> · {{ row.skipped }} skipped</template></span>
          </li>
        </ul>
        <details v-if="result.problems?.length" class="problems">
          <summary>What could not be restored</summary>
          <ul><li v-for="(problem, index) in result.problems" :key="index">{{ problem.message }}</li></ul>
        </details>
        <div class="panel-footer">
          <p class="footer-status">Reload AGNT to see everything you restored.</p>
          <div class="button-row">
            <button type="button" class="btn btn-quiet" @click="startOver">Restore another file</button>
            <button type="button" class="btn btn-primary" @click="reload"><i class="fas fa-redo" aria-hidden="true"></i> Reload AGNT</button>
          </div>
        </div>
      </template>

      <p v-if="error" class="notice bad" role="alert">
        <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>{{ error }}
        <button type="button" class="text-button" @click="startOver">Start over</button>
      </p>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { uploadBackup, startRestore, restoreStatus, discardRestore, itemCount, numberFormat, formatBytes } from '@/services/dataBackupService.js';
import './dataPanel.css';

const GROUPS = [{ id: 'work', title: 'Your work' }, { id: 'history', title: 'History' }];
const POLL_MS = 800;

const step = ref('choose');
const fileInput = ref(null);
const dragging = ref(false);
const fileName = ref('');
const fileSize = ref(0);
const uploadFraction = ref(0);
const restoreFraction = ref(0);
const jobId = ref('');
const summary = ref(null);
const chosen = ref([]);
const result = ref(null);
const error = ref('');
const busy = ref(false);
let pollTimer = null;
let unmounted = false;

const percent = (fraction) => `${Math.round(Math.min(1, Math.max(0, fraction || 0)) * 100)}%`;
const formatDate = (iso) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? 'at an unknown time' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const groups = computed(() => GROUPS
  .map((group) => ({ ...group, items: (summary.value?.categories || []).filter((c) => (c.group || 'history') === group.id) }))
  .filter((group) => group.items.length));
const restorableCount = computed(() => (summary.value?.categories || []).filter((c) => c.restorable && c.count).length);
const chosenItems = computed(() => {
  const total = (summary.value?.categories || []).filter((c) => chosen.value.includes(c.id)).reduce((sum, c) => sum + (c.count || 0), 0);
  return `${numberFormat.format(total)} ${total === 1 ? 'item' : 'items'}`;
});
const resultRows = computed(() => Object.entries(result.value?.results || {}).map(([id, counts]) => ({
  id, label: summary.value?.categories.find((c) => c.id === id)?.label || id, ...counts,
})));
const totals = computed(() => resultRows.value.reduce((sum, row) => ({ added: sum.added + row.added, existing: sum.existing + row.existing, skipped: sum.skipped + row.skipped }), { added: 0, existing: 0, skipped: 0 }));

const toggle = (id) => { chosen.value = chosen.value.includes(id) ? chosen.value.filter((x) => x !== id) : [...chosen.value, id]; };

async function upload(file) {
  if (!file) return;
  error.value = '';
  fileName.value = file.name;
  fileSize.value = file.size;
  uploadFraction.value = 0;
  step.value = 'uploading';
  try {
    const job = await uploadBackup(file, { onProgress: (fraction) => { uploadFraction.value = fraction; } });
    if (unmounted) return;
    jobId.value = job.id;
    summary.value = job.summary;
    chosen.value = job.summary.categories.filter((c) => c.restorable && c.count).map((c) => c.id);
    step.value = 'review';
  } catch (err) {
    step.value = 'choose';
    error.value = err.message;
  }
}
const onPick = (event) => { upload(event.target.files?.[0]); event.target.value = ''; };
const onDrop = (event) => { dragging.value = false; upload(event.dataTransfer?.files?.[0]); };

async function poll() {
  try {
    const job = await restoreStatus(jobId.value);
    if (unmounted) return;
    const { bytes = 0, totalBytes = 0 } = job.progress || {};
    restoreFraction.value = totalBytes ? bytes / totalBytes : 0;
    if (job.status === 'running') { pollTimer = setTimeout(poll, POLL_MS); return; }
    if (job.status === 'done') { result.value = job.result; step.value = 'done'; return; }
    error.value = job.error || 'The restore did not finish.';
    step.value = 'review';
  } catch (err) {
    error.value = err.message;
    step.value = 'review';
  }
}

async function restore() {
  busy.value = true;
  error.value = '';
  try {
    await startRestore(jobId.value, chosen.value);
    restoreFraction.value = 0;
    step.value = 'restoring';
    poll();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function startOver() {
  clearTimeout(pollTimer);
  if (jobId.value && step.value !== 'restoring') discardRestore(jobId.value).catch(() => {});
  jobId.value = ''; summary.value = null; result.value = null; chosen.value = []; error.value = '';
  step.value = 'choose';
}
const reload = () => window.location.reload();

onBeforeUnmount(() => { unmounted = true; clearTimeout(pollTimer); });
</script>

<style scoped>
.drop-zone { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 34px 20px; text-align: center; border: 1.5px dashed var(--terminal-border-color); border-radius: 12px; background: var(--color-background); transition: border-color 0.15s ease, background 0.15s ease; }
.drop-zone.over { border-color: var(--color-primary); background: rgba(var(--primary-rgb), 0.06); }
.drop-zone > i { font-size: 1.8em; color: var(--color-primary); }
.drop-zone p { margin: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.progress-block { display: flex; flex-direction: column; gap: 10px; }
.progress-block p { margin: 0; }
.file-name { color: var(--color-text); overflow-wrap: anywhere; }
.result-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.result-list li { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 14px; border: 1px solid var(--terminal-border-color); border-radius: 9px; }
.problems summary { cursor: pointer; color: var(--color-text-muted); font-size: 0.9em; }
.problems ul { margin: 8px 0 0; padding-left: 18px; color: var(--color-text-muted); font-size: 0.88em; line-height: 1.6; }
</style>
