<template>
  <section
    class="fb"
    :class="{ 'fb-dropping': dragDepth > 0 }"
    aria-label="Workspace files"
    @dragenter.prevent="dragDepth++"
    @dragover.prevent
    @dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)"
    @drop.prevent="onDrop"
  >
    <!-- The library-page header every BUILD screen uses (ScreenToolbar). -->
    <ScreenToolbar
      title="FILES"
      :count="shown.length"
      :count-label="shown.length === 1 ? 'item' : 'items'"
      search-placeholder="Search files…"
      :search-query="query"
      :current-layout="layout"
      :layout-options="LAYOUTS"
      :show-collapse-toggle="false"
      :show-hide-empty="false"
      :show-sort="false"
      create-label="Upload"
      @update:search-query="(value) => (query = value)"
      @update:layout="setLayout"
      @create="uploadInput?.click()"
    >
      <template #extra-buttons>
        <div class="fb-seg" role="group" aria-label="Order">
          <button type="button" class="fb-tool" :class="{ active: order === 'recent' }" @click="order = 'recent'"><i class="fas fa-clock"></i><span class="fb-tool-label">Recent</span></button>
          <button type="button" class="fb-tool" :class="{ active: order === 'name' }" @click="order = 'name'"><i class="fas fa-sort-alpha-down"></i><span class="fb-tool-label">Name</span></button>
        </div>
        <button type="button" class="fb-tool" v-tooltip="'New file'" @click="createItem('file')"><i class="fas fa-file-medical"></i><span class="fb-tool-label">New file</span></button>
        <button type="button" class="fb-tool" v-tooltip="'New folder'" @click="createItem('folder')"><i class="fas fa-folder-plus"></i><span class="fb-tool-label">New folder</span></button>
        <button type="button" class="fb-tool" aria-label="Workspace folder" v-tooltip="'Workspace folder'" @click="openSettings"><i class="fas fa-cog"></i></button>
      </template>
    </ScreenToolbar>
    <input ref="uploadInput" type="file" multiple hidden @change="onPick" />

    <nav class="fb-crumbs" aria-label="Folder">
      <template v-for="(crumb, index) in crumbs" :key="crumb.path">
        <i v-if="index" class="fas fa-chevron-right fb-sep" aria-hidden="true"></i>
        <button type="button" :aria-current="index === crumbs.length - 1 ? 'page' : undefined" @click="open(crumb.path)">
          <i v-if="!index" class="fas fa-home" aria-hidden="true"></i>{{ crumb.name }}
        </button>
      </template>
    </nav>

    <!-- The workspace is inside the install folder: an update deletes it. -->
    <div v-if="unsafeRoot" class="fb-danger" role="alert">
      <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
      <div>
        <strong>Your files are at risk.</strong>
        {{ unsafeRoot.message }}
        <small>{{ unsafeRoot.workspaceRoot }}</small>
      </div>
      <button type="button" class="fb-tool" :disabled="busy" @click="useDefaultRoot">Use the safe default folder</button>
    </div>

    <p v-if="error" class="fb-error" role="alert">{{ error }}</p>

    <div v-if="loading" class="fb-state"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
    <div v-else-if="!shown.length" class="fb-state">
      <span class="fb-state-mark"><i :class="query ? 'fas fa-search' : 'fas fa-folder-open'"></i></span>
      <p>{{ query ? `Nothing matches “${query}”.` : 'This folder is empty. Drop files here, or ask Annie to make something.' }}</p>
    </div>

    <!-- Grid -->
    <div v-else-if="layout === 'grid'" class="fb-grid" role="list">
      <article
        v-for="item in shown"
        :key="item.path"
        class="fb-card"
        :class="'k-' + kindOf(item)"
        role="listitem"
        tabindex="0"
        @click="activate(item)"
        @keydown.enter="activate(item)"
      >
        <div class="fb-thumb">
          <img v-if="kindOf(item) === 'image'" :src="rawUrl(item.path)" :alt="item.name" loading="lazy" />
          <i v-else :class="KIND_ICONS[kindOf(item)] || KIND_ICONS.text" aria-hidden="true"></i>
        </div>
        <div class="fb-meta">
          <strong v-tooltip="item.name">{{ item.name }}</strong>
          <small>
            <template v-if="query && parentOf(item.path)">{{ parentOf(item.path) }} · </template>
            <template v-if="item.type === 'directory'">Folder</template>
            <template v-else>{{ formatSize(item.size) }}</template>
            <template v-if="item.modifiedAt"> · {{ formatAge(item.modifiedAt) }}</template>
          </small>
        </div>
        <div class="fb-actions" @click.stop>
          <button type="button" :aria-label="'Rename ' + item.name" v-tooltip="'Rename'" @click="rename(item)"><i class="fas fa-pen"></i></button>
          <button type="button" class="danger" :aria-label="'Delete ' + item.name" v-tooltip="'Delete'" @click="remove(item)"><i class="fas fa-trash"></i></button>
        </div>
      </article>
    </div>

    <!-- List -->
    <div v-else class="fb-list" role="table" aria-label="Files">
      <div class="fb-row fb-head" role="row">
        <button type="button" role="columnheader" class="fb-col-name" :aria-sort="order === 'name' ? 'ascending' : 'none'" @click="order = 'name'">Name<i v-if="order === 'name'" class="fas fa-caret-down"></i></button>
        <span role="columnheader" class="fb-col-kind">Kind</span>
        <span role="columnheader" class="fb-col-size">Size</span>
        <button type="button" role="columnheader" class="fb-col-age" :aria-sort="order === 'recent' ? 'descending' : 'none'" @click="order = 'recent'">Modified<i v-if="order === 'recent'" class="fas fa-caret-down"></i></button>
        <span class="fb-col-actions" aria-hidden="true"></span>
      </div>
      <div
        v-for="item in shown"
        :key="item.path"
        class="fb-row"
        :class="'k-' + kindOf(item)"
        role="row"
        tabindex="0"
        @click="activate(item)"
        @keydown.enter="activate(item)"
      >
        <span role="cell" class="fb-col-name">
          <i class="fb-row-icon" :class="KIND_ICONS[kindOf(item)] || KIND_ICONS.text" aria-hidden="true"></i>
          <span class="fb-row-name" v-tooltip="item.name">{{ item.name }}</span>
          <small v-if="query && parentOf(item.path)" class="fb-row-path">{{ parentOf(item.path) }}</small>
        </span>
        <span role="cell" class="fb-col-kind">{{ kindLabel(item) }}</span>
        <span role="cell" class="fb-col-size">{{ item.type === 'directory' ? '—' : formatSize(item.size) }}</span>
        <span role="cell" class="fb-col-age">{{ item.modifiedAt ? formatAge(item.modifiedAt) : '—' }}</span>
        <span role="cell" class="fb-col-actions fb-actions" @click.stop>
          <button type="button" :aria-label="'Rename ' + item.name" v-tooltip="'Rename'" @click="rename(item)"><i class="fas fa-pen"></i></button>
          <button type="button" class="danger" :aria-label="'Delete ' + item.name" v-tooltip="'Delete'" @click="remove(item)"><i class="fas fa-trash"></i></button>
        </span>
      </div>
    </div>

    <MarketplaceShelf asset-type="file" variant="strip" fallback-to-all @browse="item => emit('market', item)" />
    <p v-if="truncated" class="fb-note">Showing the first results. Narrow the search to see more.</p>

    <div v-if="dragDepth > 0" class="fb-drop" aria-hidden="true">
      <i class="fas fa-cloud-upload-alt"></i> Drop to upload into {{ crumbs[crumbs.length - 1].name }}
    </div>

    <Teleport to="body">
      <div v-if="settings.open" class="fb-overlay" @click.self="settings.open = false">
        <div class="fb-dialog" role="dialog" aria-modal="true" aria-label="Workspace folder">
          <h3><i class="fas fa-cog"></i> Workspace folder</h3>
          <WorkspacePicker
            v-model="settings.root"
            input-id="filesWorkspaceRoot"
            label="Root directory"
            :default-path="settings.defaultRoot"
            :error="settings.error"
            @submit="saveSettings"
            @cancel="settings.open = false"
          />
          <div class="fb-dialog-actions">
            <button type="button" class="fb-tool" @click="settings.root = settings.defaultRoot">Reset to default</button>
            <button type="button" class="fb-tool" @click="settings.open = false">Cancel</button>
            <button type="button" class="fb-tool fb-primary" :disabled="busy" @click="saveSettings">{{ busy ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
    <SimpleModal ref="modal" />
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import WorkspacePicker from '@/components/WorkspacePicker.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import { createDirectory, deleteFile, getSettings, getTree, renameFile, saveFile, searchTree, updateSettings, uploadFiles } from '@/services/fileSystemService.js';
import { KIND_ICONS, LAYOUTS, breadcrumbs, formatAge, formatSize, invalidName, joinPath, kindLabel, kindOf, parentOf, readLayout, sortItems, writeLayout } from '../filesBrowser.js';

const emit = defineEmits(['open', 'renamed', 'deleted', 'market']);

const dir = ref('');
const items = ref([]);
const loading = ref(false);
const error = ref('');
const busy = ref(false);
const order = ref('recent');
const layout = ref(readLayout());
function setLayout(next) {
  layout.value = next;
  writeLayout(next);
}
const query = ref('');
const results = ref([]);
const truncated = ref(false);
const dragDepth = ref(0);
const uploadInput = ref(null);
const modal = ref(null);
const unsafeRoot = ref(null);
const settings = reactive({ open: false, root: '', defaultRoot: '', error: '' });

const crumbs = computed(() => breadcrumbs(dir.value));
const shown = computed(() => sortItems(query.value.trim() ? results.value : items.value, order.value));
const rawUrl = (path) => `${API_CONFIG.BASE_URL}/filesystem/raw?path=${encodeURIComponent(path)}`;

// Each load carries a version so a slow response for a folder the user has
// already left can never overwrite the one they are looking at.
let loadVersion = 0;
async function load() {
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  try {
    const response = await getTree(dir.value, { details: true });
    if (version === loadVersion) items.value = response.items || [];
  } catch (e) {
    if (version === loadVersion) error.value = `Could not read this folder: ${e.message}`;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function open(path) {
  query.value = '';
  dir.value = path;
}

function activate(item) {
  if (item.type === 'directory') open(item.path);
  else emit('open', item.path);
}

let searchTimer = null;
let searchVersion = 0;
watch(query, (value) => {
  clearTimeout(searchTimer);
  if (!value.trim()) {
    results.value = [];
    truncated.value = false;
    return;
  }
  searchTimer = setTimeout(async () => {
    const version = ++searchVersion;
    try {
      const response = await searchTree(value.trim(), dir.value);
      if (version !== searchVersion) return;
      results.value = response.items || [];
      truncated.value = !!response.truncated;
    } catch (e) {
      if (version === searchVersion) error.value = `Search failed: ${e.message}`;
    }
  }, 200);
});

watch(dir, load);

async function run(action, failure) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    await load();
  } catch (e) {
    error.value = `${failure}: ${e.message}`;
  } finally {
    busy.value = false;
  }
}

async function ask(title, defaultValue = '') {
  const value = await modal.value.showModal({ title, isPrompt: true, defaultValue, confirmText: 'OK' });
  return value === null ? null : String(value).trim();
}

async function createItem(kind) {
  const name = await ask(kind === 'file' ? 'New file name' : 'New folder name', kind === 'file' ? 'untitled.md' : '');
  if (name === null) return;
  const problem = invalidName(name, items.value);
  if (problem) return void (error.value = problem);
  const path = joinPath(dir.value, name);
  await run(() => (kind === 'file' ? saveFile(path, '') : createDirectory(path)), `Could not create ${name}`);
  if (kind === 'file' && !error.value) emit('open', path);
}

async function rename(item) {
  const name = await ask(`Rename ${item.name}`, item.name);
  if (name === null || name === item.name) return;
  const siblings = items.value.filter((other) => other.path !== item.path);
  const problem = invalidName(name, siblings);
  if (problem) return void (error.value = problem);
  const newPath = joinPath(parentOf(item.path), name);
  await run(() => renameFile(item.path, newPath), `Could not rename ${item.name}`);
  if (!error.value) emit('renamed', { oldPath: item.path, newPath });
}

async function remove(item) {
  const folder = item.type === 'directory';
  const confirmed = await modal.value.showModal({
    title: `Delete ${item.name}?`,
    message: folder ? 'The folder and everything in it will be deleted.' : 'This cannot be undone.',
    confirmText: 'Delete',
    confirmClass: 'btn-danger',
  });
  if (!confirmed) return;
  await run(() => deleteFile(item.path), `Could not delete ${item.name}`);
  if (!error.value) emit('deleted', { path: item.path, type: item.type });
}

async function upload(files) {
  if (!files?.length) return;
  await run(() => uploadFiles(dir.value, files), 'Upload failed');
}
const onPick = (event) => {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  upload(files);
};
const onDrop = (event) => {
  dragDepth.value = 0;
  upload([...(event.dataTransfer?.files || [])]);
};

async function readSettings() {
  try {
    const data = await getSettings();
    unsafeRoot.value = data.unsafeRoot || null;
    settings.root = data.workspaceRoot || data.defaultRoot || '';
    settings.defaultRoot = data.defaultRoot || '';
  } catch (e) {
    error.value = `Could not read workspace settings: ${e.message}`;
  }
}
async function openSettings() {
  settings.error = '';
  await readSettings();
  settings.open = true;
}
async function applyRoot(root) {
  await updateSettings(root);
  unsafeRoot.value = null;
  dir.value === '' ? await load() : (dir.value = '');
}
async function saveSettings() {
  if (!settings.root.trim()) return void (settings.error = 'Choose a folder.');
  busy.value = true;
  settings.error = '';
  try {
    await applyRoot(settings.root.trim());
    settings.open = false;
  } catch (e) {
    settings.error = e.message;
  } finally {
    busy.value = false;
  }
}
async function useDefaultRoot() {
  if (!settings.defaultRoot) await readSettings();
  await run(() => applyRoot(settings.defaultRoot), 'Could not switch folders');
}

onMounted(() => {
  load();
  readSettings();
});

// A file Annie writes while this grid is open should appear without a refresh.
defineExpose({ refresh: load });
</script>

<style scoped>
/* Files is a library page: the ScreenToolbar header and the card language of
   Skills / Widgets (darker-0 surface, terminal border, green on hover). */
.fb {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 16px 20px 20px;
  box-sizing: border-box;
  overflow-y: auto;
}
.fb :deep(.wm-header) {
  width: 100%;
  padding: 0 0 14px;
  box-sizing: border-box;
}

/* Toolbar extras: the same metrics as ScreenToolbar's .wm-btn. */
.fb-tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.5px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.12s;
}
.fb-tool:hover:not(:disabled) {
  color: var(--color-text);
}
.fb-tool:disabled {
  opacity: 0.5;
  cursor: default;
}
.fb-tool.active {
  color: var(--text-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}
.fb-primary {
  color: var(--text-green);
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.06);
}
.fb-seg {
  display: flex;
}
.fb-seg .fb-tool:first-child {
  border-radius: 8px 0 0 8px;
}
.fb-seg .fb-tool:last-child {
  border-radius: 0 8px 8px 0;
  margin-left: -1px;
}
@container screen-toolbar (max-width: 900px) {
  .fb-tool-label {
    display: none;
  }
}

/* Breadcrumbs */
.fb-crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.fb-crumbs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: none;
  padding: 4px 2px;
  font: inherit;
  font-size: 13px;
  color: var(--color-text-muted);
  cursor: pointer;
  white-space: nowrap;
}
.fb-crumbs button[aria-current='page'] {
  color: var(--color-text);
  font-weight: 500;
}
.fb-crumbs button:hover {
  color: var(--text-green);
}
.fb-sep {
  font-size: 9px;
  color: var(--color-text-muted);
}

