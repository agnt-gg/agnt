<template>
  <div class="output-list-container">
    <SimpleModal ref="simpleModal" />
    <div class="panel-header">
      <h2 class="title">/ Saved Chats</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-file-alt"></i>
          {{ visibleOutputs.length }}
        </span>
      </div>
    </div>
    <div class="card-inner output-list">
      <div class="list-container">
        <!-- Selection bar -->
        <div v-if="isSelectionMode" class="selection-bar">
          <div class="selection-info">
            <i class="fas fa-check-circle"></i>
            <span>{{ selectedCount }} selected</span>
          </div>
          <div class="selection-actions">
            <button @click="clearSelection" class="selection-btn clear-btn">
              <i class="fas fa-times"></i>
              <span>Clear</span>
            </button>
            <button @click="deleteSelectedOutputs" class="selection-btn delete-btn">
              <i class="fas fa-trash"></i>
              <span>Delete ({{ selectedCount }})</span>
            </button>
          </div>
        </div>

        <div class="list-header">
          <input v-model="searchQuery" type="text" placeholder="Search chats..." class="search-input" />
        </div>
        <div id="saved-outputs" class="saved-items">
          <div class="sort-controls">
            <div class="sort-modes">
              <Tooltip text="Unread first" width="auto">
                <button @click="sortBy('attention')" class="sort-button" :class="{ active: sortKey === 'attention' }">
                  <i class="fas fa-bell"></i>
                  <span>Unread</span>
                  <span v-if="unreadConversations.length > 0" class="sort-unread-count">{{ unreadConversations.length }}</span>
                </button>
              </Tooltip>
              <Tooltip v-if="unreadConversations.length > 0" text="Mark all as read" width="auto">
                <button class="mark-all-read-btn" @click.stop="markAllUnreadRead" aria-label="Mark all as read">
                  <i class="fas fa-check-double"></i>
                </button>
              </Tooltip>
              <button @click="sortBy('updated_at')" class="sort-button" :class="{ active: sortKey === 'updated_at' }">
                <span>Date</span>
                <i :class="getSortIcon('updated_at')"></i>
              </button>
            </div>
            <button v-tooltip="'New Chat'" @click="handleNewChat" class="new-chat-btn">
              <i class="fas fa-plus"></i>
              <span class="new-chat-label">New Chat</span>
            </button>
          </div>

          <!-- Groups Section -->
          <div class="groups-section">
            <!-- New Group Button -->
            <button @click="showCreateGroup()" class="create-group-btn">
              <i class="fas fa-folder-plus"></i>
              <span>New Group</span>
            </button>

            <!-- Recursive Group Tree -->
            <template v-for="node in flatGroupTree" :key="node.id">
              <div class="group-section" :style="{ paddingLeft: node.depth * 16 + 'px' }">
                <div
                  class="group-header"
                  draggable="true"
                  @click="toggleGroup(node.id)"
                  @contextmenu.prevent="openGroupMenu($event, node)"
                  @dragstart.stop="onGroupDragStart($event, node)"
                  @dragend="onDragEnd"
                  @dragover.prevent="onDragOver($event, node.id)"
                  @dragleave="onDragLeave($event)"
                  @drop.prevent="onDrop($event, node.id)"
                  :class="{ 'drag-over': dragOverGroupId === node.id, 'dragging': draggedGroup && draggedGroup.id === node.id }"
                >
                  <div class="group-header-left">
                    <span class="group-color-dot"></span>
                    <span class="group-name">{{ node.name }}</span>
                    <i :class="expandedGroups.has(node.id) ? 'fas fa-chevron-down' : 'fas fa-chevron-right'" class="group-chevron"></i>
                  </div>
                <div class="group-header-right">
                  <span v-if="getGroupUnreadBadge(node.id) > 0" class="group-unread-badge" v-tooltip="'Unread chats'">{{ getGroupUnreadBadge(node.id) }}</span>
                  <span class="group-count">{{ searchQuery ? getGroupOutputs(node.id).length : getTotalConversationCount(node.id) }}</span>
                </div>
              </div>
                <div v-if="expandedGroups.has(node.id)" class="group-items">
                  <div v-if="getGroupOutputs(node.id).length === 0 && !node.hasChildren" class="group-empty">
                    <span>No chats</span>
                  </div>
                  <div
                    v-for="output in getGroupOutputs(node.id)"
                    :key="output.id"
                    class="output-item"
                    :class="{ selected: isSelected(output.id), active: isActive(output.id), streaming: isOutputStreaming(output.id) }"
                    draggable="true"
                    @dragstart="onDragStart($event, output)"
                    @dragend="onDragEnd"
                  >
                    <div class="output-content" @click="handleOutputClick(output.id, $event)">
                      <div class="output-preview">
                        <i v-if="isOutputStreaming(output.id)" class="fas fa-circle streaming-indicator"></i>
                        <span v-else-if="isOutputUnread(output.id)" class="unread-dot" v-tooltip="'Unread changes'"></span>
                        {{ getPreviewText(output.content, output) }}
                      </div>
                      <ConversationMetaLine
                        :participants="participantsFor(output)"
                        :speaker="speakerFor(output.id)"
                        :date="formatDate(output.updated_at || output.created_at)"
                      />
                    </div>
                    <div class="output-actions">
                      <button class="action-menu-btn" @click.stop="toggleMenu(output.id, $event)" :ref="(el) => setMenuButtonRef(output.id, el)">
                        <i class="fas fa-ellipsis-v"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Ungrouped Section (only when groups exist) -->
            <div class="group-section ungrouped-section" v-if="groups.length > 0">
              <div
                class="group-header ungrouped-header"
                @click="toggleGroup('__ungrouped__')"
                @dragover.prevent="onDragOver($event, null)"
                @dragleave="onDragLeave($event)"
                @drop.prevent="onDrop($event, null)"
                :class="{ 'drag-over': dragOverGroupId === '__none__' }"
              >
                <div class="group-header-left">
                  <i class="fas fa-inbox ungrouped-icon"></i>
                  <span class="group-name">Ungrouped</span>
                  <i :class="expandedGroups.has('__ungrouped__') ? 'fas fa-chevron-down' : 'fas fa-chevron-right'" class="group-chevron"></i>
                </div>
                <span class="group-count">{{ allUngroupedOutputs.length }}</span>
              </div>
              <div v-if="expandedGroups.has('__ungrouped__')" class="group-items">
                <div
                  v-for="output in ungroupedOutputs"
                  :key="output.id"
                  class="output-item"
                  :class="{ selected: isSelected(output.id), active: isActive(output.id), streaming: isOutputStreaming(output.id) }"
                  draggable="true"
                  @dragstart="onDragStart($event, output)"
                  @dragend="onDragEnd"
                >
                  <div class="output-content" @click="handleOutputClick(output.id, $event)">
                    <div class="output-preview">
                      <i v-if="isOutputStreaming(output.id)" class="fas fa-circle streaming-indicator"></i>
                      <span v-else-if="isOutputUnread(output.id)" class="unread-dot" v-tooltip="'Unread changes'"></span>
                      {{ getPreviewText(output.content, output) }}
                    </div>
                    <ConversationMetaLine
                      :participants="participantsFor(output)"
                      :speaker="speakerFor(output.id)"
                      :date="formatDate(output.updated_at || output.created_at)"
                    />
                  </div>
                  <div class="output-actions">
                    <button class="action-menu-btn" @click.stop="toggleMenu(output.id, $event)" :ref="(el) => setMenuButtonRef(output.id, el)">
                      <i class="fas fa-ellipsis-v"></i>
                    </button>
                  </div>
                </div>
                <!-- Ungrouped pagination -->
                <div v-if="hasMoreUngrouped" class="ungrouped-pagination">
                  <span class="ungrouped-pagination-info">Showing {{ ungroupedOutputs.length }} of {{ allUngroupedOutputs.length }}</span>
                  <div class="ungrouped-pagination-btns">
                    <button @click="showMoreUngrouped" class="pagination-btn load-more">
                      <i class="fas fa-arrow-down"></i>
                      <span>More (20)</span>
                    </button>
                    <button @click="showAllUngrouped" class="pagination-btn load-all">
                      <i class="fas fa-list"></i>
                      <span>Show All</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Flat list when no groups exist -->
            <div v-if="groups.length === 0" class="output-list-items">
              <div v-if="visibleOutputs.length === 0" class="no-outputs">
                <p>No saved chats yet. Start a chat to create one.</p>
              </div>
              <div
                v-for="output in sortedOutputs"
                :key="output.id"
                class="output-item"
                :class="{ selected: isSelected(output.id), active: isActive(output.id), streaming: isOutputStreaming(output.id) }"
              >
                <div class="output-content" @click="handleOutputClick(output.id, $event)">
                  <div class="output-preview">
                    <i v-if="isOutputStreaming(output.id)" class="fas fa-circle streaming-indicator"></i>
                    <span v-else-if="isOutputUnread(output.id)" class="unread-dot" v-tooltip="'Unread changes'"></span>
                    {{ getPreviewText(output.content, output) }}
                  </div>
                  <ConversationMetaLine
                    :participants="participantsFor(output)"
                    :speaker="speakerFor(output.id)"
                    :date="formatDate(output.updated_at || output.created_at)"
                  />
                </div>
                <div class="output-actions">
                  <button class="action-menu-btn" @click.stop="toggleMenu(output.id, $event)" :ref="(el) => setMenuButtonRef(output.id, el)">
                    <i class="fas fa-ellipsis-v"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- Archived section (collapsed by default). Archived means done:
                 out of the working set, never unread, still searchable. -->
            <div v-if="archivedList.length > 0" class="group-section archived-section">
              <div class="group-header archived-header" @click="toggleGroup('__archived__')">
                <div class="group-header-left">
                  <i class="fas fa-archive ungrouped-icon"></i>
                  <span class="group-name">Archived</span>
                  <i :class="expandedGroups.has('__archived__') ? 'fas fa-chevron-down' : 'fas fa-chevron-right'" class="group-chevron"></i>
                </div>
                <span class="group-count">{{ archivedList.length }}</span>
              </div>
              <div v-if="expandedGroups.has('__archived__')" class="group-items">
                <div
                  v-for="output in archivedList"
                  :key="output.id"
                  class="output-item archived-item"
                  :class="{ selected: isSelected(output.id), active: isActive(output.id) }"
                >
                  <div class="output-content" @click="handleOutputClick(output.id, $event)">
                    <div class="output-preview">{{ getPreviewText(output.content, output) }}</div>
                    <!-- Archived rows never carry a speaker: nothing runs in a
                         conversation that has been put away. -->
                    <ConversationMetaLine
                      :participants="participantsFor(output)"
                      :date="formatDate(output.updated_at || output.created_at)"
                    />
                  </div>
                  <div class="output-actions">
                    <button class="action-menu-btn" @click.stop="toggleMenu(output.id, $event)" :ref="(el) => setMenuButtonRef(output.id, el)">
                      <i class="fas fa-ellipsis-v"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Output context menu (shared across all sections) -->
          <Teleport to="body">
            <div v-if="activeMenu" class="action-menu" @click.stop :style="menuPosition">
              <button @click="startRename(getOutputById(activeMenu))" class="menu-item">
                <i class="fas fa-edit"></i>
                <span>Rename</span>
              </button>
              <button
                v-if="unreadOutputIds.has(activeMenu)"
                @click="toggleUnread(activeMenu)"
                class="menu-item"
              >
                <i class="fas fa-envelope-open"></i>
                <span>Mark as Read</span>
              </button>
              <button
                v-else
                @click="toggleUnread(activeMenu)"
                class="menu-item"
              >
                <i class="fas fa-envelope"></i>
                <span>Mark as Unread</span>
              </button>
              <button @click="toggleArchived(activeMenu)" class="menu-item">
                <i class="fas fa-archive"></i>
                <span>{{ getOutputById(activeMenu)?.archived_at ? 'Unarchive' : 'Archive' }}</span>
              </button>
              <!-- Move to group submenu -->
              <button class="menu-item" @click.stop="showMoveSubmenu = !showMoveSubmenu">
                <i class="fas fa-folder"></i>
                <span>Move to Group</span>
                <i :class="showMoveSubmenu ? 'fas fa-chevron-down' : 'fas fa-chevron-right'" class="submenu-arrow"></i>
              </button>
              <div v-if="showMoveSubmenu" class="submenu-inline">
                <template v-for="node in moveMenuFlatGroups" :key="node.id">
                  <button
                    @click.stop="node.hasChildren ? toggleMoveMenuGroup(node.id) : moveOutputToGroup(activeMenu, node.id)"
                    class="menu-item submenu-item"
                    :class="{ active: getOutputById(activeMenu)?.group_id === node.id }"
                    :style="{ paddingLeft: (28 + node.depth * 20) + 'px' }"
                  >
                    <span class="group-color-dot"></span>
                    <span class="submenu-group-name">{{ node.name }}</span>
                    <i v-if="node.hasChildren" :class="moveMenuExpanded.has(node.id) ? 'fas fa-chevron-down' : 'fas fa-chevron-right'" class="submenu-chevron" @click.stop="toggleMoveMenuGroup(node.id)"></i>
                    <i v-if="node.hasChildren" class="fas fa-arrow-right submenu-move-icon" @click.stop="moveOutputToGroup(activeMenu, node.id)" v-tooltip="'Move here'"></i>
                  </button>
                </template>
                <button @click="moveOutputToGroup(activeMenu, null)" class="menu-item submenu-item" :class="{ active: !getOutputById(activeMenu)?.group_id }">
                  <i class="fas fa-inbox"></i>
                  <span>Ungrouped</span>
                </button>
              </div>
              <div class="menu-separator"></div>
              <button @click="activeMenu = null; showCreateGroup()" class="menu-item">
                <i class="fas fa-folder-plus"></i>
                <span>New Group</span>
              </button>
              <button @click="deleteOutput(activeMenu)" class="menu-item delete">
                <i class="fas fa-trash"></i>
                <span>Delete</span>
              </button>
            </div>
          </Teleport>

          <!-- Group context menu -->
          <Teleport to="body">
            <div v-if="groupMenu" class="action-menu" @click.stop :style="groupMenuPosition">
              <button @click="showCreateGroup(groupMenu.id)" class="menu-item">
                <i class="fas fa-folder-plus"></i>
                <span>New Sub-group</span>
              </button>
              <button @click="editGroup(groupMenu)" class="menu-item">
                <i class="fas fa-edit"></i>
                <span>Edit Group</span>
              </button>
              <button @click="deleteGroup(groupMenu.id, 'move')" class="menu-item delete">
                <i class="fas fa-level-up-alt"></i>
                <span>Delete (Keep Children)</span>
              </button>
              <button @click="deleteGroup(groupMenu.id, 'delete')" class="menu-item delete">
                <i class="fas fa-trash"></i>
                <span>Delete All</span>
              </button>
            </div>
          </Teleport>

        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { useRoute, useRouter } from 'vue-router';
