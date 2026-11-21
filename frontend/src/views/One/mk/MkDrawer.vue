<template>
  <!-- AGNT One's one sidebar, on every desktop page: workspace switcher, one
       search, New chat, the Main chat, My Space (private), Teamspaces, then the
       chats (OneShell passes the list in). Every row goes to the real page. -->
  <div class="mk mk-drawer-host">
    <aside class="drawer" aria-label="Sidebar" data-testid="one-sidebar">
      <div ref="headRef" class="drawer-head">
        <button type="button" class="ws-btn" data-testid="ot-switcher" :aria-expanded="String(menu === 'ws')" @click="toggle('ws')">
          <span class="ws-tile"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
          <span style="flex: 1; min-width: 0"><div class="ws-name">{{ team ? titled(team.name) : 'Personal' }}</div><div class="ws-plan">{{ team ? roleLabel(team.role) + ' · Team Workspace' : 'Only you' }}</div></span>
          <MkIcon name="down" size="sm" />
        </button>
        <div v-if="menu === 'ws'" class="ws-menu" role="menu">
          <button type="button" class="menu-item" :class="{ 'is-active': !team }" role="menuitem" @click="goPersonal">
            <span class="ws-tile" style="width: 22px; height: 22px"><MkIcon name="lock" size="xs" /></span><span style="flex: 1"><div>Personal</div><div class="ws-plan">Only you</div></span><MkIcon v-if="!team" name="check" size="sm" />
          </button>
          <button v-for="t in teams" :key="t.id" type="button" class="menu-item" :class="{ 'is-active': team?.id === t.id }" role="menuitem" @click="goTeam(t)">
            <span class="ws-tile" style="width: 22px; height: 22px"><img src="/images/agnt-logo-mark.svg" alt="" /></span><span style="flex: 1"><div>{{ titled(t.name) }}</div><div class="ws-plan">{{ roleLabel(t.role) }}</div></span><MkIcon v-if="team?.id === t.id" name="check" size="sm" />
          </button>
          <button type="button" class="menu-item sep" role="menuitem" @click="pick('team-settings')"><MkIcon name="plus" size="sm" />Create or join a team</button>
        </div>
      </div>
      <!-- One search for the whole sidebar (typing filters it in place; Enter
           carries the words to Find anything), with New beside it as in
           Studio's chat list: + New starts a chat, its chevron holds the rest. -->
      <div class="find-row">
        <div class="find-box" @click="searchRef?.focus()">
          <MkIcon name="find" size="sm" />
          <input
            ref="searchRef"
            v-model="query"
            type="text"
            placeholder="Search or ask Annie"
            aria-label="Search or ask Annie"
            autocomplete="off"
            spellcheck="false"
            data-testid="one-sidebar-search"
            @keydown.enter.prevent="findEverywhere"
            @keydown.esc="query = ''"
          />
        </div>
        <div class="mk-new-anchor new-pill">
          <button v-tooltip="'New chat'" type="button" class="new-main" data-testid="one-new-chat" @click="$emit('new-chat')"><MkIcon name="plus" size="sm" />New</button>
          <button v-tooltip="menu === 'new' ? '' : 'New chat, file, agent or routine'" type="button" class="new-more" data-testid="one-new-menu" aria-label="New chat, file, agent or routine" :aria-expanded="String(menu === 'new')" @click="toggle('new')"><MkIcon name="down" size="xs" /></button>
          <div v-if="menu === 'new'" class="ws-menu new-menu" role="menu">
            <button type="button" class="menu-item" role="menuitem" @click="newChatFromMenu"><MkIcon name="chats" size="sm" />Chat</button>
            <button type="button" class="menu-item" role="menuitem" @click="pick('new-doc')"><MkIcon name="doc" size="sm" />File</button>
            <button type="button" class="menu-item" role="menuitem" @click="pick('new-agent')"><MkIcon name="bot" size="sm" />Agent</button>
            <button type="button" class="menu-item" role="menuitem" @click="pick('new-routine')"><MkIcon name="bolt" size="sm" />Routine</button>
          </div>
        </div>
      </div>
      <div class="drawer-scroll">
        <template v-if="q">
          <button type="button" class="d-item s-act" data-testid="one-sidebar-ask" @click="askAnnie"><MkIcon name="chats" size="sm" /><span class="ell">Ask Annie about “{{ q }}”</span></button>
          <button type="button" class="d-item s-act" data-testid="one-sidebar-find" @click="findEverywhere"><MkIcon name="find" size="sm" /><span class="ell">Find “{{ q }}” everywhere</span><kbd>Enter</kbd></button>
        </template>
        <!-- The Main chat: texts to Annie land here; New chat never does. Drawn
             as Studio's pinned row (OutputList .main-chat-item). -->
        <div
          v-if="matches(MAIN_CHAT_LABEL)"
          class="d-item main-row"
          :class="{ 'is-active': mainChat.open }"
          role="button"
          tabindex="0"
          data-testid="main-chat-row"
          @click="$emit('open-main')"
          @keydown.enter.prevent="$emit('open-main')"
        >
          <span class="main-mark" aria-hidden="true">
            <i v-if="mainChat.streaming" class="fas fa-circle main-streaming"></i>
            <span v-else-if="mainChat.unread" v-tooltip="'Unread changes'" class="main-unread"></span>
            <i v-else class="fas fa-thumbtack main-pin"></i>
          </span>
          <span class="main-text"><b>{{ MAIN_CHAT_LABEL }}</b></span>
          <button
            v-tooltip="mainChat.streaming ? 'Wait for the reply to finish' : 'Clear main chat'"
            type="button"
            class="row-act"
            :disabled="mainChat.streaming"
            aria-label="Clear main chat"
            data-testid="main-chat-clear"
            @click.stop="$emit('clear-main')"
          ><i class="fas fa-eraser" aria-hidden="true"></i></button>
        </div>
        <section v-if="mineRows.length" class="d-sec">
          <div class="d-head">
            <button type="button" class="sec-toggle" data-testid="fold-mine" :aria-expanded="String(!isFolded('mine'))" @click="fold('mine')"><MkIcon name="lock" size="xs" /> My Space<MkIcon name="down" size="xs" class="chev" :class="{ 'is-folded': isFolded('mine') }" /></button>
          </div>
          <template v-if="!isFolded('mine')">
            <button v-for="row in mineRows" :key="row.id" type="button" class="d-item" :class="{ 'is-active': active === row.id }" @click="pick(row.id)"><MkIcon :name="row.icon" size="sm" />{{ row.label }}<span v-if="row.count" class="count">{{ row.count }}</span></button>
          </template>
        </section>
        <template v-if="team">
          <section v-if="!q || spaceRows.length" class="d-sec">
            <div class="d-head" data-tour-id="team-spaces">
              <button type="button" class="sec-toggle" data-testid="fold-spaces" :aria-expanded="String(!isFolded('spaces'))" @click="fold('spaces')"><MkIcon name="users" size="xs" /> Teamspaces<MkIcon name="down" size="xs" class="chev" :class="{ 'is-folded': isFolded('spaces') }" /></button>
              <!-- Always shown. -->
              <button v-tooltip="'New teamspace'" type="button" aria-label="New teamspace" data-testid="new-teamspace" @click="$emit('new-space')"><MkIcon name="plus" size="xs" /></button>
            </div>
            <template v-if="!isFolded('spaces')">
              <button v-for="s in spaceRows" :key="s.id" type="button" class="d-item" :class="{ 'is-active': active === 'space:' + s.id }" @click="$emit('go', { view: 'space', space: s.id })">
                <span style="width: 15px; text-align: center">{{ spaceEmoji(s) }}</span>{{ s.name }}<span v-if="marks[s.id]" class="space-mark" :data-testid="`space-mark-${s.id}`">{{ marks[s.id] }}</span>
              </button>
              <p v-if="!spaces.length" class="d-note">No teamspaces yet. Add one with +.</p>
            </template>
          </section>
        </template>
        <div v-else-if="!q" class="d-note">This is your personal workspace: everything here is private. <template v-if="teams.length">Teamspaces live in <button type="button" class="link" @click="goTeam(teams[0])">{{ teams[0].name }}</button>.</template><template v-else><button type="button" class="link" @click="pick('team-settings')">Set up a team</button> to work with others.</template></div>
        <div class="drawer-chats" data-testid="one-chat-sidebar"><slot name="chats" :query="q" /></div>
      </div>
      <!-- Collapse, as in Studio's sidebar: the rail keeps the way back. -->
      <div class="drawer-foot">
        <button type="button" class="d-item collapse-row" data-testid="one-sidebar-collapse" aria-label="Collapse sidebar" @click="$emit('collapse')"><i class="fas fa-angle-double-left" aria-hidden="true"></i>Collapse</button>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import MkIcon from './MkIcon.vue';
