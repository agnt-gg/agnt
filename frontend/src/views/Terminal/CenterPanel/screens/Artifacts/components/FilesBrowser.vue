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
    <header class="fb-bar">
      <nav class="fb-crumbs" aria-label="Folder">
        <template v-for="(crumb, index) in crumbs" :key="crumb.path">
          <i v-if="index" class="fas fa-chevron-right fb-sep" aria-hidden="true"></i>
          <button type="button" :aria-current="index === crumbs.length - 1 ? 'page' : undefined" @click="open(crumb.path)">{{ crumb.name }}</button>
        </template>
      </nav>
      <div class="fb-search">
        <i class="fas fa-search" aria-hidden="true"></i>
        <input v-model="query" type="search" placeholder="Search files…" aria-label="Search files" @keydown.escape="query = ''" />
      </div>
      <div class="fb-seg" role="group" aria-label="Order">
        <button type="button" :class="{ active: order === 'recent' }" @click="order = 'recent'">Recent</button>
        <button type="button" :class="{ active: order === 'name' }" @click="order = 'name'">Name</button>
      </div>
      <button type="button" class="fb-btn" @click="createItem('file')"><i class="fas fa-file-medical"></i><span>New file</span></button>
      <button type="button" class="fb-btn" @click="createItem('folder')"><i class="fas fa-folder-plus"></i><span>New folder</span></button>
      <button type="button" class="fb-btn fb-primary" @click="uploadInput?.click()"><i class="fas fa-upload"></i><span>Upload</span></button>
      <button type="button" class="fb-icon" aria-label="Workspace folder" v-tooltip="'Workspace folder'" @click="openSettings"><i class="fas fa-cog"></i></button>
      <input ref="uploadInput" type="file" multiple hidden @change="onPick" />
    </header>

    <!-- The workspace is inside the install folder: an update deletes it. -->
    <div v-if="unsafeRoot" class="fb-danger" role="alert">
      <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
      <div>
        <strong>Your files are at risk.</strong>
        {{ unsafeRoot.message }}
        <small>{{ unsafeRoot.workspaceRoot }}</small>
      </div>
      <button type="button" :disabled="busy" @click="useDefaultRoot">Use the safe default folder</button>
    </div>

    <p v-if="error" class="fb-error" role="alert">{{ error }}</p>

    <div v-if="loading" class="fb-state"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
    <div v-else-if="!shown.length" class="fb-state">
      <i :class="query ? 'fas fa-search' : 'fas fa-folder-open'"></i>
      <p>{{ query ? `Nothing matches “${query}”.` : 'This folder is empty. Drop files here, or ask Annie to make something.' }}</p>
    </div>
    <div v-else class="fb-grid" role="list">
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
            <template v-if="query && item.path.includes('/')">{{ item.path.slice(0, item.path.lastIndexOf('/')) }} · </template>
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
            <button type="button" @click="settings.root = settings.defaultRoot">Reset to default</button>
            <button type="button" @click="settings.open = false">Cancel</button>
            <button type="button" class="fb-primary" :disabled="busy" @click="saveSettings">{{ busy ? 'Saving…' : 'Save' }}</button>
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
import { createDirectory, deleteFile, getSettings, getTree, renameFile, saveFile, searchTree, updateSettings, uploadFiles } from '@/services/fileSystemService.js';
import { KIND_ICONS, breadcrumbs, formatAge, formatSize, invalidName, joinPath, kindOf, sortItems } from '../filesBrowser.js';

const emit = defineEmits(['open', 'renamed', 'deleted', 'market']);

const dir = ref('');
const items = ref([]);
const loading = ref(false);
const error = ref('');
const busy = ref(false);
const order = ref('recent');
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
  const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
  const newPath = joinPath(parent, name);
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
.fb {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 18px 22px;
  box-sizing: border-box;
  overflow-y: auto;
}
.fb-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fb-crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 160px;
  overflow: hidden;
}
.fb-crumbs button {
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
  color: var(--color-text);
}
.fb-sep {
  font-size: 9px;
  color: var(--color-text-muted);
}
.fb-search {
  position: relative;
  display: flex;
  align-items: center;
}
.fb-search i {
  position: absolute;
  left: 10px;
  font-size: 11px;
  color: var(--color-text-muted);
}
.fb-search input {
  width: 200px;
  padding: 7px 10px 7px 28px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.fb-search input:focus {
  border-color: rgba(var(--primary-rgb), 0.5);
}
.fb-seg {
  display: flex;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: hidden;
}
.fb-seg button {
  border: 0;
  background: none;
  padding: 6px 10px;
  font: inherit;
  font-size: 11.5px;
  color: var(--color-text-muted);
  cursor: pointer;
}
.fb-seg button.active {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
}
.fb-btn,
.fb-icon,
.fb-dialog-actions button,
.fb-danger button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: none;
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.fb-btn:hover,
.fb-icon:hover {
  border-color: rgba(var(--primary-rgb), 0.45);
}
.fb-primary {
  border-color: rgba(var(--primary-rgb), 0.4) !important;
  background: rgba(var(--primary-rgb), 0.08) !important;
  color: var(--color-primary) !important;
}
.fb-danger {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--red-rgb, 254, 78, 78), 0.45);
  border-radius: 10px;
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
  gap: 10px;
  padding: 60px 20px;
  color: var(--color-text-muted);
  text-align: center;
}
.fb-state i {
  font-size: 26px;
}
.fb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
}
.fb-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  background: var(--color-popup);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.12s, transform 0.12s;
}
.fb-card:hover,
.fb-card:focus-visible {
  border-color: rgba(var(--primary-rgb), 0.45);
  transform: translateY(-1px);
  outline: none;
}
.fb-thumb {
  height: 118px;
  display: grid;
  place-items: center;
  background: var(--color-darker-0);
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
.k-directory .fb-thumb i {
  color: var(--color-yellow);
}
.k-html .fb-thumb i {
  color: var(--color-primary);
}
.k-pdf .fb-thumb i {
  color: var(--color-red);
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
.fb-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.12s;
}
.fb-card:hover .fb-actions,
.fb-card:focus-within .fb-actions {
  opacity: 1;
}
.fb-actions button {
  width: 26px;
  height: 26px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 7px;
  background: var(--color-popup);
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
  border: 2px dashed rgba(var(--primary-rgb), 0.6);
  border-radius: 14px;
  background: rgba(var(--primary-rgb), 0.06);
  color: var(--color-primary);
  font-size: 14px;
  pointer-events: none;
}
.fb-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
}
.fb-dialog {
  width: min(520px, 92vw);
  padding: 18px 20px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
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
@media (max-width: 900px) {
  .fb-btn span {
    display: none;
  }
  .fb-search input {
    width: 140px;
  }
}
</style>