import { ref, computed, nextTick, onMounted, onBeforeUnmount, inject, watch } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { sortOutputs } from './outputSort.js';
import { groupUnreadCount, notifiableUnreadIds, formatListDate } from '@/utils/conversationAttention.js';
import ConversationMetaLine from './ConversationMetaLine.vue';

export default {
  name: 'OutputList',
  components: {
    SimpleModal,
    Tooltip,
    ConversationMetaLine,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const simpleModal = ref(null);
    const searchQuery = ref('');

    // Sort preference. Persisted because "how my conversation list is
    // ordered" is a preference, not session state — re-picking it on every
    // reload is the kind of small tax that makes people stop using a control.
    //
    // The default is 'attention' — the "Unread" mode: unread first, newest
    // on top. It is the default because it is the only ordering that cannot
    // bury something waiting on you, which is why the panel needs no
    // separate unread section. 'updated_at' is pure recency.
    //
    // The stored key stays 'attention' even though the button reads "Unread":
    // renaming it would silently discard every user's saved preference for
    // nothing but a cosmetic match.
    const SORT_PREF_KEY = 'chatPanel.sortPreference';
    const SORT_KEYS = ['attention', 'updated_at', 'content'];

    function loadSortPreference() {
      try {
        const saved = JSON.parse(localStorage.getItem(SORT_PREF_KEY) || 'null');
        if (saved && SORT_KEYS.includes(saved.key)) {
          return { key: saved.key, order: saved.order === 'asc' ? 'asc' : 'desc' };
        }
      } catch {
        // A corrupt preference must never take the sidebar down with it.
      }
      return { key: 'attention', order: 'desc' };
    }

    const savedSort = loadSortPreference();
    const sortKey = ref(savedSort.key);
    const sortOrder = ref(savedSort.order);
    watch([sortKey, sortOrder], ([key, order]) => {
      try {
        localStorage.setItem(SORT_PREF_KEY, JSON.stringify({ key, order }));
      } catch {
        // Private mode / quota: losing the preference is survivable.
      }
    });
    const activeMenu = ref(null);
    const menuPosition = ref({});
    const menuButtonRefs = ref({});
    const showMoveSubmenu = ref(false);
    const moveMenuExpanded = ref(new Set());

    // Group state
    const expandedGroups = ref(new Set(['__ungrouped__']));
    const groupMenu = ref(null);
    const groupMenuPosition = ref({});
    const draggedOutput = ref(null);
    const draggedGroup = ref(null);
    const dragOverGroupId = ref(null);

    // Multi-select state
    const selectedOutputIds = ref(new Set());
    const lastSelectedId = ref(null);

    // Active/current conversation — DERIVED, never click-written. Two
    // sources with a deliberate handoff:
    //
    //   1. route `content-id` — written SYNCHRONOUSLY by navigateToOutput's
    //      router.push, so the clicked row highlights immediately, before
    //      the conversation has loaded.
    //   2. chat.savedOutputId — the store mirror, which catches up when the
    //      load completes. Chat.vue then strips the route param
    //      (router.replace('/chat')), handing the highlight to the store
    //      with no gap and no flicker — both name the same output id.
    //
    // The store side is also what highlights a brand-new chat on its first
    // autosave (no click, no route param). The click-written local ref this
    // replaced could do neither.
    const activeOutputId = computed(() => route.query['content-id'] || store.state.chat.savedOutputId);

    // Streaming output IDs from the chat store
    const streamingOutputIds = computed(() => store.getters['chat/streamingOutputIds'] || new Set());

    // WHO IS IN EACH CONVERSATION, and WHO IS TALKING IN IT RIGHT NOW.
    //
    // The roster is a stored column, not something derived here: a sidebar row
    // has no transcript to derive it from (LIST_COLUMNS excludes `content`
    // because rows average ~0.5MB). The server writes it on every save from
    // the transcript it is already parsing — see
    // backend/src/utils/transcriptParticipants.js.
    const speakingByOutputId = computed(() => store.getters['chat/speakingByOutputId'] || {});

    /**
     * The stored roster for a row, as [{ id, name }] — agents only, Annie
     * excluded (she is added by the avatar stack, because she is in every
     * conversation by definition).
     *
     * Tolerates every shape a real row can hold: NULL for the ~2,000 rows
     * that predate the column, an already-parsed array if some caller hands
     * one over, and unparseable text. All three degrade to "Annie alone",
     * which is the correct rendering rather than a broken one.
     */
    function participantsFor(output) {
      const stored = output?.participants;
      if (!stored) return [];
      if (Array.isArray(stored)) return stored;
      if (typeof stored !== 'string') return [];
      try {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    /** { id, name } while a run is in flight in this row, else null. */
    function speakerFor(outputId) {
      return speakingByOutputId.value[outputId] || null;
    }

    // Unread output IDs — DERIVED server-side state (updated_at >
    // last_read_at on content_outputs; see utils/conversationAttention.js).
    // Cross-device: reading a conversation on any device clears the dot
    // everywhere on the next refetch. Rendered as a static green dot;
    // cleared by the markRead PATCH when the conversation is opened.
    const unreadOutputIds = computed(() => store.getters['contentOutputs/unreadOutputIdSet'] || new Set());

    // Client-side activity timestamps, written on three events: a save, a run
    // completing, and a manual "Mark as Unread". All three now move
    // `updated_at` server-side, so the bump is purely about latency — the
    // item rises now rather than after the round-trip, and the two values
    // agree once it lands.
    //
    // The sort takes max(updated_at, bump) — see outputSort.js. Reading an item
    // clears the unread flag but deliberately does NOT touch this map, so the
    // item keeps its position instead of resorting under the cursor. The map
    // resets on reload, where DB `updated_at` order takes over on its own.
    const bumpTimestamps = ref({});
    // Position bumps: any NEW unread id gets a bump so the item rises
    // immediately. This deliberately includes streaming/active rows — it is
    // about list position, not noise.
    watch(unreadOutputIds, (newSet, oldSet) => {
      if (!newSet || newSet.size === 0) return;
      const next = { ...bumpTimestamps.value };
      let changed = false;
      newSet.forEach((id) => {
        if (!oldSet || !oldSet.has(id)) {
          next[id] = Date.now();
          changed = true;
        }
      });
      if (changed) bumpTimestamps.value = next;
    });

    // The CHIME derives from a stricter set than the dot: unread minus
    // streaming — see notifiableUnreadIds for why (a streaming conversation
    // re-derives unread on every ~5s autosave; ringing on those turned long
    // agent runs into a metronome). The ACTIVE conversation is NOT excluded:
    // the chime is an oven timer, and a run finishing rings once even for
    // the selected chat — selection says nothing about whether the user is
    // actually looking. Ringing on ENTRY into this set gives exactly one
    // chime per thing that finished changing. A manual "Mark as Unread"
    // rings too (Nathan's call): every entry into the unread set sounds the
    // same — the chime confirms the row is queued.
    const notifiableIds = computed(() =>
      notifiableUnreadIds(unreadOutputIds.value, {
        streamingIds: streamingOutputIds.value,
      })
    );
    watch(notifiableIds, (newSet, oldSet) => {
      let ring = false;
      newSet.forEach((id) => {
        if (!oldSet || !oldSet.has(id)) ring = true;
      });
      if (ring) playSound('chatUnread');
    });

    // Get outputs from store. `outputs` is the FULL list (needed by
    // getOutputById so context menus keep working in the Archived section);
    // `visibleOutputs` excludes archived and is what every main list,
    // count, and unread derivation renders from.
    const outputs = computed(() => store.getters['contentOutputs/outputs']);
    const visibleOutputs = computed(() => store.getters['contentOutputs/visibleOutputs']);
    const archivedOutputs = computed(() => store.getters['contentOutputs/archivedOutputs']);
    const totalCount = computed(() => store.getters['contentOutputs/totalCount']);
    const hasMore = computed(() => store.getters['contentOutputs/hasMore']);
    const hasLoadedAll = computed(() => store.getters['contentOutputs/hasLoadedAll']);
    const isFetchingMore = computed(() => store.getters['contentOutputs/isFetching']);

    // Groups
    const groups = computed(() => store.getters['groups/groups']);
    const groupTree = computed(() => store.getters['groups/groupTree']);

    // Flatten tree into a visible list with depth info (only show children of expanded parents)
    const flatGroupTree = computed(() => {
      const result = [];
      const walk = (nodes, depth) => {
        for (const node of nodes) {
          const hasChildren = node.children && node.children.length > 0;
          result.push({ ...node, depth, hasChildren });
          if (hasChildren && expandedGroups.value.has(node.id)) {
            walk(node.children, depth + 1);
          }
        }
      };
      walk(groupTree.value, 0);
      return result;
    });

    // Full flattened tree (always all nodes, for move menu)
    const allFlatGroups = computed(() => {
      const result = [];
      const walk = (nodes, depth) => {
        for (const node of nodes) {
          result.push({ ...node, depth });
          if (node.children && node.children.length > 0) {
            walk(node.children, depth + 1);
          }
        }
      };
      walk(groupTree.value, 0);
      return result;
    });

    // Flattened tree for move menu (respects moveMenuExpanded)
    const moveMenuFlatGroups = computed(() => {
      const result = [];
      const walk = (nodes, depth) => {
        for (const node of nodes) {
          const hasChildren = node.children && node.children.length > 0;
          result.push({ ...node, depth, hasChildren });
          if (hasChildren && moveMenuExpanded.value.has(node.id)) {
            walk(node.children, depth + 1);
          }
        }
      };
      walk(groupTree.value, 0);
      return result;
    });

    function toggleMoveMenuGroup(groupId) {
      playSound('typewriterKeyPress');
      const next = new Set(moveMenuExpanded.value);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      moveMenuExpanded.value = next;
    }

    // Multi-select computed
    const isSelectionMode = computed(() => selectedOutputIds.value.size > 0);
    const selectedCount = computed(() => selectedOutputIds.value.size);

    // Filter + sort helper, shared by all three lists (grouped, ungrouped,
    // and flat). Ordering lives in outputSort.js so it can be tested without
    // mounting the component; see that file for why a save and a manual
    // "Mark as Unread" have to compete on one axis rather than in two tiers.
    function filterAndSort(list) {
      const filtered = list.filter((output) => {
        if (!searchQuery.value) return true;
        const title = getPreviewText(output.content, output).toLowerCase();
        return title.includes(searchQuery.value.toLowerCase());
      });
      return sortOutputs(filtered, {
        sortKey: sortKey.value,
        sortOrder: sortOrder.value,
        bumps: bumpTimestamps.value,
        // A conversation with a run in flight pins to the top of the Unread
        // sort — opening it must not drop it below the unread rows while it
        // is still writing. See outputSort.js (the streaming tier).
        streamingIds: streamingOutputIds.value,
        previewOf: (output) => getPreviewText(output.content, output),
      });
    }

    const sortedOutputs = computed(() => filterAndSort(visibleOutputs.value));

    // Every unread conversation, longest-waiting first.
    //
    // This used to also render as a pinned "Needs you" card above the groups.
    // The card was redundant: the Unread sort mode already lifts exactly
    // these rows to the top of the list, so the card showed the same
    // conversations a second time, a few pixels higher. Two copies of one row
    // in one panel is worse than none — it doubles the click targets, doubles
    // the state that can disagree, and costs vertical space permanently.
    //
    // What the card genuinely carried survives here: the count (now a badge
    // on the Unread button) and the one-click clear beside it.
    //
    // The currently-viewed and currently-streaming conversations are
    // excluded: one is being looked at, the other announces itself. That
    // exclusion is why this is not simply `unreadOutputIdSet`.
    const unreadConversations = computed(() => {
      const activeSavedId = store.state.chat.savedOutputId;
      return (store.getters['contentOutputs/triageRail'] || [])
        .filter((o) => o.id !== activeSavedId && !streamingOutputIds.value.has(o.id));
    });

    // Clear every unread conversation in one write. Scoped to the ids above:
    // "mark all read" must mean exactly what the user could see when they
    // pressed the button, never the conversation they are reading or a run
    // still in flight.
    async function markAllUnreadRead() {
      const ids = unreadConversations.value.map((o) => o.id);
      if (ids.length === 0) return;
      playSound('typewriterKeyPress');
      try {
        await store.dispatch('contentOutputs/markAllRead', ids);
      } catch {
        // The action already rolled the optimistic flip back; the dots
        // reappearing IS the error message.
      }
    }

    // Unread rollup for a group header: unread count across the group AND
    // all its descendants, so a collapsed parent still shows what's waiting.
    function getGroupUnreadBadge(groupId) {
      return groupUnreadCount(visibleOutputs.value, getDescendantIds(groupId));
    }

    // Collect all descendant group IDs (including self)
    function getDescendantIds(groupId) {
      const ids = new Set([groupId]);
      const collect = (nodes) => {
        for (const node of nodes) {
          if (ids.has(node.parent_id)) {
            ids.add(node.id);
          }
        }
      };
      // Iterate until no new ids added (handles any depth)
      let prevSize = 0;
      while (ids.size !== prevSize) {
        prevSize = ids.size;
        collect(groups.value);
      }
      return ids;
    }

    // Total conversation count including all descendants (archived excluded)
    function getTotalConversationCount(groupId) {
      const ids = getDescendantIds(groupId);
      return visibleOutputs.value.filter((o) => ids.has(o.group_id)).length;
    }

    // Get outputs belonging to a specific group
    // When searching, include conversations from all descendant groups
    function getGroupOutputs(groupId) {
      if (searchQuery.value) {
        const ids = getDescendantIds(groupId);
        return filterAndSort(visibleOutputs.value.filter((o) => ids.has(o.group_id)));
      }
      return filterAndSort(visibleOutputs.value.filter((o) => o.group_id === groupId));
    }

    // Ungrouped display limit
    const ungroupedDisplayLimit = ref(20);

    // All ungrouped outputs (full list)
    const allUngroupedOutputs = computed(() => {
      return filterAndSort(visibleOutputs.value.filter((o) => !o.group_id));
    });

    // Archived section (collapsed by default, bottom of the sidebar).
    // Search still reaches into it — archived means done, not deleted.
    const archivedList = computed(() => filterAndSort(archivedOutputs.value));

    // Displayed ungrouped outputs (capped by limit when groups exist)
    const ungroupedOutputs = computed(() => {
      if (groups.value.length === 0) return allUngroupedOutputs.value;
      return allUngroupedOutputs.value.slice(0, ungroupedDisplayLimit.value);
    });

    const hasMoreUngrouped = computed(() => {
      return groups.value.length > 0 && allUngroupedOutputs.value.length > ungroupedDisplayLimit.value;
    });

    function showMoreUngrouped() {
      ungroupedDisplayLimit.value += 20;
    }

    function showAllUngrouped() {
      ungroupedDisplayLimit.value = Infinity;
    }

    // Get output by id for context menu
    function getOutputById(id) {
      return outputs.value.find((o) => o.id === id) || null;
    }

    // Toggle group expand/collapse
    function toggleGroup(groupId) {
      playSound('typewriterKeyPress');
      const next = new Set(expandedGroups.value);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      expandedGroups.value = next;
    }

    // Drag and drop
    function onDragStart(event, output) {
      draggedOutput.value = output;
      draggedGroup.value = null;
      event.dataTransfer.effectAllowed = 'move';

      // If this output is part of a selection, drag all selected items
      if (selectedOutputIds.value.has(output.id)) {
        const ids = Array.from(selectedOutputIds.value);
        event.dataTransfer.setData('text/plain', JSON.stringify(ids));
      } else {
        event.dataTransfer.setData('text/plain', output.id);
      }
    }

    function onGroupDragStart(event, group) {
      draggedGroup.value = group;
      draggedOutput.value = null;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', 'group:' + group.id);
    }

    function onDragEnd() {
      draggedOutput.value = null;
      draggedGroup.value = null;
      dragOverGroupId.value = null;
    }

    function onDragOver(event, groupId) {
      // Prevent dropping a group onto itself
      if (draggedGroup.value && draggedGroup.value.id === groupId) return;
      event.dataTransfer.dropEffect = 'move';
      dragOverGroupId.value = groupId === null ? '__none__' : groupId;
    }

    function onDragLeave(event) {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        dragOverGroupId.value = null;
      }
    }

    // Check if targetId is a descendant of groupId (prevent circular nesting)
    function isDescendant(groupId, targetId) {
      const check = (nodes) => {
        for (const node of nodes) {
          if (node.id === groupId) {
            // Found the group — now check if targetId is in its subtree
            const findInChildren = (children) => {
              for (const child of children) {
                if (child.id === targetId) return true;
                if (child.children && findInChildren(child.children)) return true;
              }
              return false;
            };
            return node.children ? findInChildren(node.children) : false;
          }
          if (node.children && check(node.children)) return true;
        }
        return false;
      };
      return check(groupTree.value);
    }

    async function onDrop(event, groupId) {
      dragOverGroupId.value = null;

      // Handle group drop (reparent)
      if (draggedGroup.value) {
        const group = draggedGroup.value;
        draggedGroup.value = null;

        // Don't drop onto self or current parent
        if (group.id === groupId) return;
        if ((group.parent_id || null) === groupId) return;
        // Prevent circular: can't drop a parent into its own descendant
        if (groupId && isDescendant(group.id, groupId)) return;

        // Optimistic reparent: mutate local state immediately so the drop
        // feels instant, then fire the PATCH. Revert on failure. Skipping
        // the follow-up fetchGroups() — updateGroup already commits the
        // server response into the store, so a refetch is redundant.
        const originalParentId = group.parent_id || null;
        store.commit('groups/UPDATE_GROUP', { id: group.id, parent_id: groupId || null });
        if (groupId) {
          const next = new Set(expandedGroups.value);
          next.add(groupId);
          expandedGroups.value = next;
        }
        store.dispatch('groups/updateGroup', { id: group.id, parent_id: groupId || null })
          .catch((error) => {
            console.error('Error reparenting group:', error);
            store.commit('groups/UPDATE_GROUP', { id: group.id, parent_id: originalParentId });
          });
        return;
      }

      // Handle output drop
      const output = draggedOutput.value;
      if (!output) return;
      draggedOutput.value = null;

      // Collect all IDs to move: selected items if dragging a selected item, otherwise just the one
      const idsToMove = selectedOutputIds.value.has(output.id) && selectedOutputIds.value.size > 1
        ? Array.from(selectedOutputIds.value)
        : [output.id];

      // Filter out items already in the target group
      const filteredIds = idsToMove.filter((id) => {
        const o = getOutputById(id);
        return o && (o.group_id || null) !== groupId;
      });

      if (filteredIds.length === 0) return;

      // Optimistic move: flip group_id on the local outputs first so the
      // item visually jumps to the new group without waiting for the round-
      // trip. Fire the PATCH in the background; revert on failure. The
      // group tree's per-node counts are computed from `outputs` (see
      // getTotalConversationCount), so no refetch is needed — the counts
      // update from this same mutation.
      const originalGroupIds = new Map();
      filteredIds.forEach((id) => {
        const o = getOutputById(id);
        if (o) {
          originalGroupIds.set(id, o.group_id || null);
          o.group_id = groupId;
        }
      });
      clearSelection();

      const request = filteredIds.length === 1
        ? store.dispatch('groups/moveToGroup', { outputId: filteredIds[0], groupId })
        : store.dispatch('groups/bulkMoveToGroup', { outputIds: filteredIds, groupId });

      request.catch((error) => {
        console.error('Error moving output(s):', error);
        originalGroupIds.forEach((origGroupId, id) => {
          const o = getOutputById(id);
          if (o) o.group_id = origGroupId;
        });
      });
    }

    // Move output to group (from context menu)
    async function moveOutputToGroup(outputId, groupId) {
      activeMenu.value = null;
      showMoveSubmenu.value = false;
      const output = getOutputById(outputId);
      if (!output || (output.group_id || null) === groupId) return;

      try {
        await store.dispatch('groups/moveToGroup', { outputId, groupId });
        output.group_id = groupId;
        store.dispatch('groups/fetchGroups', { force: true });
      } catch (error) {
        console.error('Error moving output:', error);
      }
    }

    // Group CRUD
    async function showCreateGroup(parentId = null) {
      groupMenu.value = null;
      playSound('buttonClick');
      const title = parentId ? 'New Sub-group' : 'New Group';
      const message = parentId ? 'Enter a name for the sub-group:' : 'Enter a name for the new group:';
      const name = await simpleModal.value.showModal({
        title,
        message,
        isPrompt: true,
        defaultValue: '',
        placeholder: 'Group name...',
        confirmText: 'Create',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
      });
      if (!name || name.trim() === '') return;

      try {
        const group = await store.dispatch('groups/createGroup', { name: name.trim(), parent_id: parentId });
        const next = new Set(expandedGroups.value);
        next.add(group.id);
        // Also expand the parent so the new child is visible
        if (parentId) next.add(parentId);
        expandedGroups.value = next;
      } catch (error) {
        console.error('Error creating group:', error);
      }
    }

    function openGroupMenu(event, group) {
      groupMenu.value = group;
      groupMenuPosition.value = {
        position: 'fixed',
        top: `${event.clientY}px`,
        left: `${event.clientX}px`,
      };
    }

    async function editGroup(group) {
      groupMenu.value = null;
      const name = await simpleModal.value.showModal({
        title: 'Edit Group',
        message: 'Enter a new name for the group:',
        isPrompt: true,
        defaultValue: group.name,
        placeholder: 'Group name...',
        confirmText: 'Save',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
      });
      if (!name || name.trim() === '' || name.trim() === group.name) return;

      try {
        await store.dispatch('groups/updateGroup', { id: group.id, name: name.trim(), color: group.color });
      } catch (error) {
        console.error('Error updating group:', error);
      }
    }

    async function deleteGroup(groupId, mode = 'move') {
      groupMenu.value = null;
      const message = mode === 'delete'
        ? 'Delete this group AND all sub-groups? Chats will be moved to Ungrouped.'
        : 'Delete this group? Sub-groups will be moved up and chats will be ungrouped.';

      const confirmed = await simpleModal.value.showModal({
        title: 'Delete Group',
        message,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });
      if (!confirmed) return;

      try {
        await store.dispatch('groups/deleteGroup', { id: groupId, mode });
        store.dispatch('contentOutputs/refreshOutputs');
      } catch (error) {
        console.error('Error deleting group:', error);
      }
    }

    function createNewOutput() {
      try {
        router.push('/chat');
      } catch (error) {
        console.error('Navigation failed:', error);
        // Fallback for navigation failure
        window.location.href = '/chat';
      }
    }

    async function handleNewChat() {
      playSound('buttonClick');
      const confirmed = await simpleModal.value?.showModal({
        title: 'Start a new chat?',
        message: 'Your current chat will be saved. You can pick it back up anytime from your saved chats.',
        confirmText: 'New chat',
        confirmClass: 'btn-primary',
      });
      if (!confirmed) return;
      // Navigate to chat screen without query params
      router.push('/chat');
      // Dispatch event to trigger full clear and re-initialization in Chat.vue
      window.dispatchEvent(new CustomEvent('trigger-new-chat'));
    }

    async function fetchSavedOutputs() {
      // Load all outputs - the list endpoint only returns metadata (no content column)
      await store.dispatch('contentOutputs/loadAll');
    }

    async function loadMore() {
      playSound('buttonClick');
      await store.dispatch('contentOutputs/loadMore');
    }

    async function loadAll() {
      playSound('buttonClick');
      await store.dispatch('contentOutputs/loadAll');
    }

    // Email-style: today shows the TIME, so a save or mark-unread today
    // visibly re-dates the row instead of repeating the same day string.
    function formatDate(date) {
      return formatListDate(date);
    }

    function getPreviewText(content, output) {
      // Use the title field directly (list endpoint no longer sends full content)
      if (output && output.title) {
        return truncateText(output.title);
      }

      // Fallback for legacy outputs that may still have content
      if (content && typeof content === 'string') {
        // Try JSON title extraction only if content looks like JSON
        if (content.charAt(0) === '{') {
          try {
            const parsed = JSON.parse(content);
            if (parsed.title) {
              return truncateText(parsed.title);
            }
          } catch (e) {
            // Not valid JSON
          }
        }
        // Simple text truncation as last resort
        return truncateText(content.replace(/<[^>]*>/g, '').split('\n')[0]);
      }

      return 'Untitled';
    }

    function truncateText(text, maxLength = 100) {
      if (typeof text !== 'string') {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return text.slice(0, maxLength) + '...';
    }

    function sortBy(key) {
      // 'attention' has no direction — see outputSort.js. Clicking it while
      // active is a no-op rather than a silent flip to a meaningless order.
      if (key === 'attention') {
        sortKey.value = 'attention';
        return;
      }
      if (sortKey.value === key) {
        sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
      } else {
        // Newest-first on first pick: an unprompted oldest-first date sort is
        // never what "sort by date" means in a conversation list.
        sortKey.value = key;
        sortOrder.value = 'desc';
      }
    }

    function getSortIcon(key) {
      if (sortKey.value !== key) return 'fas fa-sort';
      return sortOrder.value === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
    }

    function navigateToOutput(outputId) {
      playSound('buttonClick');
      try {
        router.push(`/chat?content-id=${outputId}`);
      } catch (error) {
        console.error('Navigation failed:', error);
        window.location.href = `/chat?content-id=${outputId}`;
      }
    }

    // Handle output click with shift detection
    function handleOutputClick(outputId, event) {
      if (event.shiftKey) {
        event.preventDefault();
        playSound('buttonClick');

        // If there's an active item that's not selected, add it to selection first
        if (activeOutputId.value && !selectedOutputIds.value.has(activeOutputId.value)) {
          const newSelection = new Set(selectedOutputIds.value);
          newSelection.add(activeOutputId.value);
          selectedOutputIds.value = new Set(newSelection);
          lastSelectedId.value = activeOutputId.value;
        }

        toggleSelection(outputId, event);
      } else {
        // Clear selection when navigating normally
        if (isSelectionMode.value) {
          clearSelection();
        }
        navigateToOutput(outputId);
      }
    }

    // Toggle selection
    function toggleSelection(outputId, event) {
      const newSelection = new Set(selectedOutputIds.value);

      if (newSelection.has(outputId)) {
        // Deselect if already selected
        newSelection.delete(outputId);
      } else {
        // Just add the clicked item (no range selection)
        newSelection.add(outputId);
      }

      // Force reactivity by creating a new Set instance
      selectedOutputIds.value = new Set(newSelection);
    }

    // Get range of outputs between two IDs
    function getOutputRange(startId, endId) {
      const ids = sortedOutputs.value.map((o) => o.id);
      const startIndex = ids.indexOf(startId);
      const endIndex = ids.indexOf(endId);

      const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

      return ids.slice(from, to + 1);
    }

    // Clear selection
    function clearSelection() {
      selectedOutputIds.value = new Set();
      lastSelectedId.value = null;
    }

    // Check if output is selected
    function isSelected(outputId) {
      return selectedOutputIds.value.has(outputId);
    }

    // Check if output is active/current
    function isActive(outputId) {
      return activeOutputId.value === outputId;
    }

    // Check if output has an active stream
    function isOutputStreaming(outputId) {
      return streamingOutputIds.value.has(outputId);
    }

    // Check if output has an unread change. Only suppressed while
    // streaming (the pulsing indicator already tells them). We DON'T
    // suppress on active — a finished run or a manual "Mark as Unread"
    // shows the dot even on the currently-selected chat, and only
    // clicking into the conversation clears it (the email model).
    function isOutputUnread(outputId) {
      if (!unreadOutputIds.value.has(outputId)) return false;
      if (isOutputStreaming(outputId)) return false;
      return true;
    }

    // Manual toggle from the 3-dot menu. Marking an item unread while
    // it's the currently-active conversation is intentionally allowed —
    // the dot shows immediately and stays until the user clicks back
    // into the conversation.
    function toggleUnread(outputId) {
      if (!outputId) return;
      activeMenu.value = null;
      if (unreadOutputIds.value.has(outputId)) {
        store.dispatch('contentOutputs/markRead', outputId).catch(() => {});
      } else {
        store.dispatch('contentOutputs/markUnread', outputId).catch(() => {});
      }
    }

    // Archive / unarchive from the context menu. Optimistic in the store;
    // the item moves between the main list and the Archived section
    // immediately. Archiving also silences any unread state — archive IS
    // "I'm done with this".
    function toggleArchived(outputId) {
      if (!outputId) return;
      activeMenu.value = null;
      const output = getOutputById(outputId);
      if (!output) return;
      playSound('buttonClick');
      store.dispatch('contentOutputs/setArchived', {
        outputId,
        archived: !output.archived_at,
      }).catch(async () => {
        await simpleModal.value.showModal({
          title: 'Error',
          message: `Failed to ${output.archived_at ? 'unarchive' : 'archive'} chat`,
          confirmText: 'OK',
          showCancel: false,
        });
      });
    }

    // Batch delete selected outputs
    async function deleteSelectedOutputs() {
      playSound('buttonClick');

      // Collect ALL highlighted items (selected + active)
      const itemsToDelete = new Set(selectedOutputIds.value);
      if (activeOutputId.value && !itemsToDelete.has(activeOutputId.value)) {
        itemsToDelete.add(activeOutputId.value);
      }

      const count = itemsToDelete.size;
      const confirmed = await simpleModal.value.showModal({
        title: `Delete ${count} Chat${count > 1 ? 's' : ''}`,
        message: `Are you sure you want to delete ${count} selected chat${count > 1 ? 's' : ''}?`,
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      const currentContentId = route.query['content-id'];
      const wasViewingDeleted = (activeOutputId.value && itemsToDelete.has(activeOutputId.value)) ||
        (currentContentId && itemsToDelete.has(currentContentId));

      // Optimistic: remove locally so the sidebar updates immediately.
      // Snapshot the removed rows so we can restore them on failure.
      const idsArray = Array.from(itemsToDelete);
      const removedSnapshot = idsArray
        .map((id) => outputs.value.find((o) => o.id === id))
        .filter(Boolean);
      idsArray.forEach((id) => store.commit('contentOutputs/REMOVE_OUTPUT', id));
      clearSelection();
      if (wasViewingDeleted) {
        router.push('/chat');
        window.dispatchEvent(new CustomEvent('trigger-new-chat'));
      }

      // Fire deletes in parallel; revert any that fail. No "Success" modal —
      // the items vanishing from the list is the confirmation.
      const results = await Promise.allSettled(
        idsArray.map((id) => store.dispatch('contentOutputs/deleteOutput', id)),
      );
      const failed = [];
      results.forEach((res, i) => {
        if (res.status === 'rejected') failed.push(removedSnapshot[i]);
      });
      if (failed.length > 0) {
        console.error('Delete failed for', failed.length, 'output(s)');
        failed.forEach((o) => o && store.commit('contentOutputs/ADD_OUTPUT', o));
        await simpleModal.value.showModal({
          title: 'Error',
          message: `Failed to delete ${failed.length} chat${failed.length > 1 ? 's' : ''}`,
          confirmText: 'OK',
          showCancel: false,
        });
      }
    }

    // Keyboard shortcuts
    function handleKeyDown(event) {
      if (!isSelectionMode.value) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedOutputs();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        clearSelection();
      }
    }

    function setMenuButtonRef(outputId, el) {
      if (el) {
        menuButtonRefs.value[outputId] = el;
      }
    }

    function toggleMenu(outputId, event) {
      if (activeMenu.value === outputId) {
        activeMenu.value = null;
        menuPosition.value = {};
      } else {
        activeMenu.value = outputId;

        // Position the menu next to the button using Teleport
        nextTick(() => {
          const button = event.currentTarget;
          const rect = button.getBoundingClientRect();

          // Calculate position - menu appears to the right of the button
          menuPosition.value = {
            position: 'fixed',
            top: `${rect.top}px`,
            left: `${rect.right + 8}px`,
          };
        });
      }
    }

    async function shareOutput(output) {
      playSound('buttonClick');
      // Create a shareable link
      const shareUrl = `${window.location.origin}/chat?content-id=${output.id}`;

      // Copy to clipboard
      try {
        await navigator.clipboard.writeText(shareUrl);
        await simpleModal.value.showModal({
          title: 'Success',
          message: 'Link copied to clipboard!',
          confirmText: 'OK',
          showCancel: false,
        });
        activeMenu.value = null;
      } catch (err) {
        console.error('Failed to copy:', err);
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Failed to copy link',
          confirmText: 'OK',
          showCancel: false,
        });
      }
    }

    function openInToolForge(output) {
      playSound('buttonClick');
      activeMenu.value = null;
      try {
        // Navigate to Tool Forge with the output ID
        router.push({
          path: '/tool-forge',
          query: {
            'content-id': output.id,
          },
        });
      } catch (error) {
        console.error('Navigation failed:', error);
        window.location.href = `/tool-forge?content-id=${output.id}`;
      }
    }

    async function deleteOutput(outputId) {
      playSound('buttonClick');

      const confirmed = await simpleModal.value.showModal({
        title: 'Delete Chat',
        message: 'Are you sure you want to delete this chat?',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) {
        return;
      }

      const wasActive = activeOutputId.value === outputId || route.query['content-id'] === outputId;
      activeMenu.value = null;

      // Optimistic: snapshot the row, remove from the sidebar immediately,
      // and if we were viewing it, jump to a fresh chat. Fire the DELETE
      // in the background; only surface an error modal if it fails.
      // The item vanishing from the list is the confirmation — no
      // "Success" modal to click through.
      const removedSnapshot = outputs.value.find((o) => o.id === outputId);
      store.commit('contentOutputs/REMOVE_OUTPUT', outputId);
      if (wasActive) {
        router.push('/chat');
        window.dispatchEvent(new CustomEvent('trigger-new-chat'));
      }

      store.dispatch('contentOutputs/deleteOutput', outputId).catch(async (error) => {
        console.error('Error deleting output:', error);
        if (removedSnapshot) store.commit('contentOutputs/ADD_OUTPUT', removedSnapshot);
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Failed to delete chat',
          confirmText: 'OK',
          showCancel: false,
        });
      });
    }

    // Close menu when clicking outside
    function handleClickOutside(event) {
      if (activeMenu.value && !event.target.closest('.output-actions') && !event.target.closest('.action-menu')) {
        activeMenu.value = null;
        showMoveSubmenu.value = false;
      }
      if (groupMenu.value && !event.target.closest('.action-menu')) {
        groupMenu.value = null;
      }
    }

    async function startRename(output) {
      playSound('buttonClick');
      activeMenu.value = null;

      // Get current title
      const currentTitle = getPreviewText(output.content, output);

      // Use SimpleModal with isPrompt for input
      const newTitle = await simpleModal.value.showModal({
        title: 'Rename Chat',
        message: 'Enter a new title for this chat:',
        isPrompt: true,
        defaultValue: currentTitle,
        placeholder: 'Chat title...',
        confirmText: 'Rename',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
      });

      if (!newTitle || newTitle.trim() === '') {
        return;
      }

      const trimmedTitle = newTitle.trim();
      // Optimistic: flip the title locally so the sidebar updates the
      // moment the modal closes. Fire the PATCH in the background; revert
      // and surface an error modal only if the server rejects it. No
      // "Success" modal — the visible title change is the confirmation,
      // and no refreshOutputs — updateConversationTitle patches the
      // outputs list in place.
      const originalTitle = output.title;
      store.commit('contentOutputs/PATCH_OUTPUT', { id: output.id, updates: { title: trimmedTitle } });

      store.dispatch('chat/updateConversationTitle', {
        outputId: output.id,
        title: trimmedTitle,
      }).catch(async (error) => {
        console.error('Error renaming conversation:', error);
        store.commit('contentOutputs/PATCH_OUTPUT', { id: output.id, updates: { title: originalTitle } });
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Failed to rename chat',
          confirmText: 'OK',
          showCancel: false,
        });
      });
    }

    // A conversation was saved — which also covers "a run finished", because
    // completion triggers an autosave. Only the position bump lives here now:
    //
    //   - Data freshness is event-carried — the save response and the
    //     realtime broadcast both deliver the changed row's metadata and the
    //     store merges it in place. The full-list refetch this handler used
    //     to fire (on EVERY autosave, so every ~5s per streaming
    //     conversation) was a fetch storm that starved conversation loads.
    //
    //   - Read state is untouched here: saves never mark read (the email
    //     model — see ContentOutputModel), and read stamps come only from
    //     the user opening a conversation.
    function handleConversationSaved(event) {
      const savedId = event?.detail?.id;
      if (savedId) {
        bumpTimestamps.value = { ...bumpTimestamps.value, [savedId]: Date.now() };
      }
    }

    // Setup lifecycle hooks
    onMounted(async () => {
      if (!hasLoadedAll.value) {
        await fetchSavedOutputs();
      }
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('conversation-saved', handleConversationSaved);
    });

    onBeforeUnmount(() => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('conversation-saved', handleConversationSaved);
    });

    return {
      simpleModal,
      outputs,
      totalCount,
      hasMore,
      hasLoadedAll,
      isFetchingMore,
      searchQuery,
      sortKey,
      sortOrder,
      sortedOutputs,
      activeMenu,
      menuPosition,
      createNewOutput,
      fetchSavedOutputs,
      loadMore,
      loadAll,
      formatDate,
      getPreviewText,
      sortBy,
      getSortIcon,
      navigateToOutput,
      setMenuButtonRef,
      toggleMenu,
      shareOutput,
      openInToolForge,
      deleteOutput,
      startRename,
      handleClickOutside,
      handleNewChat,
      // Multi-select
      selectedOutputIds,
      isSelectionMode,
      selectedCount,
      handleOutputClick,
      isSelected,
      clearSelection,
      deleteSelectedOutputs,
      // Active/current
      activeOutputId,
      isActive,
      // Streaming
      isOutputStreaming,
      // Participants + who is speaking
      participantsFor,
      speakerFor,
      // Unread
      isOutputUnread,
      unreadOutputIds,
      toggleUnread,
      markAllUnreadRead,
      // Attention: unread rollups + archive
      unreadConversations,
      getGroupUnreadBadge,
      archivedList,
      toggleArchived,
      visibleOutputs,
      // Groups
      groups,
      groupTree,
      flatGroupTree,
      allFlatGroups,
      expandedGroups,
      toggleGroup,
      getGroupOutputs,
      ungroupedOutputs,
      allUngroupedOutputs,
      hasMoreUngrouped,
      showMoreUngrouped,
      showAllUngrouped,
      getOutputById,
      getTotalConversationCount,
      showCreateGroup,
      openGroupMenu,
      editGroup,
      deleteGroup,
      groupMenu,
      groupMenuPosition,
      showMoveSubmenu,
      moveMenuExpanded,
      moveMenuFlatGroups,
      toggleMoveMenuGroup,
      moveOutputToGroup,
      // Drag and drop
      onDragStart,
      onGroupDragStart,
      onDragEnd,
      onDragOver,
      onDragLeave,
      onDrop,
      dragOverGroupId,
      draggedGroup,
    };
  },
};
</script>

