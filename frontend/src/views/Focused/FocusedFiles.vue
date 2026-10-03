<template>
  <!-- One file: read it, and edit it when it is text. -->
  <FocusedEditor
    v-if="filePath"
    kind-label="Files"
    :back-label="parentLabel"
    :icon="fileIcon"
    :name="baseName(filePath)"
    name-read-only
    :description="null"
    :meta="fileMeta"
    :note="fileNote"
    :show-foot="false"
    :chat-ask="editAsk('file', filePath)"
    :dirty="dirty"
    :saving="saving"
    :error="error"
    @back="leaveFile"
    @save="save"
    @discard="content = baseline"
    @ask="nav.ask"
  >
    <template #actions>
      <button type="button" class="focused-btn" @click="openWithSystem">Open with system</button>
    </template>

    <p v-if="loading" class="focused-empty">Loading…</p>
    <template v-else>
      <AutoTextarea v-if="editable" v-model="content" class="focused-code-edit" spellcheck="false" :aria-label="'Contents of ' + baseName(filePath)" />
      <pre v-else-if="textTooLong" class="focused-code-edit">{{ content.slice(0, TEXT_LIMIT) }}</pre>
      <div v-else-if="kind === 'image'" class="focused-file-media"><img :src="mediaUrl" :alt="baseName(filePath)" /></div>
      <PdfFrame v-else-if="kind === 'pdf'" class="focused-file-frame" :src="mediaUrl" :label="baseName(filePath)" />
      <iframe v-else-if="kind === 'html'" class="focused-file-frame" :src="mediaUrl" sandbox="allow-scripts allow-same-origin" :aria-label="baseName(filePath)"></iframe>
      <video v-else-if="kind === 'video'" class="focused-file-media" :src="mediaUrl" controls></video>
      <audio v-else-if="kind === 'audio'" :src="mediaUrl" controls></audio>
    </template>
  </FocusedEditor>

  <!-- A folder. -->
  <FocusedPage
    v-else
    :title="FOCUSED_PAGES.library.title"
    :sub="FOCUSED_PAGES.library.sub"
    action-label="New file"
    v-model:query="query"
    :search-placeholder="`Search ${dir ? baseName(dir) : 'files'}`"
    @action="nav.ask(createAsk('file', { within: dir }))"
  >
    <template #tabs><slot name="tabs" /></template>

    <div class="focused-files-bar">
      <nav class="focused-crumbs" aria-label="Folder">
        <button type="button" class="focused-crumb" :class="{ current: !dir }" @click="openDir('')">Files</button>
        <template v-for="c in crumbs" :key="c.path">
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
          <button type="button" class="focused-crumb" :class="{ current: c.path === dir }" @click="openDir(c.path)">{{ c.name }}</button>
        </template>
      </nav>
      <div class="focused-segmented" role="radiogroup" aria-label="Sort by">
        <button
          v-for="[value, label] in FILE_SORTS"
          :key="value"
          type="button"
          role="radio"
          :aria-checked="sortBy === value ? 'true' : 'false'"
          :class="{ active: sortBy === value }"
          @click="setSort(value)"
        >{{ label }}</button>
      </div>
    </div>

    <p v-if="loading" class="focused-empty">Loading…</p>
    <p v-else-if="listError" class="focused-empty">{{ listError }}</p>
    <p v-else-if="!rows.length" class="focused-empty">{{ query ? `Nothing here matches “${query}”.` : 'This folder is empty.' }}</p>
    <ul v-else class="focused-list">
      <li v-for="item in rows.slice(0, CAP)" :key="item.path">
        <button type="button" class="focused-row" @click="item.type === 'directory' ? openDir(item.path) : openFile(item.path)">
          <span class="focused-row-icon" aria-hidden="true"><i :class="item.type === 'directory' ? 'fas fa-folder' : iconFor(item.name)"></i></span>
          <span class="focused-row-text">
            <strong>{{ item.name }}</strong>
            <small>{{ item.type === 'directory' ? 'Folder' : [fmtSize(item.size), item.modifiedAt ? ago(item.modifiedAt) : ''].filter(Boolean).join(' · ') }}</small>
          </span>
          <i class="fas fa-chevron-right focused-row-go" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
    <MarketplaceShelf asset-type="file" variant="strip" fallback-to-all @browse="item => nav.openScreen('MarketplaceScreen', item?.asset_id ? { item: item.asset_id } : {})" />
    <p v-if="rows.length > CAP" class="focused-foot-note">Showing {{ CAP }} of {{ rows.length.toLocaleString() }}. Search to find the rest.</p>
  </FocusedPage>
</template>

<script setup>
import { ref, computed, inject, watch, onMounted } from 'vue';
import FocusedPage from './FocusedPage.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import FocusedEditor from './FocusedEditor.vue';
import AutoTextarea from './AutoTextarea.vue';
import PdfFrame from '@/views/_components/common/PdfFrame.vue';
import { FOCUSED_PAGES, createAsk, editAsk } from './focusedModel.js';
import { ago } from './focusedEditors.js';
import { fileKind, fmtSize, iconFor, baseName, parentDir, crumbsOf, FILE_SORTS, sortFileItems } from './focusedFiles.js';
import { getTree, getFile, saveFile, rawFileUrl } from '@/services/fileSystemService.js';
import { getWorkspaceRoot, artifactSelectToWorkspacePath } from '@/utils/workspacePath.js';
import { openLocalPath } from '@/utils/openLocalFile.js';
import { matches } from '@/canvas/jumpIndex.js';