/* Notices */
.fb-danger {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid rgba(var(--red-rgb, 254, 78, 78), 0.45);
  border-radius: 12px;
  background: rgba(var(--red-rgb, 254, 78, 78), 0.08);
  font-size: 12.5px;
}
.fb-danger > i {
  color: var(--color-red);
}
.fb-danger div {
  flex: 1;
}
.fb-danger small {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  word-break: break-all;
}
.fb-error {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-red);
}
.fb-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 20px;
  color: var(--color-text-muted);
  text-align: center;
}
.fb-state-mark {
  display: inline-grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 50%;
  color: var(--text-green);
  font-size: 16px;
}
.fb-state p {
  margin: 0;
  max-width: 360px;
  line-height: 1.5;
}

/* Kind colours, shared by grid and list. */
.k-directory i.fb-row-icon,
.k-directory .fb-thumb i {
  color: var(--text-yellow);
}
.k-html i.fb-row-icon,
.k-html .fb-thumb i {
  color: var(--text-green);
}
.k-pdf i.fb-row-icon,
.k-pdf .fb-thumb i {
  color: var(--color-red);
}
.k-image i.fb-row-icon,
.k-video i.fb-row-icon,
.k-video .fb-thumb i {
  color: var(--text-info);
}

/* Grid */
.fb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.fb-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--terminal-border-color);
  border-radius: 14px;
  background: var(--color-darker-0);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.fb-card:hover,