<style scoped>
.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
  /* margin-bottom: 16px; */
}

.panel-header .title {
  color: var(--color-green);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.card-inner.output-list {
  border: none;
  background: transparent;
}

.panel-stats {
  display: flex;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text);
  font-size: 0.85em;
  opacity: 0.8;
}

.stat-item i {
  width: 14px;
  text-align: center;
}

div#saved-outputs {
  border: none !important;
  height: 100%;
  width: 100%;
  container-type: inline-size;
}

.list-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 16px 0;
  /* No fill: this header sits ON the sidebar panel and is separated by the
     border below. It was var(--color-dull-white), which the light theme remaps
     to var(--color-text) = #4a4a60, so the conversation-list header painted a
     dark band across the top of the sidebar in light mode. */
  background: transparent;
  border-bottom: 1px solid var(--terminal-border-color);
  width: calc(100%);
}

.search-input {
  padding: 8px 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 200px;
  height: 18px;
}

.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px dashed var(--color-duller-navy);
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
  margin-left: auto;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.new-chat-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.new-chat-btn i {
  font-size: 11px;
}

/* Keep the toolbar on one line. Once its own container gets tight, retain the
   familiar plus action and tooltip while dropping only the redundant label. */
@container (max-width: 340px) {
  .new-chat-btn {
    gap: 0;
    padding-inline: 9px;
  }

  .new-chat-label {
    display: none;
  }
}

