<template>
  <!-- One's chat list (the approved mockup's): New chat and search, the Main chat, the chats
       waiting for your OK, then All / Unread / Groups. Compact, and padded off the edges.
       Unread and groups are the store's own (contentOutputs, groups): the same as Studio's list. -->
  <div class="mk mk-chatlist-host">
    <div class="chat-list cl" data-testid="mk-chat-list">
      <div class="cl-top">
        <button type="button" class="cl-new" data-action="new-chat" @click="$emit('new-chat')"><MkIcon name="pen" size="sm" />New chat</button>
        <label class="cl-search"><MkIcon name="find" size="xs" /><input v-model="query" type="search" placeholder="Search" aria-label="Search chats" /></label>
      </div>

      <button v-if="main.mainChatId?.value" type="button" class="d-item cl-row" :class="{ 'is-active': main.isMainOpen?.value }" data-testid="main-chat" @click="main.openMainChat()">
        <MkIcon name="chats" size="xs" /><span class="cl-title">Main chat</span><span v-if="main.isMainUnread?.value" class="cl-dot" aria-label="Unread"></span>
      </button>

      <template v-if="need.length">
        <div class="cl-head">Needs you</div>
        <button v-for="c in need" :key="'n' + c.id" type="button" class="d-item cl-row" :class="{ 'is-active': c.id === activeId }" @click="$emit('open', c.id)">
          <span class="tc-dot need"></span><span class="cl-text"><span class="cl-title">{{ c.title }}</span><small>{{ c.sub }}</small></span>
        </button>
      </template>

      <nav class="cl-seg" aria-label="Chat views">
        <button v-for="v in VIEWS" :key="v.id" type="button" :class="{ on: view === v.id }" :aria-pressed="view === v.id" :data-view="v.id" @click="setView(v.id)">
          {{ v.label }}<span v-if="v.id === 'unread' && unread.length" class="cl-count">{{ unread.length }}</span>
        </button>
      </nav>

      <!-- All -->
      <template v-if="view === 'all'">
        <ChatRow v-for="c in shown" :key="c.id" :row="c" :active="c.id === activeId" :unread="unreadIds.has(c.id)" @open="$emit('open', c.id)" @menu="openMenu" @drag="dragging = c.id" />
      </template>

      <!-- Unread -->
      <template v-else-if="view === 'unread'">
        <button v-if="unread.length" type="button" class="cl-link" data-action="mark-all-read" @click="markAllRead">Mark all read</button>
        <ChatRow v-for="c in unread" :key="c.id" :row="c" :active="c.id === activeId" unread @open="$emit('open', c.id)" @menu="openMenu" @drag="dragging = c.id" />
        <p v-if="!unread.length" class="cl-empty">You're all caught up.</p>
      </template>

      <!-- Groups -->
      <template v-else>
        <button type="button" class="cl-link" data-action="new-group" @click="newGroup(null)"><MkIcon name="plus" size="xs" />New group</button>
        <template v-for="g in sections" :key="g.id || 'loose'">
          <div class="cl-group" :class="{ over: dropTarget === (g.id || 'loose') }" :style="{ paddingLeft: 6 + g.depth * 12 + 'px' }" :data-group="g.id || 'none'"
            @dragover.prevent="dropTarget = g.id || 'loose'" @dragleave="dropTarget = null" @drop.prevent="dropOn(g.id)">
            <button v-if="g.id" type="button" class="cl-group-name" :aria-expanded="g.open" @click="toggle(g.id)"><MkIcon :name="g.open ? 'down' : 'chev'" size="xs" />{{ g.name }}</button>
            <span v-else class="cl-group-name is-static">{{ g.name }}</span>
            <span class="cl-count is-plain">{{ g.count }}</span>
          </div>
          <ChatRow v-for="c in g.chats" :key="c.id" :row="c" :indent="g.depth + 1" :active="c.id === activeId" :unread="unreadIds.has(c.id)" @open="$emit('open', c.id)" @menu="openMenu" @drag="dragging = c.id" />
        </template>
      </template>

      <p v-if="!rows.length" class="cl-empty">No chats yet. Start one and it shows up here.</p>

      <!-- Move to group: right-click a chat. -->
      <div v-if="menu" class="cl-menu" :style="{ top: menu.y + 'px', left: menu.x + 'px' }" role="menu" @mouseleave="menu = null">
        <div class="cl-menu-head">Move to group</div>
        <button v-for="g in allGroups" :key="g.id" type="button" role="menuitem" :disabled="groupOf(menu.id) === g.id" @click="moveTo(menu.id, g.id)">{{ g.name }}</button>
        <button type="button" role="menuitem" :disabled="!groupOf(menu.id)" @click="moveTo(menu.id, null)">No group</button>
        <button type="button" role="menuitem" class="cl-menu-new" @click="newGroup(menu.id)">New group…</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './MkIcon.vue';
