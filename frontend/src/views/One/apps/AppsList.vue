<template>
  <div ref="root" class="za-list">
    <div class="toolbar">
      <div class="dd">
        <button type="button" class="field" aria-haspopup="menu" :aria-expanded="menu === 'viewby'" data-action="view-by" @click.stop="toggleMenu('viewby')">
          <span class="k">View by:</span><b>{{ viewLabel }}</b><AppsGlyph name="sort" size="sm" />
        </button>
        <div v-if="menu === 'viewby'" class="menu" role="menu" @click.stop>
          <button
            v-for="[id, label] in spec.views"
            :key="id"
            type="button"
            class="mi"
            :class="{ on: view === id }"
            role="menuitemradio"
            :aria-checked="view === id"
            :data-view="id"
            @click="setView(id)"
          >
            {{ label }}<span v-if="view === id" class="chk"><AppsGlyph name="check" size="sm" /></span>
          </button>
        </div>
      </div>
      <label class="search">
        <AppsGlyph name="find" size="sm" />
        <input v-model="q" type="text" :placeholder="spec.search" :aria-label="spec.search" autocomplete="off" spellcheck="false" data-testid="apps-search" />
        <button v-if="q" type="button" class="clear" aria-label="Clear search" @click="q = ''"><AppsGlyph name="x" size="sm" /></button>
      </label>
      <div class="dd">
        <button type="button" class="field" aria-haspopup="dialog" :aria-expanded="menu === 'filters'" data-action="filters" @click.stop="toggleMenu('filters')">
          <AppsGlyph name="filter" size="sm" /><b>Filters</b><span v-if="activeFilters" class="badge">{{ activeFilters }}</span>
        </button>
        <div v-if="menu === 'filters'" class="menu right filters-pop" role="dialog" aria-label="Filters" @click.stop>
          <template v-for="facet in spec.filters" :key="facet.id">
            <div class="mi-head">{{ facet.label }}</div>
            <label v-for="choice in facet.options" :key="choice.id" class="fopt">
              <input type="checkbox" :data-filter="`${facet.id}:${choice.id}`" :checked="isChosen(facet.id, choice.id)" @change="setFilter(facet.id, choice.id, $event.target.checked)" />
              {{ choice.label }}<span class="n">{{ rows.filter(choice.test).length }}</span>
            </label>
          </template>
          <div class="fpop-foot">
            <button type="button" class="btn sm" @click="clearFilters">Clear all</button>
            <button type="button" class="primary sm" @click="menu = null">Done</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="selected.size" class="bulk" role="region" aria-label="Selected">
      <b>{{ selected.size }} selected</b>
      <slot name="bulk" :rows="selectedRows" :clear="clearSelection" />
      <span class="grow"></span>
      <button type="button" class="btn sm" @click="clearSelection">Clear selection</button>
    </div>

    <slot v-if="!rows.length" name="empty" />
    <div v-else class="tbl" role="table" :aria-label="label" :style="{ '--za-cols': template }">
      <div class="tr th" role="row">
        <div class="td cb" role="columnheader">
          <input ref="selectAll" type="checkbox" :checked="allChosen" aria-label="Select all" @change="chooseAll($event.target.checked)" />
        </div>
        <div v-for="head in shownHeads" :key="head.id" class="td" role="columnheader" :aria-sort="ariaSort(head)">
          <button v-if="sortKey(head)" type="button" class="th-btn" :class="{ on: sort[0] === sortKey(head) }" :data-sort="sortKey(head)" @click="sortBy(sortKey(head))">
            {{ head.label }}<span v-if="head.tip" class="tip-i" v-tooltip="head.tip"><AppsGlyph name="info" size="xs" /></span>
            <span class="srt"><AppsGlyph :name="sort[0] === sortKey(head) ? (sort[1] > 0 ? 'arrowUp' : 'arrowDown') : 'sort'" size="xs" /></span>
          </button>
          <span v-else class="th-plain">{{ head.label }}<span v-if="head.tip" class="tip-i" v-tooltip="head.tip"><AppsGlyph name="info" size="xs" /></span></span>
        </div>
        <div class="td" aria-hidden="true"></div>
      </div>

      <div v-if="!visible.length" class="tbl-empty">
        <div class="empty">
          <span class="em-icon"><AppsGlyph name="find" /></span>
          <h3>No {{ noun }} matches</h3>
          <p>{{ q ? `Nothing matches “${q}”.` : 'Nothing matches these filters.' }}</p>
          <div class="row-gap"><button type="button" class="btn" @click="resetView">Clear search and filters</button></div>
        </div>
      </div>
      <template v-else>
      <template v-for="group in groups" :key="group.label || 'all'">
        <div v-if="group.label" class="tr group" role="row">
          <div class="td">{{ group.label }}<span class="n">&nbsp;· {{ group.rows.length }}</span></div>
        </div>
        <div
          v-for="row in group.rows"
          :key="row.id"
          class="tr body-row"
          :class="{ sel: selected.has(row.id), 'static-row': !openable, flash: row.id === flashId }"
          role="row"
          :data-row="row.id"
          @click="onRowClick(row, $event)"
        >
          <div class="td cb">
            <input type="checkbox" :checked="selected.has(row.id)" :aria-label="`Select ${rowLabel(row)}`" @click.stop @change="choose(row.id, $event.target.checked)" />
          </div>
          <div v-for="head in shownHeads" :key="head.id" class="td" :class="`col-${head.id}`">
            <slot :name="`cell-${head.id}`" :row="row" />
          </div>
          <div class="td kebab">
            <button type="button" class="icon-btn" :class="{ on: menu === `row:${row.id}` }" aria-label="More actions" aria-haspopup="menu" :aria-expanded="menu === `row:${row.id}`" @click.stop="toggleMenu(`row:${row.id}`)">
              <AppsGlyph name="kebab" class="fill" />
            </button>
            <div v-if="menu === `row:${row.id}`" class="menu right" :class="{ up: opensUp(row) }" role="menu" @click.stop="menu = null">
              <slot name="menu" :row="row" />
            </div>
          </div>
        </div>
      </template>
      </template>
      <div class="tbl-foot"><slot name="foot" :rows="visible" :all="rows" /></div>
    </div>
  </div>