.sortable-header {
  cursor: pointer;
}

.sortable-header i {
  margin-left: 5px;
}

.list-header {
  background: transparent;
  border-bottom: none;
}

/* .search-input {
  border: 1px solid var(--terminal-border-color);
  background: var(--color-black-navy);
  color: var(--color-text-muted);
} */

.sort-controls {
  display: flex;
  flex-wrap: nowrap;
  justify-content: space-between;
  gap: 8px;
  padding: 0 0 16px;
  /* border-bottom: 1px solid var(--terminal-border-color); */
  /* margin-bottom: 16px; */
}

/* The two sort modes travel together on the left; New Chat keeps the right
   edge, which is what .sort-controls' space-between was always for. */
.sort-modes {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.sort-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.sort-button:hover {
  background: var(--color-darker-1);
  border-color: var(--color-text-muted);
}

.sort-button.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
}

.sort-button.active i {
  opacity: 1;
}

.sort-button i {
  font-size: 11px;
  opacity: 0.7;
}

.output-list-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: visible;
}

.output-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 40px 12px 12px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  /* 200ms was long enough that the highlight visibly lagged behind the
     conversation itself loading — see notes in OutputList.vue. Kept short
     enough to still feel smooth on hover, fast enough to feel instant
     relative to a conversation switch. */
  transition: all 0.05s;
  position: relative;
  overflow: visible;
}