import { roleLabel } from '@/utils/teamClient.js';
import { spaceEmoji } from '@/views/One/team/teamModel.js';
import { MAIN_CHAT_LABEL } from '@/composables/useMainChat.js';

/** A workspace name as a name: "bravo" reads "Bravo". The stored name is unchanged. */
const titled = (name) => { const s = String(name || ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };
import { openTeam, openPersonal } from '@/composables/useSpaces.js';

const props = defineProps({
  team: { type: Object, default: null },
  teams: { type: Array, default: () => [] },
  spaces: { type: Array, default: () => [] },
  active: { type: String, default: null },
  counts: { type: Object, default: () => ({}) },
  // Beside a teamspace: what has stopped there, or that it is at its work limit (teamModel.spaceMark).
  marks: { type: Object, default: () => ({}) },
  // The Main chat row's state: open on screen, unread, a reply streaming into it.
  mainChat: { type: Object, default: () => ({ open: false, unread: false, streaming: false }) },
});
const emit = defineEmits(['go', 'pick', 'find', 'ask', 'new-chat', 'open-main', 'clear-main', 'new-space', 'collapse', 'error']);
const menu = ref(null);
const headRef = ref(null);
const toggle = (name) => { menu.value = menu.value === name ? null : name; };
function pick(what) { menu.value = null; emit('pick', what); }
function newChatFromMenu() { menu.value = null; emit('new-chat'); }

// ── One search for the sidebar ────────────────────────────────────────────
const query = ref('');
const searchRef = ref(null);
const q = computed(() => query.value.trim());
const matches = (label) => !q.value || String(label).toLowerCase().includes(q.value.toLowerCase());
function askAnnie() {
  const text = q.value;
  query.value = '';
  emit('ask', text);
}
function findEverywhere() {
  const text = q.value;
  if (!text) return;
  query.value = '';
  emit('find', text);
}

const MINE = Object.freeze([
  { id: 'mine-tasks', label: 'My tasks', icon: 'task', count: 'tasks', teamOnly: true },
  { id: 'mine-agents', label: 'My agents', icon: 'bot', count: 'agents' },
  { id: 'mine-routines', label: 'My routines', icon: 'bolt', count: 'routines' },
  { id: 'mine-files', label: 'My files', icon: 'file' },
]);
const mineRows = computed(() => MINE
  .filter((row) => (props.team || !row.teamOnly) && matches(row.label))
  .map((row) => ({ ...row, count: row.count ? props.counts[row.count] : 0 })));
const spaceRows = computed(() => props.spaces.filter((s) => matches(s.name)));

// ── Folded sections: remembered; a search looks inside them anyway ────────
const FOLD_KEY = 'agnt:one-sidebar:folded';
function readFolds() {
  try {
    const stored = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}');
    return { mine: stored?.mine === true, spaces: stored?.spaces === true };
  } catch {
    return { mine: false, spaces: false };
  }
}
const folds = ref(readFolds());
const isFolded = (key) => !q.value && folds.value[key];
function fold(key) {
  folds.value = { ...folds.value, [key]: !folds.value[key] };
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds.value));
  } catch {
    /* storage disabled: folding still works for this session */
  }
}

