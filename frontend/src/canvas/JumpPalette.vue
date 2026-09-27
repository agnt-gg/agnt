<template>
  <Teleport to="body">
    <div v-if="open" class="jp-scrim" @mousedown.self="close" data-tour-id="jump.palette">
      <section class="jp" role="dialog" aria-modal="true" aria-label="Find pages and assets" ref="dialogRef" @keydown.esc.stop.prevent="close" @keydown.tab="trapFocus">
        <div class="jp-input-row"><i class="fas fa-search" aria-hidden="true"></i><input ref="inputRef" v-model="query" class="jp-input" type="search" spellcheck="false" placeholder="Search pages, conversations, assets, skills, tools…" aria-label="Find a page or asset" @keydown="onKey" /><button class="jp-close" @click="close" aria-label="Close search"><i class="fas fa-times"></i></button></div>
        <p v-if="catalogLoading" class="jp-status" role="status">Loading conversations and asset collections…</p>
        <p v-if="catalogErrors.length" class="jp-status" role="alert">Some collections could not load: {{ catalogErrors.join('; ') }} <button @click="loadCatalog">Retry</button></p>
        <p v-if="searchLimit" class="jp-status">More matches exist. Refine your search to narrow the results.</p>
        <p v-if="fileError" class="jp-status" role="status">{{ fileError }} Other results remain available.</p>
        <p v-else-if="filePending" class="jp-status" role="status">Searching files and history…</p>
        <div class="jp-results" ref="listRef">
          <section v-for="group in categories" :key="group.id" class="jp-group">
            <button class="jp-group-label" :aria-expanded="!collapsed.has(group.id)" @click="toggleGroup(group.id)"><i class="fas" :class="collapsed.has(group.id)?'fa-angle-right':'fa-angle-down'" aria-hidden="true"></i>{{ group.label }}<small>{{ group.items.length }}</small></button>
            <div v-if="!collapsed.has(group.id)" class="jp-group-items">
              <template v-for="family in families(group)" :key="family.id">
                <!-- The count IS the disclosure: one row, one chip, nothing
                     nested until the user asks for it. -->
                <div class="jp-family" :class="{sel:selected===family.id}">
                  <button class="jp-row" :data-jump-id="family.id" @click="run(family)" @mouseenter="selected=family.id"><span class="jp-ic"><i :class="family.icon"></i></span><span class="jp-label">{{ family.label }}<small v-if="family.snippet" class="jp-snippet">{{ family.snippet }}</small></span><small v-if="!family.children.length" class="jp-hint">{{ family.hint }}</small></button>
                  <button v-if="family.children.length" class="jp-count" :class="{open:expanded.has(family.id)}" :aria-expanded="expanded.has(family.id)" :aria-label="(expanded.has(family.id)?'Hide ':'Show ')+family.children.length+' saved '+family.assetLabel" @click="toggleFamily(family.id)">{{ family.children.length }}<i class="fas fa-chevron-down" aria-hidden="true"></i></button>
                </div>
                <template v-if="family.children.length && expanded.has(family.id)">
                  <button v-for="item in family.children" :key="item.id" class="jp-row jp-child" :class="{sel:selected===item.id}" :data-jump-id="item.id" @click="run(item)" @mouseenter="selected=item.id"><span class="jp-label">{{ item.label }}</span><small class="jp-hint">{{ item.hint }}</small></button>
                </template>
              </template>
              <span v-if="!group.items.length" class="jp-empty">No matches</span>
            </div>
          </section>
          <section v-if="storeSuggestions.length" class="jp-group jp-store">
            <div class="jp-group-label jp-store-label"><i class="fas fa-store" aria-hidden="true"></i>You don’t have one — the Store does<small>{{ storeSuggestions.length }}</small></div>
            <div class="jp-group-items">
              <button v-for="item in storeSuggestions" :key="item.id" class="jp-row" :class="{sel:selected===item.id}" :data-jump-id="item.id" @click="run(item)" @mouseenter="selected=item.id"><span class="jp-ic"><i :class="item.icon"></i></span><span class="jp-label">{{ item.label }}<small v-if="item.snippet" class="jp-snippet">{{ item.snippet }}</small></span><small class="jp-hint">{{ item.hint }}</small></button>
            </div>
          </section>
          <p v-else-if="query.trim() && !total && storeUnavailable" class="jp-row jp-store-down">Nothing installed matches, and the Store could not be reached.</p>
          <button v-if="query.trim() && !total" class="jp-row jp-ask" @click="ask"><span class="jp-ic"><i class="fas fa-comment-dots"></i></span><span>Ask Annie about “{{ query.trim() }}”</span></button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