import { recentConversations } from '@/views/Focused/focusedModel.js';
import { useCheckpoints } from '@/composables/useCheckpoints.js';
import { useMainChat } from '@/composables/useMainChat.js';
import { ago } from '@/views/One/team/teamModel.js';
import { CHAT_VIEWS, searchRows, unreadRows, groupSections } from './chatListModel.js';

const KIND = Object.freeze({ plan: 'Plan to approve', review: 'Something to check', run: 'Run to approve', final: 'Final review', routine: 'Routine to approve' });
const VIEWS = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'groups', label: 'Groups' }];
const VIEW_KEY = 'one.chatList.view';
const OPEN_KEY = 'one.chatList.openGroups';
const props = defineProps({ activeId: { type: String, default: null } });
defineEmits(['open', 'new-chat']);
const store = useStore();
const nav = inject('focusedNav', null);
const checkpoints = useCheckpoints();
const main = useMainChat();

/** One chat: title, when / status, an unread dot; draggable onto a group, right-click to move it. */
const ChatRow = defineComponent({
  props: { row: { type: Object, required: true }, active: Boolean, unread: Boolean, indent: { type: Number, default: 0 } },
  emits: ['open', 'menu', 'drag'],
  setup(p, { emit }) {
    return () => h('button', {
      type: 'button', class: ['d-item', 'cl-row', { 'is-active': p.active }], draggable: 'true', 'data-chat': p.row.id,
      style: p.indent ? { paddingLeft: 8 + p.indent * 12 + 'px' } : null,
      onClick: () => emit('open'), onContextmenu: (e) => { e.preventDefault(); emit('menu', { id: p.row.id, x: e.clientX, y: e.clientY }); },
      onDragstart: (e) => { e.dataTransfer?.setData('text/plain', p.row.id); emit('drag'); },
    }, [
      h('span', { class: ['tc-dot', p.row.working ? 'run' : 'none'] }),
      h('span', { class: 'cl-text' }, [h('span', { class: 'cl-title' }, p.row.title), h('small', p.row.sub)]),
      p.unread ? h('span', { class: 'cl-dot', 'aria-label': 'Unread' }) : null,
    ]);
  },
});

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const view = ref(CHAT_VIEWS.includes(readJson(VIEW_KEY, 'all')) ? readJson(VIEW_KEY, 'all') : 'all');
const expanded = ref(new Set(readJson(OPEN_KEY, [])));
const query = ref('');
const menu = ref(null);
const dragging = ref(null);
const dropTarget = ref(null);
function setView(id) { view.value = id; localStorage.setItem(VIEW_KEY, JSON.stringify(id)); }
function toggle(id) {
  const next = new Set(expanded.value);
  next.has(id) ? next.delete(id) : next.add(id);
  expanded.value = next;
  localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
}

const outputs = computed(() => store.getters['contentOutputs/visibleOutputs'] || []);
const groupById = computed(() => new Map(outputs.value.map((o) => [o.id, o.group_id || null])));
const groupOf = (id) => groupById.value.get(id) || null;
const unreadIds = computed(() => store.getters['contentOutputs/unreadOutputIdSet'] || new Set());
const waitingByChat = computed(() => new Map(checkpoints.state.pending.filter((c) => c.outputId).map((c) => [String(c.outputId), c])));
const rows = computed(() => recentConversations(outputs.value, '', 200, store.getters['contentOutputs/subChatIdSet'], { workingIds: store.getters['chat/streamingOutputIds'], speakingById: store.getters['chat/speakingByOutputId'] })
  .map((r) => { const waiting = waitingByChat.value.get(String(r.id)); return { ...r, waiting: Boolean(waiting), sub: waiting ? KIND[waiting.kind] || 'Needs your OK' : r.working ? 'Working' : ago(new Date(r.at).toISOString()) }; }));
const searched = computed(() => searchRows(rows.value, query.value));
const need = computed(() => searched.value.filter((r) => r.waiting));
const shown = computed(() => searched.value.filter((r) => !r.waiting));
const unread = computed(() => unreadRows(searched.value, unreadIds.value, props.activeId));
const allGroups = computed(() => store.getters['groups/groups'] || []);
const sections = computed(() => groupSections(searched.value, store.getters['groups/groupTree'] || [], groupOf, expanded.value));

function openMenu(at) { menu.value = { ...at, x: Math.min(at.x, window.innerWidth - 200), y: Math.min(at.y, window.innerHeight - 240) }; }
function closeMenu(e) { if (menu.value && !e.target.closest?.('.cl-menu')) menu.value = null; }

