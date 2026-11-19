<template>
  <!-- The Library's Files tab: your workspace, a folder at a time. A folder opens
       here; a file opens in its viewer, as every Library card opens its editor. -->
  <div data-testid="library-files">
    <nav v-if="dir" class="crumbs" aria-label="Folder" style="margin: 0 0 10px">
      <button type="button" @click="openDir('')">Files</button>
      <template v-for="(c, i) in crumbs" :key="c.path">
        <MkIcon name="chev" size="xs" />
        <b v-if="i === crumbs.length - 1">{{ c.name }}</b>
        <button v-else type="button" @click="openDir(c.path)">{{ c.name }}</button>
      </template>
    </nav>
    <div class="board-bar">
      <input v-model="query" class="field fill" type="search" :placeholder="searchLabel" :aria-label="searchLabel" autocomplete="off" spellcheck="false" />
      <div class="seg" role="radiogroup" aria-label="Sort by">
        <button
          v-for="[value, label] in FILE_SORTS"
          :key="value"
          type="button"
          role="radio"
          :aria-checked="sortBy === value ? 'true' : 'false'"
          :class="{ on: sortBy === value }"
          @click="setSort(value)"
        >{{ label }}</button>
      </div>
    </div>
    <ul class="list">
      <li v-if="loading" class="empty">Loading…</li>
      <li v-else-if="listError" class="empty">{{ listError }}</li>
      <li v-else-if="!rows.length" class="empty">{{ query ? `Nothing here matches “${query}”.` : 'This folder is empty.' }}</li>
      <template v-else>
        <li v-for="item in shownRows" :key="item.path">
          <button type="button" class="r" @click="open(item)">
            <span class="r-icon"><MkIcon :name="isFolder(item) ? 'file' : 'doc'" size="sm" /></span>
            <span class="r-text"><strong>{{ item.name }}</strong><small>{{ metaOf(item) }}</small></span>
            <MkIcon name="chev" size="sm" class="r-go" />
          </button>
        </li>
      </template>
    </ul>
    <p v-if="!loading && !listError && rows.length > shownRows.length" class="mk-muted" style="margin-top: 10px">
      Showing {{ shownRows.length }} of {{ rows.length.toLocaleString() }}. Search to find the rest.
    </p>
  </div>
</template>

<script setup>
import { ref, computed, inject, watch, onMounted } from 'vue';
import MkIcon from './MkIcon.vue';
import { getTree } from '@/services/fileSystemService.js';
import { FILE_SORTS, sortFileItems, crumbsOf, baseName, fmtSize } from '@/views/Focused/focusedFiles.js';
import { ago } from '@/views/Focused/focusedEditors.js';
import { matches } from '@/canvas/jumpIndex.js';

const props = defineProps({
  /** The open folder, as its path from the top of the workspace ('' is the top). */
  dir: { type: String, default: '' },
});
const ctx = inject('teamCtx');

// A big folder lists its first entries; search finds the rest (as on the Files page).
const CAP = 300;
const items = ref([]);
const loading = ref(true);
const listError = ref('');
const query = ref('');

// The Files page's own saved order (FocusedFiles.vue), so both list a folder alike.
const SORT_KEY = 'agnt:focused-files-sort';
function readSort() {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return FILE_SORTS.some(([value]) => value === saved) ? saved : 'name';
  } catch {
    return 'name';
  }
}
const sortBy = ref(readSort());
function setSort(value) {
  sortBy.value = value;
  try {
    localStorage.setItem(SORT_KEY, value);
  } catch {
    /* storage disabled: the order still holds while the page is open */
  }
}

const rows = computed(() => sortFileItems(items.value.filter((i) => matches(query.value, i.name)), sortBy.value));
const shownRows = computed(() => rows.value.slice(0, CAP));
const crumbs = computed(() => crumbsOf(props.dir));
const searchLabel = computed(() => `Search ${props.dir ? baseName(props.dir) : 'files'}`);
const isFolder = (item) => item.type === 'directory';
const metaOf = (item) => (isFolder(item) ? 'Folder' : [fmtSize(item.size), item.modifiedAt ? ago(item.modifiedAt) : ''].filter(Boolean).join(' · '));

// Only the newest listing lands: a slow answer for a folder already left is dropped.
let latest = 0;
async function load() {
  const ticket = ++latest;
  loading.value = true;
  listError.value = '';
  try {
    const body = await getTree(props.dir, { details: true });
    if (ticket !== latest) return;
    items.value = body?.items || [];
    if (body?.missingRoot) listError.value = 'The workspace folder is missing. Choose it again in Settings.';
  } catch (e) {
    if (ticket !== latest) return;
    items.value = [];
    listError.value = 'Couldn’t open this folder. ' + (e?.message || e);
  } finally {
    if (ticket === latest) loading.value = false;
  }
}

const openDir = (path) => ctx.go({ view: 'library', tab: 'files', dir: path });
const open = (item) => (isFolder(item) ? openDir(item.path) : ctx.openLibrary('files', item.path));

onMounted(load);
watch(
  () => props.dir,
  () => {
    query.value = '';
    load();
  },
);
</script>