<script setup>
import {
  computed,
  nextTick,
  ref,
  watch,
  onBeforeUnmount
} from 'vue';
import {
  useStore
} from 'vuex';
import {
  useRouter
} from 'vue-router';
import {
  ALL_SECTIONS
} from './sections.js';
import {
  buildJumpCatalog
} from './jumpCatalog.js';
import {
  API_CONFIG
} from '@/tt.config.js';
import { loadSearchSources, searchRequest, historySearchItems, marketplaceSearch, marketplaceStoreItems } from './searchSources.js';
const emit = defineEmits(['navigate']);
const store = useStore(),
  router = useRouter();
const query = ref(''),
  selected = ref(null),
  collapsed = ref(new Set()),
  expanded = ref(new Set()),
  inputRef = ref(null),
  listRef = ref(null),
  dialogRef = ref(null);
let returnFocus = null;
const open = computed(() => store.getters['shell/jumpOpen']);
const files = ref([]),
  fileError = ref(''),
  filePending = ref(false);
let fileTimer = null,
  fileAbort = null,
  fileGeneration = 0;
const remote=ref({}),catalogErrors=ref([]),catalogLoading=ref(false),history=ref([]),searchLimit=ref(false);let catalogAbort=null,catalogEpoch=0;
// Store suggestions are fetched with the other debounced sources but RENDERED
// only when nothing installed matches. Gating the fetch on `total === 0`
// instead would race: `total` climbs as the file and history requests land, so
// a fetch keyed on it would fire, and cancel, on results that had not arrived.
const storeHits=ref([]),storeUnavailable=ref(false);
const merge=(...lists)=>[...new Map(lists.flat().filter(Boolean).map(item=>[item.id||item.name,item])).values()];
async function loadCatalog(){catalogAbort?.abort();catalogAbort=new AbortController();const epoch=++catalogEpoch;remote.value={};catalogErrors.value=[];catalogLoading.value=true;await loadSearchSources({token:localStorage.getItem('token'),signal:catalogAbort.signal,onSource:(key,items)=>{if(epoch===catalogEpoch)remote.value={...remote.value,[key]:items}},onError:(label,error)=>{if(epoch===catalogEpoch)catalogErrors.value.push(label+': '+error)}});if(epoch===catalogEpoch)catalogLoading.value=false;}
const categories = computed(() => buildJumpCatalog({
  sections: ALL_SECTIONS,
  query: query.value,
  files: files.value,
  agents: merge(store.getters['agents/allAgents'] || [],remote.value.agents||[]),
  workflows: merge(store.getters['workflows/allWorkflows'] || [],remote.value.workflows||[]),
  goals: merge(store.getters['goals/allGoals'] || [],remote.value.goals||[]),
  chats: merge(store.getters['contentOutputs/outputs'] || store.getters['contentOutputs/visibleOutputs'] || [],remote.value.outputs||[]).filter(item=>!item.content_type||item.content_type==='conversation'||item.conversation_id),
  outputs:remote.value.outputs||[],history:history.value,widgets:remote.value.widgets||[],plugins:remote.value.plugins||[],
  tools:merge(store.getters['tools/allTools']||[],remote.value.tools||[],remote.value.customTools||[]),
  skills: merge(store.getters['skills/allSkills'] || [],remote.value.skills||[]),
  pages: (store.getters['widgetLayout/allPages'] || []).filter(p => !String(p.route || '').startsWith('workspace:') && !ALL_SECTIONS.some(s => s.screens.some(t => t.screen === p.route)))
}));
watch(()=>store.state.userAuth?.token,()=>{catalogEpoch++;catalogAbort?.abort();fileGeneration++;clearTimeout(fileTimer);fileAbort?.abort();remote.value={};history.value=[];files.value=[];storeHits.value=[];storeUnavailable.value=false;catalogErrors.value=[];if(open.value)close();});
const total = computed(() => categories.value.reduce((n, g) => n + g.items.length, 0));
// "No assets match" means nothing INSTALLED matches: store hits live outside
// `categories`, so they can never suppress the very empty state they answer.
const storeSuggestions = computed(() => (query.value.trim() && !total.value ? storeHits.value : []));