.output-item:hover {
  border-color: var(--color-primary);
  background: var(--color-darker-0);
}

/* THE AVATAR SEPARATOR RING. Overlapping faces need a rim between them or they
   read as one smear at 14px. It is defined in terms of the ROW's own
   background rather than as a colour of its own, so it stays a separator in
   every theme instead of becoming a visible outline in some of them.

   --color-darker-0 is TRANSLUCENT in every theme (rgba, alpha 0.025-0.3), so a
   ring of it over a row already painted with it composites very slightly
   DARKER than the row — which is exactly the rim we want, and why this is the
   right token rather than a solid surface colour. The selected row is tinted,
   so it restates the value with that tint mixed in rather than inheriting a
   rim computed for the untinted background. */
.output-item {
  --avatar-ring: var(--color-darker-0);
}

.output-item.active {
  --avatar-ring: color-mix(in srgb, var(--color-primary) 8%, var(--color-darker-0));
}

.output-content {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.output-actions {
  position: absolute;
  right: 8px;
  top: 12px;
  display: flex;
  align-items: flex-start;
}

.action-menu-btn {
  padding: 4px 8px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  font-size: 14px;
}

.action-menu-btn:hover {
  background: var(--color-darker-1);
  color: var(--color-primary);
}

.action-menu {
  position: fixed;
  margin-top: -14px;
  margin-left: 32px;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  min-width: 180px;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: all 0.2s;
  border-bottom: 1px solid var(--terminal-border-color);
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item:hover {
  background: var(--color-darker-1);
  color: var(--color-text);
}

.menu-item.delete:hover {
  background: rgba(220, 38, 38, 0.1);
  color: var(--color-red);
}

.menu-item i {
  width: 16px;
  text-align: center;
  font-size: 12px;
}

.output-preview {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 500;
  margin-bottom: 2px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.output-date {
  color: var(--color-text-muted);
  font-size: var(--font-size-xxs, 10px);
  opacity: 0.7;
}

.list-container {
  width: 100%;
}

.hide-list {
  display: none;
}

.zero-outputs {
  border-bottom: none !important;
}

.create-new {
  padding: 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.create-output-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-dark-navy);
  transition: opacity 0.2s;
}

.create-output-btn:hover {
  opacity: 0.7;
}

/* body.dark .create-new {
  border-bottom: 1px solid var(--color-dull-navy);
} */

body.dark .create-output-btn {
  color: var(--color-text-muted);
}

/* Pagination Controls */
.pagination-controls {
  margin-top: 24px;
  padding: 16px;
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.pagination-info {
  color: var(--color-text-muted);
  font-size: 13px;
  text-align: center;
}

.pagination-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
}

.pagination-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  flex: 1;
  max-width: 200px;
  justify-content: center;
}

.pagination-btn:hover:not(:disabled) {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination-btn i {
  font-size: 12px;
}

.pagination-btn.load-all {
  border-color: var(--color-blue);
}

.pagination-btn.load-all:hover:not(:disabled) {
  border-color: var(--color-blue);
  color: var(--color-blue);
}

.all-loaded-message {
  margin-top: 16px;
  padding: 8px;
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-primary);
  font-size: var(--font-size-sm);
}

.all-loaded-message i {
  font-size: var(--font-size-sm);
}

/* Empty State Styles */
.no-outputs {
  padding: 24px 12px;
  text-align: center;
}

.no-outputs p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  opacity: 0.7;
}