async function goTeam(t) {
  menu.value = null;
  if (t.id === props.team?.id) return;
  try { if (!(await openTeam(t))) emit('error', 'This team has no instance address yet.'); } catch (e) { emit('error', e.message); }
}
async function goPersonal() {
  menu.value = null;
  if (!props.team) return;
  try { if (!(await openPersonal())) emit('error', 'This is the team’s own instance. Open your personal space from the desktop app or your own instance.'); } catch (e) { emit('error', e.message); }
}
const onDown = (e) => { if (menu.value && !e.target.closest?.('.ws-menu, .ws-btn, .mk-new-anchor')) menu.value = null; };
onMounted(() => document.addEventListener('mousedown', onDown));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDown));
</script>

<style scoped>
/* One sidebar for the drawer and the chats: the rows keep the drawer's own size (mk.css .d-item). */
/* A teamspace with stopped work, or at its work limit, says so beside its name. */
.space-mark { margin-left: auto; padding: 1px 6px; border-radius: 6px; background: rgba(var(--orange-rgb), 0.14); color: var(--amber-text); font-size: 11px; font-weight: 500; white-space: nowrap; }

/* The search, and New beside it. */
.find-row { display: flex; align-items: center; gap: 6px; margin: 4px 10px 8px; }
.find-box { box-sizing: border-box; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 10px; height: 33px; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); color: var(--text-tertiary); font-size: 13px; cursor: text; }
.find-box:hover,
.find-box:focus-within { border-color: var(--border-strong); }
.find-box input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; }
.find-box input::placeholder { color: var(--text-tertiary); }
.ell { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-act { color: var(--text-primary); }
.s-act kbd { margin-left: auto; font: inherit; font-size: 11px; color: var(--text-tertiary); }

/* + New and its chevron: one compact button, the height of the search. */
.new-pill { flex: none; display: flex; align-items: stretch; height: 33px; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); }
.new-pill:hover { border-color: var(--border-strong); }
.new-pill .new-main { display: flex; align-items: center; gap: 5px; padding: 0 8px 0 9px; border: 0; border-radius: 9px 0 0 9px; background: transparent; color: var(--text-primary); font-size: 13px; font-weight: 500; }
.new-more { position: relative; width: 22px; border: 0; border-radius: 0 9px 9px 0; background: transparent; color: var(--text-tertiary); display: grid; place-items: center; }
.new-more::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 1px; background: var(--line); }
.new-pill .new-main:hover,
.new-more:hover,
.new-more[aria-expanded='true'] { background: var(--surface-hover); color: var(--text-primary); }
.mk .ws-menu.new-menu { left: auto; right: 0; width: 170px; top: calc(100% + 4px); }