function families(group) {
  if (query.value.trim()) return group.items.map(i => ({
    ...i,
    children: []
  }));
  const pages = group.items.filter(i => i.id.startsWith('go:'));
  const resources = group.items.filter(i => !i.id.startsWith('go:'));
  const used = new Set();
  const results = pages.map(page => {
    const children = resources.filter(r => r.action.screen === page.action.screen || (page.action.screen === 'ChatScreen' && r.action.type === 'chat') || (page.action.screen === 'WorkspaceScreen' && r.action.type === 'page'));
    children.forEach(c => used.add(c.id));
    return {
      ...page,
      children,
      assetLabel: page.label.toLowerCase()
    }
  });
  for (const item of resources)
    if (!used.has(item.id)) results.push({
      ...item,
      children: []
    });
  return results
}

function toggleFamily(id) {
  const next = new Set(expanded.value);
  next.has(id) ? next.delete(id) : next.add(id);
  expanded.value = next
}

function toggleGroup(id) {
  const next = new Set(collapsed.value);
  next.has(id) ? next.delete(id) : next.add(id);
  collapsed.value = next
}
watch(open, async value => {
  if (value) {
    returnFocus = document.activeElement;
    query.value = '';
    history.value=[];
    storeHits.value=[];storeUnavailable.value=false;
    loadCatalog();
    selected.value = null;
    collapsed.value = new Set();
    expanded.value = new Set();
    await nextTick();
    inputRef.value?.focus()
  } else {catalogEpoch++;catalogAbort?.abort();fileGeneration++;clearTimeout(fileTimer);fileAbort?.abort();catalogLoading.value=false;filePending.value=false;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
});
watch(query, () => {
  selected.value = null;
  files.value = [];
  history.value=[];searchLimit.value=false;
  storeHits.value=[];storeUnavailable.value=false;
  fileError.value = '';
  filePending.value = false;
  clearTimeout(fileTimer);
  fileAbort?.abort();
  const generation = ++fileGeneration;
  if (!open.value || query.value.trim().length < 2) return;
  filePending.value = true;
  fileTimer = setTimeout(async () => {
    fileAbort = new AbortController();
    const options={signal:fileAbort.signal,token:localStorage.getItem('token')||''};
    await Promise.all([
      (async()=>{try{const body=await searchRequest('/filesystem/search?q='+encodeURIComponent(query.value.trim()),options);if(generation===fileGeneration){files.value=body.items||[];searchLimit.value=!!body.truncated;}}catch(error){if(generation===fileGeneration&&error.name!=='AbortError')fileError.value+='File search unavailable. ';}})(),
      (async()=>{try{const body=await searchRequest('/memory/search?q='+encodeURIComponent(query.value.trim())+'&limit=200',options);if(generation===fileGeneration){history.value=historySearchItems(body.results||[]);searchLimit.value=searchLimit.value||(body.results||[]).length>=200;}}catch(error){if(generation===fileGeneration&&error.name!=='AbortError')fileError.value+='History search unavailable. ';}})(),
      // Deliberately NOT folded into fileError: the Store being unreachable is
      // not a degraded local search, and saying so next to results the user
      // can already act on would be noise.
      (async()=>{try{const term=query.value.trim();const items=await marketplaceSearch(term,{signal:fileAbort.signal});if(generation===fileGeneration)storeHits.value=marketplaceStoreItems(items,term);}catch(error){if(generation===fileGeneration&&error.name!=='AbortError')storeUnavailable.value=true;}})(),
    ]);
    if(generation===fileGeneration)filePending.value=false;
  }, 250);
});
onBeforeUnmount(() => {
  catalogEpoch++;catalogAbort?.abort();
  fileGeneration++;
  clearTimeout(fileTimer);
  fileAbort?.abort()
});

function close() {
  catalogEpoch++;catalogAbort?.abort();catalogLoading.value=false;
  fileGeneration++;
  clearTimeout(fileTimer);
  fileAbort?.abort();
  filePending.value = false;
  store.dispatch('shell/closeJump')
}

function run(item) {
  if (!item) return;
  const a = item.action;
  close();
  if (a.type === 'inspect') {
    store.dispatch('shell/inspect', {
      kind: a.kind,
      id: a.id,
      screen: a.screen
    });
    emit('navigate', a.screen, {
      select: {
        kind: a.kind,
        id: a.id
      }
    })
  } else if (a.type === 'screen') emit('navigate', a.screen, a.opts || {});
  else if (a.type === 'chat') router.push({
    path: '/chat',
    query: {
      'content-id': a.id
    }
  });
  else if (a.type === 'conversation') {
    searchRequest('/content-outputs/by-conversation/'+encodeURIComponent(a.id),{token:localStorage.getItem('token')||''}).then(body=>{const output=body.output||body.contentOutput||body;if(!output.id)throw Error('Conversation not available');router.push({path:'/chat',query:{'content-id':output.id}})}).catch(error=>{store.dispatch('shell/openJump');catalogErrors.value=[error.message]});
  } else if(a.type==='output') {router.push({path:'/chat',query:{'content-id':a.id}});}
  else if (a.type === 'store') {
    // ?item=<asset_id> is the catalogue's existing deep link: Marketplace.vue
    // resolves it on cold mount AND from a route watcher when warm, and the
    // asset id is stable across republishes where the listing UUID is not.
    router.push({ path: '/marketplace', query: { item: a.assetId } });
  }
  else if (a.type === 'teams') { window.dispatchEvent(new CustomEvent('agnt:open-team-workspace')); }
  else if (a.type === 'page') {
    window.dispatchEvent(new CustomEvent('agnt:open-page', {
      detail: {
        pageId: a.id
      }
    }))
  }
}

function ask() {
  const text = query.value.trim();
  close();
  emit('navigate', 'ChatScreen', {});
  nextTick(() => window.dispatchEvent(new CustomEvent('agnt:ask-annie', {
    detail: {
      text,
      send: false
    }
  })))
}

function rows() {
  return [...(listRef.value?.querySelectorAll('[data-jump-id]') || [])].filter(el => el.getClientRects().length)
}

function onKey(e) {
  // Right/Left open and close the selected row's saved items, but only when
  // the caret is at the end of the query so text editing keeps its arrows.
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && selected.value && e.target.selectionStart === query.value.length) {
    const wantOpen = e.key === 'ArrowRight';
    if (expanded.value.has(selected.value) !== wantOpen && categories.value.some(g => families(g).some(f => f.id === selected.value && f.children.length))) {
      e.preventDefault();
      toggleFamily(selected.value);
    }
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
  e.preventDefault();
  const visible = rows();
  let index = visible.findIndex(el => el.dataset.jumpId === selected.value);
  if (e.key === 'Enter') {
    const id = selected.value || visible[0]?.dataset.jumpId;
    // Store rows are selectable but live outside `categories`, so Enter has to
    // look in both or the highlighted row does nothing.
    // Expanded children are rendered from families(), whose ids are the
    // catalog item ids, so the flat item list still resolves them.
    run([...categories.value.flatMap(g => g.items), ...storeSuggestions.value].find(i => i.id === id));
    return
  }
  index = Math.max(0, Math.min(visible.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
  selected.value = visible[index]?.dataset.jumpId;
  visible[index]?.scrollIntoView({
    block: 'nearest'
  })
}

function trapFocus(e) {
  const nodes = [...dialogRef.value.querySelectorAll('input,button')].filter(el => !el.disabled && el.getClientRects().length);
  const first = nodes[0],
    last = nodes.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first?.focus()
  }
}
</script>
<style scoped>
.jp-snippet{display:block;font-size:11px;line-height:1.5;color:var(--color-text-muted);margin-top:4px;white-space:normal;max-height:3em;overflow:hidden}

.jp-status {
  font-size: 11px;
  color: var(--color-text-muted);
  padding: 8px 20px;
  margin: 0;
  border-bottom: 1px solid var(--terminal-border-color)
}

.jp-scrim {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(var(--color-background-rgb), .6);
  backdrop-filter: blur(4px);
  padding: 28px;
  display: flex
}

.jp {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  box-shadow: 0 24px 70px #0006;
  overflow: hidden
}

.jp-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted)
}