/* Multi-select styles */
.selection-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--color-darker-1);
  border: 1px solid var(--color-primary);
  border-radius: 8px;
  margin-bottom: 0;
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.selection-info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 600;
}

.selection-info i {
  font-size: 16px;
}

.selection-actions {
  display: flex;
  gap: 8px;
}

.selection-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.selection-btn:hover {
  background: var(--color-darker-1);
}

.selection-btn.delete-btn {
  border-color: var(--color-red);
  color: var(--color-red);
}

.selection-btn.delete-btn:hover {
  background: rgba(239, 68, 68, 0.1);
}

.selection-btn i {
  font-size: 12px;
}

/* Active/current item styling (when viewing) */
.output-item.active {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
}

.output-item.active:hover {
  background: rgba(var(--primary-rgb), 0.12);
}

/* Streaming item styling */
.output-item.streaming {
  border-color: rgba(var(--primary-rgb), 0.35);
}

.output-item.streaming::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 8px;
  padding: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    transparent 35%,
    var(--color-primary) 50%,
    transparent 65%,
    transparent 100%
  );
  background-size: 250% 100%;
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
  animation: shimmer-border 2s linear infinite;
}

@keyframes shimmer-border {
  0% { background-position: 200% 0; }
  100% { background-position: -100% 0; }
}