/* The Main chat: Studio's pinned row, a bordered card; the eraser on hover. */
.main-row { box-sizing: border-box; position: relative; cursor: pointer; margin-bottom: 6px; padding: 7px 8px; border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--line)); }
.main-mark { width: 15px; height: 19px; flex: none; display: grid; place-items: center; }
.main-pin { color: var(--color-primary); font-size: 11px; }
.main-unread { width: 7px; height: 7px; border-radius: 50%; background: var(--color-green); }
.main-streaming { color: var(--color-primary); font-size: 7px; animation: main-pulse 1.5s ease-in-out infinite; }
@keyframes main-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.main-text { flex: 1; min-width: 0; }
.main-text b { font-weight: 600; color: var(--text-primary); }
.row-act { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--text-tertiary); display: grid; place-items: center; opacity: 0; font-size: 12px; }
.main-row:hover .row-act,
.row-act:focus-visible { opacity: 1; }
.row-act:hover:not(:disabled) { background: var(--surface-active); color: var(--text-primary); }
.row-act:disabled { cursor: not-allowed; opacity: 0.35; }

/* A section's name folds it (mk.css styles every .d-head button as the 22px + beside it). */
.mk .d-head .sec-toggle { display: inline-flex; align-items: center; gap: 6px; width: auto; height: auto; margin: 0; padding: 0; border-radius: 0; background: none; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; }
.mk .d-head .sec-toggle:hover { background: none; color: var(--text-primary); }
.sec-toggle .chev { opacity: 0; transition: opacity 0.15s, transform 0.15s; }
.d-head:hover .sec-toggle .chev,
.sec-toggle:focus-visible .chev,
.sec-toggle .chev.is-folded { opacity: 1; }
.sec-toggle .chev.is-folded { transform: rotate(-90deg); }

/* Collapse, at the foot, as in Studio. */
.drawer-foot { flex: none; padding: 6px 10px 10px; border-top: 1px solid var(--line); }
.collapse-row { color: var(--text-tertiary); font-size: 13px; }
.collapse-row i { width: 15px; text-align: center; }
</style>