/** Move a chat into a group (null: no group). Optimistic, reverted if the server refuses: as in Studio's list. */
async function moveTo(outputId, groupId) {
  menu.value = null;
  const output = outputs.value.find((o) => o.id === outputId);
  if (!output || (output.group_id || null) === groupId) return;
  const before = output.group_id || null;
  output.group_id = groupId;
  try { await store.dispatch('groups/moveToGroup', { outputId, groupId }); } catch (e) { output.group_id = before; nav?.toast?.('Couldn’t move that chat. ' + (e?.message || '')); }
}
function dropOn(groupId) {
  dropTarget.value = null;
  if (dragging.value) moveTo(dragging.value, groupId);
  dragging.value = null;
}
async function newGroup(moveChatId) {
  menu.value = null;
  const name = await nav?.prompt?.({ title: 'New group', message: 'Name the group. Drag chats onto it, or right-click a chat to move it.', placeholder: 'Clients', confirmText: 'Create' });
  if (!name || !name.trim()) return;
  try {
    const group = await store.dispatch('groups/createGroup', { name: name.trim() });
    if (group?.id && !expanded.value.has(group.id)) toggle(group.id);
    if (moveChatId && group?.id) await moveTo(moveChatId, group.id);
  } catch (e) { nav?.toast?.('Couldn’t create the group. ' + (e?.message || '')); }
}
async function markAllRead() {
  try { await store.dispatch('contentOutputs/markAllRead', unread.value.map((r) => r.id)); } catch (e) { nav?.toast?.('Couldn’t mark them read. ' + (e?.message || '')); }
}

onMounted(() => {
  if (!store.getters['contentOutputs/outputs']?.length) store.dispatch('contentOutputs/fetchOutputs').catch(() => {});
  store.dispatch('groups/fetchGroups').catch(() => {});
  checkpoints.loadPending();
  document.addEventListener('mousedown', closeMenu);
});
onBeforeUnmount(() => document.removeEventListener('mousedown', closeMenu));
</script>

<style scoped>
/* .chat-list.cl outranks mk.css's `.mk .chat-list { padding: 10px }`. */
.chat-list.cl { display: flex; flex-direction: column; gap: 1px; padding: 12px 12px 16px; position: relative; }
.cl-top { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.cl-new { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--raised); color: var(--text-primary); font-size: 13.5px; font-weight: 500; }
.cl-new:hover { background: var(--surface-hover); }
.cl-search { display: flex; align-items: center; gap: 7px; height: 30px; padding: 0 9px; border-radius: 8px; background: var(--surface-hover); color: var(--text-tertiary); }
.cl-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text-primary); font-size: 13px; outline: none; }
.cl-head { margin: 10px 6px 3px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
.cl-seg { display: flex; gap: 2px; margin: 10px 0 6px; padding: 2px; border-radius: 8px; background: var(--surface-hover); }
.cl-seg button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: var(--text-tertiary); font-size: 12.5px; }
.cl-seg button.on { background: var(--raised); color: var(--text-primary); font-weight: 500; box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.cl-count { min-width: 16px; padding: 0 5px; border-radius: 99px; background: var(--pink); color: var(--on-fill-brand); font-size: 10.5px; line-height: 16px; text-align: center; }
.cl-count.is-plain { margin-left: auto; background: transparent; color: var(--text-tertiary); }
.cl-row { gap: 8px; padding: 5px 8px; align-items: flex-start; }
.cl-row .tc-dot { margin-top: 6px; }
.cl-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.cl-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; }
.cl-text small { font-size: 11.5px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cl-dot { flex: none; width: 7px; height: 7px; margin-top: 7px; border-radius: 50%; background: var(--pink); }
.cl-link { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; margin: 2px 4px 6px; padding: 2px 4px; border: 0; background: transparent; color: var(--text-secondary); font-size: 12.5px; }
.cl-link:hover { color: var(--text-primary); }
.cl-group { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding: 4px 6px; border-radius: 7px; }
.cl-group.over { background: rgba(var(--pink-rgb), .12); outline: 1px dashed var(--pink); }
.cl-group-name { display: inline-flex; align-items: center; gap: 6px; min-width: 0; border: 0; background: transparent; color: var(--text-secondary); font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cl-group-name.is-static { color: var(--text-tertiary); font-weight: 500; }
.cl-empty { margin: 10px 6px; font-size: 12.5px; color: var(--text-tertiary); }
.cl-menu { position: fixed; z-index: 3000; min-width: 180px; max-height: 240px; overflow-y: auto; padding: 4px; border: 1px solid var(--line); border-radius: 10px; background: var(--color-popup); box-shadow: 0 10px 30px rgba(0, 0, 0, .3); }
.cl-menu-head { padding: 6px 8px 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
.cl-menu button { display: block; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-primary); font-size: 13px; text-align: left; }
.cl-menu button:hover:not(:disabled) { background: var(--surface-hover); }
.cl-menu button:disabled { color: var(--text-tertiary); }
.cl-menu .cl-menu-new { color: var(--text-secondary); border-top: 1px solid var(--line); border-radius: 0 0 6px 6px; margin-top: 2px; }
</style>
