<template>
  <div class="output-list-container">
    <SimpleModal ref="simpleModal" />
    <div class="panel-header">
      <h2 class="title">/ Saved Outputs</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-file-alt"></i>
          {{ outputs.length }}
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
          <input v-model="searchQuery" type="text" placeholder="Search outputs..." class="search-input" />
        </div>
        <div id="saved-outputs" class="saved-items">
          <div class="sort-controls">
            <button @click="sortBy('updated_at')" class="sort-button" :class="{ active: sortKey === 'updated_at' }">
              <span>Date</span>
              <i :class="getSortIcon('updated_at')"></i>
            </button>
            <Tooltip text="New Chat" width="auto">
              <button @click="handleNewChat" class="new-chat-btn">
                <i class="fas fa-plus"></i>
                <span>New Chat</span>
              </button>
            </Tooltip>
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
                  <span class="group-count">{{ searchQuery ? getGroupOutputs(node.id).length : getTotalConversationCount(node.id) }}</span>
                </div>
                <div v-if="expandedGroups.has(node.id)" class="group-items">
                  <div v-if="getGroupOutputs(node.id).length === 0 && !node.hasChildren" class="group-empty">
                    <span>No conversations</span>
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
                      <div class="output-date">
                        <i v-if="isOutputStreaming(output.id)" class="fas fa-circle streaming-indicator"></i>
                        {{ formatDate(output.updated_at || output.created_at) }}
                      </div>
                      <div class="output-preview">{{ getPreviewText(output.content, output) }}</div>
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
                    <div class="output-date">
                      <i v-if="isOutputStreaming(output.id)" class="fas fa-circle streaming-indicator"></i>
                      {{ formatDate(output.updated_at || output.created_at) }}
                    </div>
                    <div class="output-preview">{{ getPreviewText(output.content, output) }}</div>
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
              <div v-if="outputs.length === 0" class="no-outputs">
                <p>No saved outputs yet. Start a chat to create one.</p>
              </div>
              <div
                v-for="output in sortedOutputs"
                :key="output.id"
                class="output-item"
                :class="{ selected: isSelected(output.id), active: isActive(output.id), streaming: isOutputStreaming(output.id) }"
              >
                <div class="output-content" @click="handleOutputClick(output.id, $event)">
                  <div class="output-date">
                    <i v-if="isOutputStreaming(output.id)" class="fas fa-circle streaming-indicator"></i>
                    {{ formatDate(output.updated_at || output.created_at) }}
                  </div>
                  <div class="output-preview">{{ getPreviewText(output.content, output) }}</div>
                </div>
                <div class="output-actions">
                  <button class="action-menu-btn" @click.stop="toggleMenu(output.id, $event)" :ref="(el) => setMenuButtonRef(output.id, el)">
                    <i class="fas fa-ellipsis-v"></i>
                  </button>
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
                    <i v-if="node.hasChildren" class="fas fa-arrow-right submenu-move-icon" @click.stop="moveOutputToGroup(activeMenu, node.id)" title="Move here"></i>
                  </button>
                </template>
                <button @click="moveOutputToGroup(activeMenu, null)" class="menu-item submenu-item" :class="{ active: !getOutputById(activeMenu)?.group_id }">
                  <i class="fas fa-inbox"></i>
                  <span>Ungrouped</span>
                </button>
              </div>
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
import { ref, computed, nextTick, onMounted, onBeforeUnmount, inject } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'OutputList',
  components: {
    SimpleModal,
    Tooltip,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const simpleModal = ref(null);
    const searchQuery = ref('');
    const sortKey = ref('updated_at');
    const sortOrder = ref('desc');
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

    // Active/current conversation (the one being viewed)
    const activeOutputId = ref(null);

    // Streaming output IDs from the chat store
    const streamingOutputIds = computed(() => store.getters['chat/streamingOutputIds'] || new Set());

    // Get outputs from store
    const outputs = computed(() => store.getters['contentOutputs/outputs']);
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

    // Filter + sort helper
    function filterAndSort(list) {
      return list
        .filter((output) => {
          if (!searchQuery.value) return true;
          const title = getPreviewText(output.content, output).toLowerCase();
          return title.includes(searchQuery.value.toLowerCase());
        })
        .sort((a, b) => {
          let aValue;
          let bValue;
          if (sortKey.value === 'content') {
            aValue = getPreviewText(a.content, a);
            bValue = getPreviewText(b.content, b);
          } else if (sortKey.value === 'updated_at' || sortKey.value === 'created_at') {
            // Sort by updated_at if present, fall back to created_at for legacy rows.
            // Compare as numbers so Date objects and ISO strings both work.
            const aDate = a.updated_at || a.created_at;
            const bDate = b.updated_at || b.created_at;
            aValue = aDate ? new Date(aDate).getTime() : 0;
            bValue = bDate ? new Date(bDate).getTime() : 0;
          } else {
            aValue = a[sortKey.value];
            bValue = b[sortKey.value];
          }
          if (aValue < bValue) return sortOrder.value === 'asc' ? -1 : 1;
          if (aValue > bValue) return sortOrder.value === 'asc' ? 1 : -1;
          return 0;
        });
    }

    const sortedOutputs = computed(() => filterAndSort(outputs.value));

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

    // Total conversation count including all descendants
    function getTotalConversationCount(groupId) {
      const ids = getDescendantIds(groupId);
      return outputs.value.filter((o) => ids.has(o.group_id)).length;
    }

    // Get outputs belonging to a specific group
    // When searching, include conversations from all descendant groups
    function getGroupOutputs(groupId) {
      if (searchQuery.value) {
        const ids = getDescendantIds(groupId);
        return filterAndSort(outputs.value.filter((o) => ids.has(o.group_id)));
      }
      return filterAndSort(outputs.value.filter((o) => o.group_id === groupId));
    }

    // Ungrouped display limit
    const ungroupedDisplayLimit = ref(20);

    // All ungrouped outputs (full list)
    const allUngroupedOutputs = computed(() => {
      return filterAndSort(outputs.value.filter((o) => !o.group_id));
    });

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

        try {
          await store.dispatch('groups/updateGroup', { id: group.id, parent_id: groupId || null });
          // Expand the target so the moved group is visible
          if (groupId) {
            const next = new Set(expandedGroups.value);
            next.add(groupId);
            expandedGroups.value = next;
          }
          store.dispatch('groups/fetchGroups', { force: true });
        } catch (error) {
          console.error('Error reparenting group:', error);
        }
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

      try {
        if (filteredIds.length === 1) {
          await store.dispatch('groups/moveToGroup', { outputId: filteredIds[0], groupId });
          const o = getOutputById(filteredIds[0]);
          if (o) o.group_id = groupId;
        } else {
          await store.dispatch('groups/bulkMoveToGroup', { outputIds: filteredIds, groupId });
          filteredIds.forEach((id) => {
            const o = getOutputById(id);
            if (o) o.group_id = groupId;
          });
        }
        clearSelection();
        store.dispatch('groups/fetchGroups', { force: true });
      } catch (error) {
        console.error('Error moving output(s):', error);
      }
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
        ? 'Delete this group AND all sub-groups? Conversations will be moved to Ungrouped.'
        : 'Delete this group? Sub-groups will be moved up and conversations will be ungrouped.';

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
        message: 'Your current conversation will be saved. You can pick it back up anytime from your saved chats.',
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

    function formatDate(date) {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
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
      if (sortKey.value === key) {
        sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey.value = key;
        sortOrder.value = 'asc';
      }
    }

    function getSortIcon(key) {
      if (sortKey.value !== key) return 'fas fa-sort';
      return sortOrder.value === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
    }

    function navigateToOutput(outputId) {
      playSound('buttonClick');
      activeOutputId.value = outputId; // Highlight the current conversation
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
        title: `Delete ${count} Conversation${count > 1 ? 's' : ''}`,
        message: `Are you sure you want to delete ${count} selected conversation${count > 1 ? 's' : ''}?`,
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      const currentContentId = route.query['content-id'];
      const wasViewingDeleted = (activeOutputId.value && itemsToDelete.has(activeOutputId.value)) ||
        (currentContentId && itemsToDelete.has(currentContentId));

      try {
        // Delete all highlighted outputs in parallel
        await Promise.all(Array.from(itemsToDelete).map((id) => store.dispatch('contentOutputs/deleteOutput', id)));

        clearSelection();
        activeOutputId.value = null;

        // If the currently viewed chat was among the deleted, reset to fresh chat
        if (wasViewingDeleted) {
          router.push('/chat');
          window.dispatchEvent(new CustomEvent('trigger-new-chat'));
        }

        await simpleModal.value.showModal({
          title: 'Success',
          message: `${count} conversation${count > 1 ? 's' : ''} deleted successfully`,
          confirmText: 'OK',
          showCancel: false,
        });
      } catch (error) {
        console.error('Error deleting outputs:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Failed to delete some conversations',
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
        title: 'Delete Output',
        message: 'Are you sure you want to delete this output?',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) {
        return;
      }

      const wasActive = activeOutputId.value === outputId || route.query['content-id'] === outputId;

      try {
        await store.dispatch('contentOutputs/deleteOutput', outputId);
        activeMenu.value = null;

        // If the deleted output was the currently viewed chat, reset to fresh chat
        if (wasActive) {
          activeOutputId.value = null;
          router.push('/chat');
          window.dispatchEvent(new CustomEvent('trigger-new-chat'));
        }

        await simpleModal.value.showModal({
          title: 'Success',
          message: 'Output deleted successfully',
          confirmText: 'OK',
          showCancel: false,
        });
      } catch (error) {
        console.error('Error deleting output:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Failed to delete output',
          confirmText: 'OK',
          showCancel: false,
        });
      }
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
        title: 'Rename Conversation',
        message: 'Enter a new title for this conversation:',
        isPrompt: true,
        defaultValue: currentTitle,
        placeholder: 'Conversation title...',
        confirmText: 'Rename',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
      });

      if (!newTitle || newTitle.trim() === '') {
        return;
      }

      try {
        // Call Vuex action to rename
        await store.dispatch('chat/updateConversationTitle', {
          outputId: output.id,
          title: newTitle.trim(),
        });

        // Refresh the outputs list
        await store.dispatch('contentOutputs/refreshOutputs');

        await simpleModal.value.showModal({
          title: 'Success',
          message: 'Conversation renamed successfully',
          confirmText: 'OK',
          showCancel: false,
        });
      } catch (error) {
        console.error('Error renaming conversation:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Failed to rename conversation',
          confirmText: 'OK',
          showCancel: false,
        });
      }
    }

    // Handle conversation saved event
    function handleConversationSaved() {
      // Refresh the outputs list when a conversation is saved
      store.dispatch('contentOutputs/refreshOutputs');
    }

    // Handle conversation renamed event
    function handleConversationRenamed() {
      // Refresh the outputs list when a conversation is renamed
      store.dispatch('contentOutputs/refreshOutputs');
    }

    // Handle chat cleared event
    function handleChatCleared() {
      // Clear the active output when chat is cleared
      activeOutputId.value = null;
    }

    // Setup lifecycle hooks
    onMounted(async () => {
      if (!hasLoadedAll.value) {
        await fetchSavedOutputs();
      }
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('conversation-saved', handleConversationSaved);
      window.addEventListener('conversation-renamed', handleConversationRenamed);
      window.addEventListener('chat-cleared', handleChatCleared);
    });

    onBeforeUnmount(() => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('conversation-saved', handleConversationSaved);
      window.removeEventListener('conversation-renamed', handleConversationRenamed);
      window.removeEventListener('chat-cleared', handleChatCleared);
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
}