.streaming-indicator {
  font-size: 0.5em;
  color: var(--color-primary);
  animation: pulse-streaming 1.5s ease-in-out infinite;
  margin-right: 4px;
  vertical-align: middle;
}

.unread-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-green);
  margin-right: 6px;
  vertical-align: middle;
  flex-shrink: 0;
}

@keyframes pulse-streaming {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ===== Unread count + clear-all, on the sort bar =====
   These carry what the retired "Needs you" card contributed: how many are
   waiting, and a way to drain them. The list itself is the card's
   replacement — the Unread sort lifts the same rows to the top. */
.sort-unread-count {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--color-primary);
  /* The count is a count, not a sort affordance: keep it at full strength
     even while the button is inactive and its icon is dimmed. */
  opacity: 1;
}

.mark-all-read-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.mark-all-read-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.12);
}

.mark-all-read-btn i {
  font-size: 11px;
}

/* ===== Group unread rollup badge ===== */
.group-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-unread-badge {
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  text-align: center;
  padding: 1px 5px;
  border-radius: 9px;
  background: var(--color-green);
  color: var(--color-darker-2, #111);
}

/* ===== Archived section ===== */
.archived-section {
  opacity: 0.75;
}

.archived-section:hover {
  opacity: 1;
}

.archived-item .output-preview {
  color: var(--color-text-muted);
}

/* Selected item styling (for batch operations) */
.output-item.selected {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
}

.output-item.selected:hover {
  background: rgba(var(--primary-rgb), 0.12);
}

/* ===== Groups ===== */
.groups-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.create-group-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: 1px dashed var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  margin-bottom: 8px;
}

