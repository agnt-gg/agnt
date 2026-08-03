<template>
  <div class="resources-section">
    <SimpleModal ref="simpleModal" />
    <h4 class="section-title">RESOURCES</h4>

    <div class="resource-links">
      <a href="https://agnt.gg/docs" target="_blank" rel="noopener noreferrer" class="resource-link">
        <i class="fas fa-book"></i>
        <span>Docs</span>
      </a>
      <a href="https://github.com/agnt-gg/agnt" target="_blank" rel="noopener noreferrer" class="resource-link">
        <i class="fab fa-github"></i>
        <span>GitHub</span>
      </a>
      <a href="https://discord.com/invite/nwXJMnHmXP" target="_blank" rel="noopener noreferrer" class="resource-link">
        <i class="fab fa-discord"></i>
        <span>Discord</span>
      </a>
      <button @click="openBoard" class="resource-link resource-button">
        <i class="fas fa-comment-dots"></i>
        <span>Feedback</span>
      </button>
    </div>

    <!-- Feedback Board Modal (teleported to body so position:fixed is viewport-relative,
         not clamped by a transformed right-panel ancestor) -->
    <Teleport to="body">
      <div v-if="showFeedbackModal" class="modal-overlay" @click.self="closeBoard">
        <div class="modal-content feedback-board">
          <!-- ============ BOARD VIEW ============ -->
          <template v-if="view === 'board'">
            <div class="modal-header">
              <h3>Community Feedback</h3>
              <button class="close-btn" @click="closeBoard">
                <i class="fas fa-times"></i>
              </button>
            </div>

            <div class="board-toolbar">
              <button class="btn btn-primary btn-compact" @click="openSubmitForm"><i class="fas fa-plus"></i> Submit New</button>
              <BaseSelect
                v-model="filterValue"
                :options="filterOptions"
                placeholder="All"
                selectClass="board-base-select"
                @update:modelValue="reloadItems"
              />
              <BaseSelect v-model="sortValue" :options="sortOptions" selectClass="board-base-select" @update:modelValue="reloadItems" />
            </div>

            <div class="board-list">
              <div v-if="isLoading && items.length === 0" class="board-empty">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Loading feedback...</span>
              </div>

              <div v-else-if="loadError" class="board-empty">
                <i class="fas fa-exclamation-triangle"></i>
                <span>{{ loadError }}</span>
                <button class="btn btn-secondary btn-compact" @click="reloadItems">Retry</button>
              </div>

              <div v-else-if="items.length === 0" class="board-empty">
                <i class="fas fa-inbox"></i>
                <span>No feedback yet. Be the first to share an idea!</span>
              </div>

              <div v-for="item in items" :key="item.id" class="feedback-item" :class="{ expanded: expandedId === item.id }">
                <div class="item-main">
                  <div class="vote-column">
                    <button
                      class="vote-btn"
                      :class="{ active: item.my_vote === 'up' }"
                      :disabled="votingId === item.id"
                      v-tooltip="'Upvote'"
                      @click.stop="castVote(item, 'up')"
                    >
                      <i class="fas fa-chevron-up"></i>
                    </button>
                    <span class="vote-count" :class="netVoteClass(item)">{{ item.upvotes - item.downvotes }}</span>
                    <button
                      class="vote-btn"
                      :class="{ active: item.my_vote === 'down' }"
                      :disabled="votingId === item.id"
                      v-tooltip="'Downvote'"
                      @click.stop="castVote(item, 'down')"
                    >
                      <i class="fas fa-chevron-down"></i>
                    </button>
                  </div>

                  <div class="item-body" @click="toggleExpand(item)">
                    <div class="item-title-row">
                      <i :class="typeIcon(item.type)" class="type-icon"></i>
                      <span class="item-title">{{ item.title }}</span>
                    </div>
                    <div class="item-meta-row">
                      <span class="status-pill" :class="'status-' + item.status">{{ statusLabel(item.status) }}</span>
                      <span class="item-meta">{{ item.user_name || 'Anonymous' }} · {{ timeAgo(item.created_at) }}</span>
                      <i v-if="item.has_screenshot" class="fas fa-image meta-icon" v-tooltip="'Has screenshot'"></i>
                      <i v-if="item.admin_response" class="fas fa-reply meta-icon" v-tooltip="'Has official response'"></i>
                    </div>
                  </div>
                </div>

                <div v-if="expandedId === item.id" class="item-detail" @click.stop>
                  <p v-if="item.description" class="item-description">{{ item.description }}</p>
                  <p v-else class="item-description muted">No additional details provided.</p>

                  <div v-if="detailLoadingId === item.id" class="detail-loading"><i class="fas fa-spinner fa-spin"></i> Loading screenshot...</div>
                  <img v-else-if="item.screenshot_data" :src="item.screenshot_data" class="item-screenshot" alt="Attached screenshot" />

                  <div v-if="item.admin_response" class="admin-response">
                    <div class="admin-response-header"><i class="fas fa-shield-alt"></i> Official Response</div>
                    <p>{{ item.admin_response }}</p>
                  </div>

                  <!-- Admin controls -->
                  <div v-if="isAdmin" class="admin-controls">
                    <BaseSelect v-model="adminStatus" :options="statusOptions" selectClass="board-base-select" />
                    <input v-model="adminResponseText" class="admin-response-input" placeholder="Official response (optional)..." />
                    <button class="btn btn-primary btn-compact" :disabled="isSavingAdmin" @click="saveAdminUpdate(item)">
                      {{ isSavingAdmin ? 'Saving...' : 'Save' }}
                    </button>
                  </div>
                </div>
              </div>

              <button v-if="!isLoading && items.length > 0 && items.length < total" class="btn btn-secondary load-more-btn" @click="loadMore">
                Load More ({{ items.length }} of {{ total }})
              </button>
            </div>
          </template>

          <!-- ============ SUBMIT VIEW ============ -->
          <template v-else>
            <div class="modal-header">
              <h3>Submit Feedback</h3>
              <button class="close-btn" @click="view = 'board'">
                <i class="fas fa-times"></i>
              </button>
            </div>

            <div class="modal-body">
              <BaseSelect v-model="form.type" :options="typeOptions" selectClass="board-base-select" />

              <input v-model="form.title" class="form-input" maxlength="200" placeholder="Short summary (e.g. 'Add dark mode to workflow editor')" />

              <textarea
                v-model="form.description"
                placeholder="Describe your idea or the bug you hit — steps to reproduce, expected behavior, etc."
                rows="5"
                class="feedback-textarea"
              ></textarea>

              <div class="image-upload-section">
                <label class="upload-label">
                  <i class="fas fa-image"></i>
                  <span>{{ uploadedImage ? 'Change Screenshot' : 'Attach Screenshot (Optional)' }}</span>
                  <input type="file" accept="image/*" class="file-input" @change="handleImageUpload" />
                </label>
                <div v-if="imagePreview" class="image-preview">
                  <img :src="imagePreview" alt="Screenshot preview" />
                  <button class="remove-image-btn" @click="removeImage" v-tooltip="'Remove screenshot'">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn btn-secondary" @click="view = 'board'">Cancel</button>
              <button class="btn btn-primary" :disabled="!canSubmit || isSubmitting" @click="submitItem">
                {{ isSubmitting ? 'Submitting...' : 'Submit' }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { ref, reactive, computed } from 'vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import { API_CONFIG } from '@/tt.config.js';

const STATUS_LABELS = {
  open: 'Open',
  planned: 'Planned',
  in_progress: 'In Progress',
  completed: 'Completed',
  declined: 'Declined',
  duplicate: 'Duplicate',
};

const TYPE_ICONS = {
  feature_request: 'fas fa-lightbulb',
  bug_report: 'fas fa-bug',
  improvement: 'fas fa-wrench',
  other: 'fas fa-comment',
};

const PAGE_SIZE = 50;

export default {
  name: 'ResourcesSection',
  components: {
    SimpleModal,
    BaseSelect,
  },
  setup() {
    const simpleModal = ref(null);

    // Board state
    const showFeedbackModal = ref(false);
    const view = ref('board'); // 'board' | 'submit'
    const items = ref([]);
    const total = ref(0);
    const isAdmin = ref(false);
    const isLoading = ref(false);
    const loadError = ref('');
    const filterValue = ref('');
    const sortValue = ref('top');
    const expandedId = ref(null);
    const detailLoadingId = ref(null);
    const votingId = ref(null);

    // Admin state
    const adminStatus = ref('open');
    const adminResponseText = ref('');
    const isSavingAdmin = ref(false);

    // Submit form state
    const form = reactive({ type: 'feature_request', title: '', description: '' });
    const isSubmitting = ref(false);
    const uploadedImage = ref(null);
    const imagePreview = ref('');

    const canSubmit = computed(() => form.title.trim().length >= 3);
    const allStatuses = Object.keys(STATUS_LABELS);

    // BaseSelect option lists ({ value, label }) — uses the shared custom select component
    const filterOptions = [
      { value: '', label: 'All' },
      { value: 'feature_request', label: 'Features' },
      { value: 'bug_report', label: 'Bugs' },
      { value: 'improvement', label: 'Improvements' },
      { value: 'other', label: 'Other' },
      { value: 'mine', label: 'My Submissions' },
    ];
    const sortOptions = [
      { value: 'top', label: 'Top' },
      { value: 'new', label: 'Newest' },
      { value: 'old', label: 'Oldest' },
    ];
    const statusOptions = allStatuses.map((s) => ({ value: s, label: STATUS_LABELS[s] }));
    const typeOptions = [
      { value: 'feature_request', label: '✨ Feature Request' },
      { value: 'bug_report', label: '🐛 Bug Report' },
      { value: 'improvement', label: '🔧 Improvement' },
      { value: 'other', label: '💬 Other' },
    ];

    const authHeaders = () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`,
    });

    const buildListUrl = (offset) => {
      const params = new URLSearchParams({ sort: sortValue.value, limit: PAGE_SIZE, offset });
      if (filterValue.value === 'mine') params.set('mine', 'true');
      else if (filterValue.value) params.set('type', filterValue.value);
      return `${API_CONFIG.REMOTE_URL}/feedback?${params}`;
    };

    const fetchItems = async (offset = 0) => {
      isLoading.value = true;
      loadError.value = '';
      try {
        const response = await fetch(buildListUrl(offset), { headers: authHeaders() });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load feedback');

        if (offset === 0) items.value = data.items;
        else items.value = [...items.value, ...data.items];
        total.value = data.total;
        isAdmin.value = Boolean(data.isAdmin);
      } catch (error) {
        console.error('Error loading feedback board:', error);
        loadError.value = error.message || 'Failed to load feedback';
      } finally {
        isLoading.value = false;
      }
    };

    const openBoard = () => {
      showFeedbackModal.value = true;
      view.value = 'board';
      expandedId.value = null;
      fetchItems(0);
    };

    const closeBoard = () => {
      showFeedbackModal.value = false;
    };

    const reloadItems = () => {
      expandedId.value = null;
      fetchItems(0);
    };

    const loadMore = () => fetchItems(items.value.length);

    const toggleExpand = async (item) => {
      if (expandedId.value === item.id) {
        expandedId.value = null;
        return;
      }
      expandedId.value = item.id;
      adminStatus.value = item.status;
      adminResponseText.value = item.admin_response || '';

      // Lazy-load screenshot on first expand
      if (item.has_screenshot && !item.screenshot_data) {
        detailLoadingId.value = item.id;
        try {
          const response = await fetch(`${API_CONFIG.REMOTE_URL}/feedback/${item.id}`, { headers: authHeaders() });
          const data = await response.json();
          if (data.success && data.item?.screenshot) {
            item.screenshot_data = data.item.screenshot;
          }
        } catch (error) {
          console.error('Error loading feedback detail:', error);
        } finally {
          detailLoadingId.value = null;
        }
      }
    };

    const castVote = async (item, voteType) => {
      votingId.value = item.id;
      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/feedback/${item.id}/vote`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ vote_type: voteType }),
        });
        const data = await response.json();
        if (data.success) {
          item.upvotes = data.upvotes;
          item.downvotes = data.downvotes;
          item.my_vote = data.my_vote;
        }
      } catch (error) {
        console.error('Error voting:', error);
      } finally {
        votingId.value = null;
      }
    };

    const saveAdminUpdate = async (item) => {
      isSavingAdmin.value = true;
      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/feedback/${item.id}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({
            status: adminStatus.value,
            admin_response: adminResponseText.value.trim() || null,
          }),
        });
        const data = await response.json();
        if (data.success) {
          item.status = data.item.status;
          item.admin_response = data.item.admin_response;
        } else {
          throw new Error(data.error || 'Update failed');
        }
      } catch (error) {
        console.error('Error updating feedback item:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: `❌ ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
        });
      } finally {
        isSavingAdmin.value = false;
      }
    };

    const openSubmitForm = () => {
      form.type = 'feature_request';
      form.title = '';
      form.description = '';
      uploadedImage.value = null;
      imagePreview.value = '';
      view.value = 'submit';
    };

    const handleImageUpload = (event) => {
      const file = event.target.files[0];
      if (file && file.type.startsWith('image/')) {
        uploadedImage.value = file;
        const reader = new FileReader();
        reader.onload = (e) => {
          imagePreview.value = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    };

    const removeImage = () => {
      uploadedImage.value = null;
      imagePreview.value = '';
    };

    const submitItem = async () => {
      if (!canSubmit.value) return;
      isSubmitting.value = true;
      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/feedback`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            type: form.type,
            title: form.title.trim(),
            description: form.description.trim() || null,
            screenshot: uploadedImage.value ? imagePreview.value : null,
          }),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to submit feedback');

        view.value = 'board';
        sortValue.value = 'new';
        await fetchItems(0);

        await simpleModal.value.showModal({
          title: 'Feedback Submitted',
          message: '✅ Thank you! Your feedback is now on the board for the community to vote on.',
          confirmText: 'OK',
          showCancel: false,
        });
      } catch (error) {
        console.error('Error submitting feedback:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: `❌ ${error.message || 'Error submitting feedback. Please try again.'}`,
          confirmText: 'OK',
          showCancel: false,
        });
      } finally {
        isSubmitting.value = false;
      }
    };

    // Display helpers
    const statusLabel = (status) => STATUS_LABELS[status] || status;
    const typeIcon = (type) => TYPE_ICONS[type] || TYPE_ICONS.other;
    const netVoteClass = (item) => {
      const net = item.upvotes - item.downvotes;
      return net > 0 ? 'positive' : net < 0 ? 'negative' : '';
    };

    const timeAgo = (dateString) => {
      // SQLite CURRENT_TIMESTAMP is UTC without timezone suffix
      const date = new Date(dateString.includes('T') ? dateString : dateString.replace(' ', 'T') + 'Z');
      const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `${days}d ago`;
      const months = Math.floor(days / 30);
      if (months < 12) return `${months}mo ago`;
      return `${Math.floor(months / 12)}y ago`;
    };

    return {
      simpleModal,
      showFeedbackModal,
      view,
      items,
      total,
      isAdmin,
      isLoading,
      loadError,
      filterValue,
      sortValue,
      expandedId,
      detailLoadingId,
      votingId,
      adminStatus,
      adminResponseText,
      isSavingAdmin,
      allStatuses,
      filterOptions,
      sortOptions,
      statusOptions,
      typeOptions,
      form,
      isSubmitting,
      uploadedImage,
      imagePreview,
      canSubmit,
      openBoard,
      closeBoard,
      reloadItems,
      loadMore,
      toggleExpand,
      castVote,
      saveAdminUpdate,
      openSubmitForm,
      handleImageUpload,
      removeImage,
      submitItem,
      statusLabel,
      typeIcon,
      netVoteClass,
      timeAgo,
    };
  },
};
</script>

<style scoped>
.resources-section {
  margin-top: auto;
  padding-top: 16px;
  flex-shrink: 0;
}

.section-title {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-text-muted);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: var(--font-family-primary);
}

/* Resource Links */
.resource-links {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.resource-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: all 0.2s ease;
  font-size: 0.9em;
}

body.dark .resource-link {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

body:not(.dark):not(.rose) button.resource-link.resource-button {
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}

.resource-link i {
  color: var(--color-text);
  font-size: 1.1em;
}

.resource-link:hover,
body:not(.dark):not(.rose) button.resource-link.resource-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  transform: translateY(-2px);
}

.resource-button {
  cursor: pointer;
  font-family: inherit;
  width: 100%;
  text-align: left;
  background: transparent;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.modal-content {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}

.modal-content.feedback-board {
  max-width: 640px;
  height: min(720px, 90vh);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 20px;
  flex-shrink: 0;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.3em;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 1.5em;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-primary);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Board Toolbar */
.board-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* BaseSelect (shared custom select) sizing inside the board.
   BaseSelect wraps its control in .form-field — strip its default block layout
   so the selects sit inline in the toolbar and fill their containers elsewhere. */
.board-toolbar :deep(.form-field) {
  margin: 0;
  flex: 1;
  min-width: 0;
}

.modal-body > :deep(.form-field) {
  margin: 0;
}

.admin-controls :deep(.form-field) {
  margin: 0;
  flex: 1;
  min-width: 140px;
}

/* Board List */
.board-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.board-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.board-empty i {
  font-size: 1.8em;
  opacity: 0.5;
}

/* Feedback Item */
.feedback-item {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: border-color 0.2s ease;
}

.feedback-item:hover {
  border-color: var(--color-primary);
}

/* Row 1: vote column | info column */
.item-main {
  display: flex;
  gap: 12px;
}

.vote-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.vote-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
  font-size: 0.85em;
}

.vote-btn:hover:not(:disabled) {
  color: var(--color-primary);
  background: rgba(255, 255, 255, 0.06);
}

.vote-btn.active {
  color: var(--color-primary);
}

.vote-btn:disabled {
  opacity: 0.4;
  cursor: wait;
}

.vote-count {
  font-weight: 700;
  font-size: 0.95em;
  color: var(--color-text);
  min-width: 24px;
  text-align: center;
}

.vote-count.positive {
  color: var(--color-success, #19ef83);
}

.vote-count.negative {
  color: var(--color-danger, #ff5555);
}

.item-body {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.type-icon {
  color: var(--color-primary);
  font-size: 0.9em;
  flex-shrink: 0;
}

.item-title {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.item-meta {
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.meta-icon {
  font-size: 0.75em;
  color: var(--color-text-muted);
}

/* Status Pills */
.status-pill {
  font-size: 0.7em;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid transparent;
}

.status-open {
  color: var(--color-text-muted);
  border-color: var(--terminal-border-color);
}

.status-planned {
  color: var(--color-blue);
  border-color: rgba(18, 224, 255, 0.4);
  background: rgba(18, 224, 255, 0.08);
}

.status-in_progress {
  color: var(--color-yellow);
  border-color: rgba(255, 215, 0, 0.4);
  background: rgba(255, 215, 0, 0.08);
}

.status-completed {
  color: var(--color-green);
  border-color: rgba(25, 239, 131, 0.4);
  background: rgba(25, 239, 131, 0.08);
}

.status-declined {
  color: var(--color-red);
  border-color: rgba(255, 85, 85, 0.4);
  background: rgba(255, 85, 85, 0.08);
}

.status-duplicate {
  color: var(--color-text-muted);
  border-color: var(--terminal-border-color);
  opacity: 0.7;
}

/* Expanded Detail */
/* Row 2: full-width detail, flush to the card's left edge (no vote-column offset) */
.item-detail {
  width: 100%;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
  cursor: default;
}

.item-description {
  font-size: 0.88em;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0 0 12px 0;
  line-height: 1.5;
}

.item-description.muted {
  color: var(--color-text-muted);
  font-style: italic;
}

.detail-loading {
  font-size: 0.85em;
  color: var(--color-text-muted);
  padding: 8px 0;
}

.item-screenshot {
  max-width: calc(100% - 2px);
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
  vertical-align: middle;
}

.admin-response {
  border: 1px solid rgba(18, 224, 255, 0.3);
  background: rgba(18, 224, 255, 0.05);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.admin-response-header {
  font-size: 0.75em;
  font-weight: 700;
  color: var(--color-blue);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.admin-response p {
  margin: 0;
  font-size: 0.88em;
  color: var(--color-text);
  white-space: pre-wrap;
}

.admin-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.admin-response-input {
  flex: 1;
  min-width: 160px;
  padding: 8px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  /* --color-dull-white is a PHYSICAL name that the light theme remaps to
     var(--color-text) = #4a4a60, so this field painted dark ink as its own
     surface. --color-darker-0 is the themed well and needs no per-theme patch — which
     is why the `body.dark` rule that used to sit here is gone. */
  background: var(--color-darker-0);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.85em;
}

.admin-response-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

/* Forms */
.form-input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  background: var(--color-darker-0);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.95em;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.feedback-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  background: var(--color-darker-0);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.95em;
  resize: vertical;
  min-height: 120px;
}

.feedback-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid var(--terminal-border-color);
  padding-top: 20px;
  flex-shrink: 0;
}

/* Buttons */
.btn {
  padding: 10px 20px;
  border-radius: 4px;
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  font-family: inherit;
}

.btn-compact {
  padding: 8px 14px;
  font-size: 0.85em;
  white-space: nowrap;
}

.btn-primary {
  background: var(--color-primary);
  color: var(--color-dark-navy);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.75;
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
}

.btn-secondary:hover {
  /* 5% WHITE is a lift on a dark canvas and invisible on a light one.
     --surface-hover inverts. */
  background: var(--surface-hover);
}

.load-more-btn {
  margin: 8px auto;
  flex-shrink: 0;
}

/* Image Upload Styles */
.image-upload-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upload-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  /* A drop zone is a field with a dashed edge; same token. */
  background: var(--color-darker-0);
  border: 1px dashed var(--terminal-border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text);
  font-size: 0.9em;
  width: calc(100% - 24px);
}

body.dark .upload-label {
  background: rgba(0, 0, 0, 10%);
}

.upload-label:hover {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.upload-label i {
  color: var(--color-primary);
  font-size: 1.1em;
}

.file-input {
  display: none;
}

.image-preview {
  position: relative;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.image-preview img {
  width: 100%;
  height: auto;
  display: block;
}

.remove-image-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: var(--color-darker-3);
  border: none;
  color: var(--text-on-scrim);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.remove-image-btn:hover {
  background: rgba(255, 0, 0, 0.8);
  transform: scale(1.1);
}

.remove-image-btn i {
  font-size: 0.9em;
}
</style>