.fb-card:focus-visible {
  border-color: rgba(var(--green-rgb), 0.45);
  transform: translateY(-1px);
  outline: none;
}
.fb-thumb {
  height: 112px;
  display: grid;
  place-items: center;
  border-bottom: 1px solid var(--terminal-border-color);
  overflow: hidden;
}
.fb-thumb i {
  font-size: 30px;
  color: var(--color-text-muted);
}
.fb-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fb-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px 12px;
  min-width: 0;
}
.fb-meta strong {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-meta small {
  font-size: 11px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-card .fb-actions {
  position: absolute;
  top: 8px;
  right: 8px;
}

/* Row/card verbs: hidden until hover or focus. */
.fb-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.12s;
}
.fb-card:hover .fb-actions,
.fb-card:focus-within .fb-actions,
.fb-row:hover .fb-actions,
.fb-row:focus-within .fb-actions {
  opacity: 1;
}
.fb-actions button {
  width: 26px;
  height: 26px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 7px;
  background: var(--color-darker-0);
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
}
.fb-actions button:hover {
  color: var(--color-text);
}
.fb-actions button.danger:hover {
  color: var(--color-red);
}

/* List */
.fb-list {
  border: 1px solid var(--terminal-border-color);
  border-radius: 14px;
  background: var(--color-darker-0);
  overflow: hidden;
}
.fb-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px 90px 110px 66px;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  min-height: 42px;
  font-size: 12.5px;
  cursor: pointer;
}
.fb-row + .fb-row {
  border-top: 1px solid var(--terminal-border-color);
}
.fb-row:not(.fb-head):hover,
.fb-row:not(.fb-head):focus-visible {
  background: rgba(var(--green-rgb), 0.05);
  outline: none;
}
.fb-head {
  min-height: 34px;
  cursor: default;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.fb-head button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  cursor: pointer;
  justify-self: start;
}
.fb-head button:hover,
.fb-head button[aria-sort='ascending'],
.fb-head button[aria-sort='descending'] {
  color: var(--text-green);
}
.fb-col-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.fb-row-icon {
  width: 16px;
  text-align: center;
  color: var(--color-text-muted);
  flex: 0 0 auto;
}
.fb-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-row-path {
  color: var(--color-text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}
.fb-col-kind,
.fb-col-size,
.fb-col-age {
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fb-col-actions {
  justify-content: flex-end;
}

.fb-note {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-muted);
}
.fb-drop {
  position: absolute;
  inset: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed rgba(var(--green-rgb), 0.6);
  border-radius: 16px;
  background: rgba(var(--green-rgb), 0.06);
  color: var(--text-green);
  font-size: 14px;
  pointer-events: none;
}
.fb-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: var(--scrim);
}
.fb-dialog {
  width: min(520px, 92vw);
  padding: 18px 20px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  background: var(--color-popup);
}
.fb-dialog h3 {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 600;
}
.fb-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
@media (max-width: 760px) {
  .fb-row {
    grid-template-columns: minmax(0, 1fr) 80px 66px;
  }
  .fb-col-kind,
  .fb-col-size {
    display: none;
  }
}
</style>