const props = defineProps({
  dir: { type: String, default: '' },
  /** The `artifact:` id: a workspace-relative path or a file:/// URL. */
  file: { type: String, default: '' },
});
const nav = inject('focusedNav');

const root = ref('');
const loading = ref(false);
// A big folder renders its first entries (measured: the workspace root holds
// 2,589); search narrows it, as the other lists do.
const CAP = 300;
const query = ref('');

// ── Folder ─────────────────────────────────────────────────────────────────
const items = ref([]);
const listError = ref('');
// The chosen order is a preference: it outlives the folder and the session.
const SORT_KEY = 'agnt:focused-files-sort';
const readSort = () => {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return FILE_SORTS.some(([v]) => v === saved) ? saved : 'name';
  } catch {
    return 'name';
  }
};
const sortBy = ref(readSort());
function setSort(value) {
  sortBy.value = value;
  try {
    localStorage.setItem(SORT_KEY, value);
  } catch {
    /* storage disabled: the order still applies until the page closes */
  }
}
const rows = computed(() => sortFileItems(items.value.filter((i) => matches(query.value, i.name)), sortBy.value));
const crumbs = computed(() => crumbsOf(props.dir));

async function loadDir() {
  loading.value = true;
  listError.value = '';
  try {
    const body = await getTree(props.dir, { details: true });
    items.value = body.items || [];
    if (body.missingRoot) listError.value = 'The workspace folder is missing. Choose it again in Settings.';
  } catch (e) {
    items.value = [];
    listError.value = 'Couldn’t open this folder. ' + (e?.message || e);
  } finally {
    loading.value = false;
  }
}
const openDir = (path) => nav.go({ page: 'library', tab: 'files', dir: path });
const openFile = (path) => nav.go({ page: 'library', tab: 'files', item: path });

// ── File ───────────────────────────────────────────────────────────────────
// The intent may be an absolute file:/// URL (chat links) or a relative path;
// both resolve to a workspace path through the rule Studio's Files uses.
const filePath = computed(() => (props.file ? artifactSelectToWorkspacePath('artifact:' + props.file, root.value) || '' : ''));
const kind = computed(() => fileKind(filePath.value));
const absPath = computed(() => (root.value && filePath.value ? `${root.value.replace(/[\\/]+$/, '')}/${filePath.value}` : ''));
// Workspace bytes, by the same route Studio's Files previews them with.
const mediaUrl = computed(() => (filePath.value ? rawFileUrl(filePath.value) : ''));
const fileIcon = computed(() => iconFor(filePath.value));
const parentLabel = computed(() => baseName(parentDir(filePath.value)) || 'Files');

// Past this a file is shown, not edited: a textarea holding megabytes makes
// every keystroke slow (measured: a 765 KB JSON). Same limit as the preview.
const TEXT_LIMIT = 200_000;
const content = ref('');
const baseline = ref('');
const textReadable = ref(false);
const fileInfo = ref({});
const textTooLong = computed(() => textReadable.value && content.value.length > TEXT_LIMIT);
const editable = computed(() => textReadable.value && !textTooLong.value);
const dirty = computed(() => editable.value && content.value !== baseline.value);
const saving = ref(false);
const error = ref('');
const fileMeta = computed(() => fmtSize(fileInfo.value.size));
const fileNote = computed(() => {
  if (textTooLong.value) return `This file is long (${fmtSize(fileInfo.value.size || content.value.length)}), so it is shown here but not edited. Open it with the system app to change it.`;
  if (loading.value || editable.value || ['image', 'html', 'pdf', 'video', 'audio'].includes(kind.value)) return '';
  if (fileInfo.value.reason === 'too_large') return `This file is too large to show here (${fmtSize(fileInfo.value.size)}). Open it with the system app.`;
  return 'This file isn’t text, so it can’t be shown here. Open it with the system app.';
});

async function loadFile() {
  loading.value = true;
  error.value = '';
  textReadable.value = false;
  fileInfo.value = {};
  try {
    if (['image', 'html', 'pdf', 'video', 'audio'].includes(kind.value)) return; // shown by URL
    const f = await getFile(filePath.value);
    fileInfo.value = f || {};
    if (f && !f.noPreview && typeof f.content === 'string') {
      content.value = baseline.value = f.content;
      textReadable.value = true;
    }
  } catch (e) {
    error.value = 'Couldn’t open this file. ' + (e?.message || e);
  } finally {
    loading.value = false;
  }
}
async function save() {
  saving.value = true;
  error.value = '';
  try {
    await saveFile(filePath.value, content.value);
    baseline.value = content.value;
    nav.toast('Saved.');
  } catch (e) {
    error.value = 'Couldn’t save. ' + (e?.message || e);
  } finally {
    saving.value = false;
  }
}
async function leaveFile() {
  if (dirty.value && !(await nav.confirm({ title: 'Discard changes?', message: 'Your edits haven’t been saved.', confirmText: 'Discard', danger: true }))) return;
  openDir(parentDir(filePath.value));
}
function openWithSystem() {
  if (absPath.value) openLocalPath(absPath.value);
}

async function refresh() {
  if (!root.value) root.value = (await getWorkspaceRoot().catch(() => '')) || '';
  if (props.file) {
    if (!filePath.value) {
      error.value = 'This file is outside your workspace, so it can’t be opened here.';
      return;
    }
    await loadFile();
  } else {
    await loadDir();
  }
}
onMounted(refresh);
watch(() => [props.dir, props.file], () => {
  query.value = '';
  refresh();
});
</script>