.jp-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  outline: 0;
  color: var(--color-text);
  font: 300 15px 'League Spartan', sans-serif;
  padding: 16px 0
}

.jp-input::placeholder {
  color: var(--color-text-muted)
}

.jp-close {
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 9px
}

.jp-results {
  overflow: auto;
  min-height: 0;
  padding: 18px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  /* Groups are overflow:hidden, which drops their minimum height to zero; in
     a fixed-height scroller that let auto rows shrink below their content and
     the groups overlapped (one column on a phone). Rows size to content and
     the list scrolls instead. */
  grid-auto-rows: max-content;
  gap: 13px;
  align-content: start;
  align-items: start
}

.jp-group {
  border: 1px solid var(--terminal-border-color);
  border-radius: 7px;
  min-width: 0;
  overflow: hidden
}

.jp-group-label {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 12px;
  font: 400 10px 'League Spartan', sans-serif;
  letter-spacing: .12em;
  text-transform: uppercase;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  text-align: left;
  cursor: pointer
}

.jp-group-label small {
  margin-left: auto;
  font-size: 10px
}

.jp-group-items {
  padding: 5px;
  border-top: 1px solid var(--terminal-border-color)
}

.jp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--color-text);
  font: 300 13px 'League Spartan', sans-serif;
  text-align: left;
  cursor: pointer
}