.list-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 16px 0;
  background: var(--color-dull-white);
  border-bottom: 1px solid var(--color-light-navy);
  width: calc(100%);
}

.search-input {
  padding: 8px 16px;
  border: 1px solid var(--color-light-navy);
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
  justify-content: space-between;
  gap: 8px;
  padding: 0 0 16px;
  /* border-bottom: 1px solid var(--terminal-border-color); */
  /* margin-bottom: 16px; */
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
  border-color: var(--terminal-border-color);
  color: var(--color-text-muted);
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
  transition: all 0.2s;
  position: relative;
  overflow: visible;
}

.output-item:hover {
  border-color: var(--color-primary);
  background: var(--color-darker-0);
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

.output-date {
  margin-bottom: 6px;
}

.output-date {
  color: var(--color-text);
  font-size: var(--font-size-xs);
}

.output-preview {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  border-bottom: 1px solid var(--color-light-navy);
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
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
}

.output-item.active:hover {
  background: rgba(var(--primary-rgb), 0.12);
}

/* Streaming item styling */
.output-item.streaming {
  border-color: var(--color-primary);
}

.streaming-indicator {
  font-size: 0.5em;
  color: var(--color-primary);
  animation: pulse-streaming 1.5s ease-in-out infinite;
  margin-right: 4px;
  vertical-align: middle;
}

@keyframes pulse-streaming {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Selected item styling (for batch operations) */
.output-item.selected {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
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