</template>

<script setup>
// One list on the Apps page: View by, search and filters above a table with
// sortable headings, selection, a menu per row and a footer. The rows and
// what each column shows come from the section; the rules from appsModel.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppsGlyph from './AppsGlyph.vue';
import { listColumns, groupRows, visibleRows } from './appsModel.js';

const props = defineProps({
  rows: { type: Array, required: true },
  spec: { type: Object, required: true },
  // { id, label, min (px), fr, sort?: string|false, tip?, drop?: when space runs out, higher drops first }
  heads: { type: Array, required: true },
  label: { type: String, required: true },
  noun: { type: String, default: 'row' },
  openable: { type: Boolean, default: true },
  // { q }: a new object each time a caller sets the search, even to the same text.
  presetQuery: { type: Object, default: null },
  flashId: { type: String, default: null },
});
const emit = defineEmits(['open']);

const root = ref(null);
const selectAll = ref(null);
const q = ref('');
const view = ref('flat');
const sort = ref([...props.spec.defaultSort]);
const chosen = ref({});
const selected = ref(new Set());
const menu = ref(null);
const width = ref(Infinity);

watch(() => props.presetQuery, (preset) => { if (preset && typeof preset.q === 'string') q.value = preset.q; }, { immediate: true });

const viewLabel = computed(() => (props.spec.views.find(([id]) => id === view.value) || props.spec.views[0])[1]);
const activeFilters = computed(() => Object.values(chosen.value).reduce((n, set) => n + set.size, 0));
const visible = computed(() => visibleRows(props.rows, props.spec, { q: q.value, chosen: chosen.value, sort: sort.value }));
const groups = computed(() => {
  const group = props.spec.groups[view.value];
  return group ? groupRows(visible.value, group) : [{ label: '', rows: visible.value }];
});
const columns = computed(() => listColumns(props.heads, width.value));
const shownHeads = computed(() => columns.value.heads);
const template = computed(() => columns.value.template);
const selectedRows = computed(() => props.rows.filter((row) => selected.value.has(row.id)));
const allChosen = computed(() => visible.value.length > 0 && visible.value.every((row) => selected.value.has(row.id)));

const sortKey = (head) => (head.sort === false ? null : props.spec.sorts[head.sort || head.id] ? head.sort || head.id : null);
const ariaSort = (head) => (sortKey(head) && sort.value[0] === sortKey(head) ? (sort.value[1] > 0 ? 'ascending' : 'descending') : undefined);
const rowLabel = (row) => row.label || row.name || row.workflow || row.id;
const isChosen = (facet, id) => !!chosen.value[facet]?.has(id);

function toggleMenu(id) {
  menu.value = menu.value === id ? null : id;
}
function setView(id) {
  view.value = id;
  menu.value = null;
}
function sortBy(key) {
  const newestFirst = ['checked', 'updated', 'created'].includes(key);
  sort.value = sort.value[0] === key ? [key, -sort.value[1]] : [key, newestFirst ? -1 : 1];
}
function setFilter(facet, id, on) {
  const next = new Set(chosen.value[facet] || []);
  if (on) next.add(id);
  else next.delete(id);
  chosen.value = { ...chosen.value, [facet]: next };
}
function clearFilters() {
  chosen.value = {};
}
function resetView() {
  q.value = '';
  chosen.value = {};
}
function choose(id, on) {
  const next = new Set(selected.value);
  if (on) next.add(id);
  else next.delete(id);
  selected.value = next;
}
function chooseAll(on) {
  selected.value = on ? new Set(visible.value.map((row) => row.id)) : new Set();
}
function clearSelection() {
  selected.value = new Set();
}
function opensUp(row) {
  const index = visible.value.findIndex((candidate) => candidate.id === row.id);
  return visible.value.length > 6 && index >= visible.value.length - 3;
}
function onRowClick(row, event) {
  if (!props.openable || event.target.closest('button, a, input, label, .menu')) return;
  emit('open', row);
}

// What leaves the view leaves the selection: a bulk action never touches a hidden row.
watch(visible, (rows) => {
  const shown = new Set(rows.map((row) => row.id));
  if ([...selected.value].some((id) => !shown.has(id))) selected.value = new Set([...selected.value].filter((id) => shown.has(id)));
});
watch([selected, visible], async () => {
  await nextTick();
  if (selectAll.value) selectAll.value.indeterminate = selected.value.size > 0 && !allChosen.value;
});
// A row just added is brought into view (its highlight is CSS).
watch(() => [props.flashId, props.rows.length], async () => {
  if (!props.flashId) return;
  await nextTick();
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(props.flashId) : props.flashId;
  root.value?.querySelector(`[data-row="${escaped}"]`)?.scrollIntoView?.({ block: 'center' });
});

function closeMenus() {
  menu.value = null;
}
function onKeydown(event) {
  if (event.key === 'Escape' && menu.value) {
    menu.value = null;
    event.stopPropagation();
  }
}
let observer = null;
onMounted(() => {
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', onKeydown, true);
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(([entry]) => { width.value = entry.contentRect.width; });
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenus);
  document.removeEventListener('keydown', onKeydown, true);
  observer?.disconnect();
});

defineExpose({ clearSelection });
</script>