.jp-row.sel,
.jp-row:hover {
  background: rgba(var(--primary-rgb), .1)
}

.jp-ic {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text-muted);
  font-size: 11px;
  background: #ffffff04
}

.jp-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere
}

.jp-hint {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap
}

.jp-family {
  display: flex;
  align-items: center;
  border-radius: 7px
}

.jp-family.sel,
.jp-family:hover {
  background: rgba(var(--primary-rgb), .1)
}

.jp-family .jp-row:hover {
  background: none
}

.jp-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-right: 6px;
  padding: 3px 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 999px;
  background: none;
  color: var(--color-text-muted);
  font: 400 11px 'League Spartan', sans-serif;
  cursor: pointer
}

.jp-count i {
  font-size: 8px;
  transition: transform .15s ease
}

.jp-count:hover,
.jp-count.open {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), .45)
}

.jp-count.open i {
  transform: rotate(180deg)
}

/* Children sit flush under their page, aligned with its label, no box. */
.jp-child {
  padding-left: 44px;
  font-size: 12px;
  color: var(--color-text-muted)
}

.jp-child:hover,
.jp-child.sel {
  color: var(--color-text)
}

.jp-empty {
  display: block;
  padding: 10px;
  font-size: 11px;
  color: var(--color-text-muted)
}

.jp-ask {
  grid-column: 1/-1;
  border: 1px solid var(--terminal-border-color)
}

/* The empty state answers a shopping question, so it spans the grid rather
   than sitting in one of three columns as if it were a category. */
.jp-store {
  grid-column: 1/-1;
  border-color: rgba(var(--primary-rgb), .35)
}

.jp-store-label {
  cursor: default;
  color: var(--color-primary)
}

.jp-store-down {
  grid-column: 1/-1;
  margin: 0;
  cursor: default;
  color: var(--color-text-muted);
  font-size: 11px
}

button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px
}

@media(max-width:900px) {
  .jp-results {
    grid-template-columns: repeat(2, minmax(0, 1fr))
  }
}

@media(max-width:600px) {
  .jp-scrim {
    padding: 0
  }

  .jp {
    border-radius: 0;
    border: 0
  }

  .jp-results {
    grid-template-columns: 1fr;
    padding: 12px
  }
}
</style>
