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
      <!-- <div class="create-new" :class="{ 'zero-outputs': outputs.length < 1 }">
        <button @click="createNewOutput" class="icon create-output-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="33" height="32" viewBox="0 0 33 32" fill="none">
            <rect x="0.544922" y="0.5" width="31" height="31" rx="7.5" stroke="#01052A" stroke-opacity="0.25" stroke-dasharray="5 5"></rect>
            <path
              d="M15.1878 16.8571H10.0449V15.1429H15.1878V10H16.9021V15.1429H22.0449V16.8571H16.9021V22H15.1878V16.8571Z"
              fill="#01052A"
              fill-opacity="0.5"
            ></path>
          </svg>
          Create New Output
        </button>
      </div> -->
      <!-- Empty State -->
      <div v-if="outputs.length === 0" class="no-outputs">
        <div class="empty-state">
          <i class="fas fa-file-alt"></i>
          <p>No saved outputs yet</p>
          <button class="create-link" @click="createNewOutput"><i class="fas fa-comments"></i> Create via Chat</button>
        </div>
      </div>

      <div v-else class="list-container">
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
            <button @click="sortBy('created_at')" class="sort-button" :class="{ active: sortKey === 'created_at' }">
              <span>Date</span>
              <i :class="getSortIcon('created_at')"></i>
            </button>
            <!-- <button @click="sortBy('content')" class="sort-button" :class="{ active: sortKey === 'content' }">
              <span>Content</span>
              <i :class="getSortIcon('content')"></i>
            </button> -->
            <Tooltip text="New Chat" width="auto">
              <button @click="handleNewChat" class="new-chat-btn">
                <i class="fas fa-plus"></i>
                <span>New Chat</span>
              </button>
            </Tooltip>
          </div>
          <div class="output-list-items">
            <div
              v-for="output in sortedOutputs"
              :key="output.id"
              class="output-item"
              :class="{ selected: isSelected(output.id), active: isActive(output.id) }"
            >
              <div class="output-content" @click="handleOutputClick(output.id, $event)">
                <div class="output-date">
                  {{ formatDate(output.created_at) }}
                </div>
                <div class="output-preview">{{ getPreviewText(output.content, output) }}</div>
              </div>
              <div class="output-actions">
                <button class="action-menu-btn" @click.stop="toggleMenu(output.id, $event)" :ref="(el) => setMenuButtonRef(output.id, el)">
                  <i class="fas fa-ellipsis-v"></i>
                </button>
              </div>
              <Teleport to="body">
                <div v-if="activeMenu === output.id" class="action-menu" @click.stop :style="menuPosition">
                  <button @click="startRename(output)" class="menu-item">
                    <i class="fas fa-edit"></i>
                    <span>Rename</span>
                  </button>
                  <!-- <button @click="shareOutput(output)" class="menu-item">
                    <i class="fas fa-share-alt"></i>
                    <span>Share</span>
                  </button> -->
                  <!-- <button @click="openInToolForge(output)" class="menu-item">
                    <i class="fas fa-tools"></i>
                    <span>Open in Tool Forge</span>
                  </button> -->
                  <button @click="deleteOutput(output.id)" class="menu-item delete">
                    <i class="fas fa-trash"></i>
                    <span>Delete</span>
                  </button>
                </div>
              </Teleport>
            </div>
          </div>

          <!-- Pagination Controls -->
          <div v-if="hasMore && !hasLoadedAll" class="pagination-controls">
            <div class="pagination-info">Showing {{ outputs.length }} of {{ totalCount }} outputs</div>
            <div class="pagination-buttons">
              <button @click="loadMore" :disabled="isFetchingMore" class="pagination-btn load-more">
                <i v-if="isFetchingMore" class="fas fa-spinner fa-spin"></i>
                <i v-else class="fas fa-arrow-down"></i>
                <span>{{ isFetchingMore ? 'Loading...' : 'Load More (20)' }}</span>
              </button>
              <button @click="loadAll" :disabled="isFetchingMore" class="pagination-btn load-all">
                <i v-if="isFetchingMore" class="fas fa-spinner fa-spin"></i>
                <i v-else class="fas fa-list"></i>
                <span>{{ isFetchingMore ? 'Loading...' : 'Load All' }}</span>
              </button>
            </div>
          </div>

          <!-- All Loaded Message -->
          <div v-else-if="hasLoadedAll && outputs.length > 0" class="all-loaded-message">
            <i class="fas fa-check-circle"></i>
            <span>All {{ totalCount }} outputs loaded</span>
          </div>
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
    const sortKey = ref('created_at');
    const sortOrder = ref('desc');
    const activeMenu = ref(null);
    const menuPosition = ref({});
    const menuButtonRefs = ref({});

    // Multi-select state
    const selectedOutputIds = ref(new Set());
    const lastSelectedId = ref(null);

    // Active/current conversation (the one being viewed)
    const activeOutputId = ref(null);

    // Get outputs from store
    const outputs = computed(() => store.getters['contentOutputs/outputs']);
    const totalCount = computed(() => store.getters['contentOutputs/totalCount']);
    const hasMore = computed(() => store.getters['contentOutputs/hasMore']);
    const hasLoadedAll = computed(() => store.getters['contentOutputs/hasLoadedAll']);
    const isFetchingMore = computed(() => store.getters['contentOutputs/isFetching']);

    // Multi-select computed
    const isSelectionMode = computed(() => selectedOutputIds.value.size > 0);
    const selectedCount = computed(() => selectedOutputIds.value.size);

    const sortedOutputs = computed(() => {
      return outputs.value
        .filter((output) => {
          if (!searchQuery.value) return true;

          const query = searchQuery.value.toLowerCase();

          // Search against title only (no JSON.parse or DOM creation on every keystroke)
          const title = getPreviewText(output.content, output).toLowerCase();
          return title.includes(query);
        })
        .sort((a, b) => {
          let aValue = sortKey.value === 'content' ? getPreviewText(a.content, a) : a[sortKey.value];
          let bValue = sortKey.value === 'content' ? getPreviewText(b.content, b) : b[sortKey.value];

          if (aValue < bValue) return sortOrder.value === 'asc' ? -1 : 1;
          if (aValue > bValue) return sortOrder.value === 'asc' ? 1 : -1;
          return 0;
        });
    });

    function createNewOutput() {
      try {
        router.push('/chat');
      } catch (error) {
        console.error('Navigation failed:', error);
        // Fallback for navigation failure
        window.location.href = '/chat';
      }
    }

    function handleNewChat() {
      playSound('buttonClick');
      // Navigate to chat screen without query params
      router.push('/chat');
      // Dispatch event to trigger full clear and re-initialization in Chat.vue
      window.dispatchEvent(new CustomEvent('trigger-new-chat'));
    }

    async function fetchSavedOutputs() {
      // Use store action instead of direct API call - fetch initial 20
      // Caching is now handled in the store (pre-fetched in state.js)
      await store.dispatch('contentOutputs/fetchOutputs', { limit: 20, offset: 0 });
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
      if (activeMenu.value && !event.target.closest('.output-actions')) {
        activeMenu.value = null;
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
    onMounted(() => {
      // Only fetch if store is empty (initializeStore pre-loads outputs in Phase 2)
      if (outputs.value.length === 0) {
        fetchSavedOutputs();
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
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  color: #ffffff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  margin-left: auto;
  transition: all 0.2s;
}

.new-chat-btn:hover {
  background: transparent;
  color: var(--color-primary);
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
  border-color: var(--color-primary);
}

.sort-button.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
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
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  /* min-height: 300px; */
  padding: 40px 20px;
}

.empty-state {
  text-align: center;
  color: var(--color-text-muted);
}

.empty-state i {
  font-size: 2em;
  margin-bottom: 8px;
  display: block;
  opacity: 0.5;
}

.empty-state p {
  margin: 0 0 12px 0;
  font-size: 0.9em;
}

.create-link {
  background: var(--color-primary);
  color: var(--color-white);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.2s ease;
}

.create-link:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
}

.create-link i {
  margin-right: 4px;
  font-size: 0.9em;
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

/* Selected item styling (for batch operations) */
.output-item.selected {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.08);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
}

.output-item.selected:hover {
  background: rgba(var(--primary-rgb), 0.12);
}
</style>