.create-group-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.create-group-btn i {
  font-size: 13px;
}

.group-section {
  margin-bottom: 4px;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
}

.group-header:hover {
  background: var(--color-darker-1);
}

.group-header[draggable="true"] {
  cursor: grab;
}

.group-header[draggable="true"]:active {
  cursor: grabbing;
}

.group-header.dragging {
  opacity: 0.4;
}

.group-header.drag-over {
  background: rgba(var(--primary-rgb), 0.12);
  outline: 2px dashed var(--color-primary);
  outline-offset: -2px;
}

.group-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.group-chevron {
  font-size: 10px;
  color: var(--color-text-muted);
  width: 12px;
  text-align: center;
  transition: transform 0.15s;
}

.group-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-primary);
}

.group-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ungrouped-icon {
  font-size: 12px;
  color: var(--color-text-muted);
}

.group-count {
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-darker-1);
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.group-items {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.group-items .output-item {
  margin-left: 0;
  min-width: 0;
}

.ungrouped-pagination {
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}

.ungrouped-pagination-info {
  font-size: 12px;
  color: var(--color-text-muted);
}

.ungrouped-pagination-btns {
  display: flex;
  gap: 8px;
}

.group-empty {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  opacity: 0.6;
  font-style: italic;
}

/* Inline submenu for Move to Group */
.submenu-arrow {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.5;
  transition: transform 0.15s;
}

.submenu-inline {
  display: flex;
  flex-direction: column;
  background: var(--color-darker-1);
  border-top: 1px solid var(--terminal-border-color);
  border-bottom: 1px solid var(--terminal-border-color);
}

.submenu-item {
  gap: 8px;
}

.submenu-item.active {
  color: var(--color-primary);
}

.submenu-chevron {
  font-size: 9px;
  width: 10px;
  color: var(--color-text-muted);
}

.submenu-group-name {
  flex: 1;
}

.submenu-move-icon {
  font-size: 10px;
  color: var(--color-text-muted);
  opacity: 0;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.15s;
}

.submenu-item:hover .submenu-move-icon {
  opacity: 1;
}

.submenu-move-icon:hover {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1);
}

.submenu-inline .group-color-dot {
  width: 8px;
  height: 8px;
}

/* Drag state on output items */
.output-item[draggable="true"] {
  cursor: grab;
}

.output-item[draggable="true"]:active {
  cursor: grabbing;
  opacity: 0.6;
}
</style>
