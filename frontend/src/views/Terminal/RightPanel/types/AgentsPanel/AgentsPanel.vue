<template>
  <div class="ui-panel agents-panel">
    <!-- Selected Agent Details -->
    <div v-if="selectedAgent" class="panel-section selected-agent-section">
      <!-- === Display Mode === -->
      <div v-if="!isEditing">
        <div class="selected-agent-header">
          <h2>Selected Agent Details</h2>
          <!-- Simple Edit Button -->
          <Tooltip text="Edit Agent" width="auto">
          <span class="edit-button-panel" @click="startEdit">
            <i class="fas fa-edit"></i>
          </span>
          </Tooltip>
        </div>
        <div class="selected-agent-content">
          <div class="agent-details">
            <div class="detail-row main-detail">
              <span class="label"><i class="fas fa-robot"></i> Name:</span>
              <span class="value name">{{ selectedAgent.name }}</span>
            </div>
            <!-- Added Description Display -->
            <div class="detail-row description-display">
              <span class="label"><i class="fas fa-info-circle"></i> Desc:</span>
              <span class="value description">{{ selectedAgent.description || 'N/A' }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><i class="fas fa-circle"></i> Status:</span>
              <span class="value">{{ selectedAgent.status }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><i class="fas fa-tools"></i> Tools:</span>
              <span class="value">{{ selectedAgent.assignedTools.length }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><i class="fas fa-flag"></i> Active Missions:</span>
              <span class="value">{{ activeMissionCountForPanel }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><i class="fas fa-clock"></i> Uptime:</span>
              <span class="value">{{ formatUptime(selectedAgent.uptime) }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><i class="fas fa-folder"></i> Category:</span>
              <CustomCategoryDropdown v-model="selectedCategory" :categories="agentCategories" @update:modelValue="updateCategory" />
            </div>
          </div>

          <div class="tools-list" v-if="selectedAgent.assignedTools && selectedAgent.assignedTools.length">
            <h3>Assigned Tools</h3>
            <div class="tools-grid">
              <div v-for="tool in selectedAgent.assignedTools" :key="tool" class="tool-item">
                {{ tool }}
              </div>
            </div>
          </div>

          <div class="agent-actions">
            <BaseButton @click="toggleAgent(selectedAgent)" :variant="selectedAgent.status === 'ACTIVE' ? 'danger' : 'success'" full-width>
              <i :class="selectedAgent.status === 'ACTIVE' ? 'fas fa-stop' : 'fas fa-play'"></i>
              {{ selectedAgent.status === 'ACTIVE' ? 'Deactivate' : 'Activate' }}
            </BaseButton>
            <BaseButton @click="showPublishModal = true" variant="primary" full-width>
              <i class="fas fa-store"></i>
              Publish to Marketplace
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- === Edit Mode === -->
      <div v-else class="agent-edit-form">
        <h2>Edit Agent: {{ selectedAgent.name }}</h2>
        <!-- Add Avatar Upload Field -->
        <div class="form-field avatar-upload">
          <label>Agent Avatar</label>
          <div class="avatar-preview-container">
            <img :src="editableAgentData.avatar || selectedAgent.avatar || defaultAvatarUrl" class="avatar-preview" alt="Agent avatar preview" />
            <div class="avatar-controls">
              <label for="avatar-edit-input" class="upload-button"> <i class="fas fa-upload"></i> Upload </label>
              <input type="file" id="avatar-edit-input" @change="handleAvatarUpload($event, 'edit')" accept="image/*" class="file-input" />
              <button v-if="editableAgentData.avatar || selectedAgent.avatar" class="remove-button" @click="removeAvatar('edit')">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>
        <div class="form-field">
          <label for="panelEditAgentName">Agent Name</label>
          <input id="panelEditAgentName" v-model="editableAgentData.name" type="text" class="input" />
        </div>
        <div class="form-field">
          <label for="panelEditAgentDesc">Description</label>
          <textarea id="panelEditAgentDesc" v-model="editableAgentData.description" class="input" rows="3"></textarea>
        </div>
        <div class="form-actions edit-form-actions">
          <BaseButton variant="success" @click="saveEdit" :disabled="!editableAgentData.name.trim()"> <i class="fas fa-save"></i> Save </BaseButton>
          <BaseButton variant="secondary" @click="cancelEdit"> Cancel </BaseButton>
        </div>
      </div>
    </div>

    <!-- Placeholder when no agent selected -->
    <div v-else class="panel-section placeholder-section">
      <p>Select an agent to view details.</p>
      <BaseButton variant="primary" class="create-agent-button" @click="$emit('panel-action', 'navigate', 'AgentForgeScreen')">
        <i class="fas fa-plus"></i>
        Create New Agent
      </BaseButton>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />

    <!-- Publish Agent Modal -->
    <MarketplaceFormModal
      :is-open="showPublishModal"
      mode="publish"
      item-type="agent"
      :item="selectedAgent"
      :categories="agentCategories"
      :stripe-connected="stripeConnected"
      :show-preview-image="true"
      @close="showPublishModal = false"
      @submit="handlePublishAgent"
      @setup-stripe="handleSetupStripe"
      @open-billing="handleOpenBilling"
    />

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import MarketplaceFormModal from '@/views/_components/common/MarketplaceFormModal.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import CustomCategoryDropdown from '../WorkflowsPanel/CustomCategoryDropdown.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'AgentsPanel',
  components: {
    BaseButton,
    ResourcesSection,
    MarketplaceFormModal,
    SimpleModal,
    CustomCategoryDropdown,
    Tooltip,
  },
  props: {
    selectedAgent: {
      type: Object,
      default: () => null,
    },
    activeMissionCountForPanel: {
      type: Number,
      default: 0,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    // Default avatar URL (same as currently used)
    const defaultAvatarUrl =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5RUY4MyIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMiAxMmMyLjIxIDAgNC0xLjc5IDQtNHMtMS43OS00LTQtNC00IDEuNzktNCA0IDEuNzkgNCA0IDR6bTAgMmMtMi42NyAwLTggMS4zNC04IDR2MmgxNnYtMmMwLTIuNjYtNS4zMy00LTgtNHoiLz48L3N2Zz4=';

    // Category management
    const selectedCategory = ref('');

    // Edit state
    const isEditing = ref(false);
    const editableAgentData = ref({ name: '', description: '', avatar: null });

    // Computed
    const availableTools = computed(() => {
      return store.getters['tools/allTools'] || [];
    });

    // Methods
    const toggleAgent = (agent) => {
      emit('panel-action', 'toggle-agent', agent);
    };

    const formatUptime = (uptime) => {
      if (!uptime) return '0m';
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    };

    // Edit methods
    const startEdit = () => {
      if (props.selectedAgent) {
        editableAgentData.value.name = props.selectedAgent.name;
        editableAgentData.value.description = props.selectedAgent.description || '';
        editableAgentData.value.avatar = null; // Set to null initially, keeping the original until explicitly changed
        isEditing.value = true;
      }
    };

    const cancelEdit = () => {
      isEditing.value = false;
    };

    const saveEdit = () => {
      if (!editableAgentData.value.name.trim()) {
        console.warn('Agent name cannot be empty in panel edit.');
        emit('panel-action', 'show-feedback', { type: 'error', message: 'Agent name cannot be empty.' });
        return;
      }

      // Prepare the updated data, preserving the original avatar if not changed
      const updateData = {
        id: props.selectedAgent.id,
        name: editableAgentData.value.name,
        description: editableAgentData.value.description,
        // If a new avatar was uploaded, use it. Otherwise, keep the existing avatar
        avatar: editableAgentData.value.avatar !== null ? editableAgentData.value.avatar : props.selectedAgent.avatar,
      };

      emit('panel-action', 'update-agent-details', updateData);

      isEditing.value = false;
    };

    // Handle avatar upload
    const handleAvatarUpload = (event, mode) => {
      const file = event.target.files[0];
      if (!file) return;

      // Check file type
      if (!file.type.match(/image.*/)) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: 'Please upload an image file.',
        });
        return;
      }

      // Check file size (2MB limit)
      if (file.size > 2 * 1024 * 1024) {
        emit('panel-action', 'show-feedback', {
          type: 'error',
          message: 'Image must be less than 2MB.',
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          // Resize logic
          const MAX_WIDTH = 128;
          const MAX_HEIGHT = 128;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Compress to JPEG (or PNG if you want transparency)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // 0.7 = quality

          // Check base64 size (100KB limit)
          const base64Length = dataUrl.length - 'data:image/jpeg;base64,'.length;
          const sizeInKB = (base64Length * 3) / 4 / 1024;
          if (sizeInKB > 100) {
            emit('panel-action', 'show-feedback', {
              type: 'error',
              message: 'Compressed image is still too large (max 100KB). Please use a smaller image.',
            });
            return;
          }

          if (mode === 'edit') {
            editableAgentData.value.avatar = dataUrl;
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    };

    // Remove avatar
    const removeAvatar = (mode) => {
      if (mode === 'edit') {
        editableAgentData.value.avatar = null;
      }
    };

    // Watch for agent changes to update category
    watch(
      () => props.selectedAgent,
      (newAgent) => {
        if (newAgent) {
          // Convert empty string to "Uncategorized" for display in dropdown
          selectedCategory.value = newAgent.category || 'Uncategorized';
        }
      },
      { immediate: true }
    );

    // Update category method
    const updateCategory = () => {
      if (props.selectedAgent) {
        // Convert "Uncategorized" to empty string to match how uncategorized agents are stored
        const newCategory = selectedCategory.value === 'Uncategorized' ? '' : selectedCategory.value;
        const currentCategory = props.selectedAgent.category || '';

        if (currentCategory !== newCategory) {
          // Create a deep copy to avoid direct mutation issues
          const updatedAgent = JSON.parse(JSON.stringify(props.selectedAgent));
          updatedAgent.category = newCategory;
          emit('panel-action', 'update-agent', updatedAgent);
        }
      }
    };

    // Publishing
    const showPublishModal = ref(false);
    const stripeConnected = ref(false);
    const agentCategories = computed(() => store.getters['agents/agentCategories'] || []);
    const simpleModal = ref(null);

    // Check Stripe Connect status
    const checkStripeStatus = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect/status`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        stripeConnected.value = data.exists && data.onboardingComplete;
      } catch (error) {
        console.error('Error checking Stripe status:', error);
      }
    };

    // Confetti animation
    const triggerConfetti = () => {
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 2000 };

      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }

      const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Create confetti from two origins
        if (window.confetti) {
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          });
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          });
        }
      }, 250);
    };

    onMounted(() => {
      checkStripeStatus();

      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }
    });

    const handlePublishAgent = async (publishData) => {
      try {
        // Add the full agent data
        publishData.asset_data = props.selectedAgent;

        // Use agent's avatar as preview_image if not already set
        if (!publishData.preview_image && props.selectedAgent.avatar) {
          publishData.preview_image = props.selectedAgent.avatar;
        }

        console.log('[DEBUG] Publishing agent with data:', publishData);

        // Publish to marketplace
        await store.dispatch('marketplace/publishWorkflow', publishData);
        showPublishModal.value = false;
        emit('panel-action', 'agent-published', publishData);

        // Trigger confetti
        triggerConfetti();

        // Show success message
        await simpleModal.value?.showModal({
          title: '🎉 Success! 🎉',
          message: 'Agent published successfully to marketplace!',
          confirmText: 'Awesome!',
          showCancel: false,
        });
      } catch (error) {
        console.error('Error publishing agent:', error);
        await simpleModal.value?.showModal({
          title: 'Error',
          message: `Failed to publish agent: ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
        });
      }
    };

    const handleSetupStripe = async () => {
      try {
        const token = localStorage.getItem('token');
        const user = store.state.userAuth?.user;

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: user?.email,
            return_url: window.location.origin + '/agents?stripe=success',
            refresh_url: window.location.origin + '/agents?stripe=refresh',
          }),
        });

        const data = await response.json();

        // Validate URL before opening
        if (!data.onboardingUrl || typeof data.onboardingUrl !== 'string' || !data.onboardingUrl.startsWith('http')) {
          console.error('Invalid onboarding URL received:', data.onboardingUrl);
          throw new Error('Invalid Stripe onboarding URL received from server');
        }

        // Open Stripe onboarding in external browser
        if (window.electron?.openExternalUrl) {
          window.electron.openExternalUrl(data.onboardingUrl);
        } else {
          window.open(data.onboardingUrl, '_blank');
        }
      } catch (error) {
        console.error('Error setting up Stripe:', error);
        await simpleModal.value?.showModal({
          title: 'Error',
          message: `Failed to set up Stripe Connect: ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
        });
      }
    };

    const handleOpenBilling = () => {
      // Close the modal first
      showPublishModal.value = false;

      // Navigate to Settings screen
      emit('panel-action', 'navigate', 'SettingsScreen');

      // Set the billing section to be opened
      localStorage.setItem('settings-initial-section', 'billing');
    };

    return {
      defaultAvatarUrl,
      handleAvatarUpload,
      removeAvatar,
      toggleAgent,
      formatUptime,
      selectedAgent: computed(() => props.selectedAgent),
      isEditing,
      editableAgentData,
      startEdit,
      cancelEdit,
      saveEdit,
      // Category management
      selectedCategory,
      updateCategory,
      // Publishing
      showPublishModal,
      stripeConnected,
      agentCategories,
      handlePublishAgent,
      handleSetupStripe,
      handleOpenBilling,
      simpleModal,
    };
  },
};
</script>

<style scoped>
.ui-panel.agents-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  background: var(--color-background-soft);
  color: var(--color-text);
  min-height: 0;
}

/* Common Section Styling */
.panel-section {
  border-radius: 0px;
  padding: 15px;
  /* box-shadow: 0 0 8px rgba(var(--green-rgb), 0.3); */
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
}

.panel-section h2 {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0 0 15px 0;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

.agent-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.detail-row .label {
  color: var(--color-white);
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-row .label i {
  width: 14px;
  text-align: center;
  color: var(--color-green);
}

.detail-row .value {
  color: var(--color-green);
  text-align: right;
}

.detail-row .value.name {
  font-weight: bold;
  color: var(--color-white);
  font-size: 1.1em;
  text-wrap-mode: nowrap;
}

.main-detail {
  margin-bottom: 5px;
}

.tools-list {
  margin-top: 10px;
}

.tools-list h3 {
  color: var(--color-white);
  font-size: 0.9em;
  margin-bottom: 8px;
}

.tools-grid {
  display: flex;
  gap: 8px;
  overflow-x: scroll;
  scrollbar-width: thin;
  padding-bottom: 8px;
  flex-wrap: wrap;
}

.tool-item {
  background: rgba(var(--green-rgb), 0.1);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 0.9em;
  color: var(--color-green);
  text-align: center;
  width: fit-content;
}

.agent-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.agent-actions .BaseButton i {
  margin-right: 6px;
}

.placeholder-section {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  font-style: italic;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

textarea.input {
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
  font-size: 0.95em;
}

select.input {
  appearance: none;
  background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2319EF83%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E');
  background-repeat: no-repeat;
  background-position: right 0.7rem top 50%;
  background-size: 0.65rem auto;
  padding-right: 2rem;
}

/* .agent-edit-form {
  margin-top: 10px;
} */

.selected-agent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

.selected-agent-header h2 {
  margin: 0;
  padding: 0;
  border: none;
}

.edit-button-panel {
  color: var(--color-white);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-size: 0.9em;
  line-height: 1;
}

.detail-row.description-display .label {
  width: fit-content;
}

.edit-button-panel:hover {
  color: var(--color-green);
  background-color: rgba(var(--green-rgb), 0.1);
}

.description-display {
  margin-bottom: 10px;
}

.description-display .label {
  margin-right: 10px;
}

.description-display .value {
  font-weight: bold;
}

.edit-form-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.edit-form-actions .BaseButton {
  width: auto;
}

.edit-form-actions .BaseButton i {
  margin-right: 6px;
}

.detail-row.description-display .value.description {
  font-size: 0.9em;
  white-space: nowrap;
  text-align: right;
  color: var(--color-white);
  flex-basis: 70%;
  line-height: 1.4;
  text-wrap: auto;
}

.detail-row.description-display .label {
  align-self: flex-start;
}

.avatar-upload {
  margin-bottom: 15px;
}

.avatar-preview-container {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-top: 8px;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(var(--green-rgb), 0.1);
  border: 3px solid rgba(var(--green-rgb), 0.5);
  padding: 2px;
}

.avatar-controls {
  display: flex;
  gap: 8px;
}

.upload-button {
  padding: 6px 12px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 4px;
  color: var(--color-green);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
  transition: all 0.2s;
}

.upload-button:hover {
  background: rgba(var(--green-rgb), 0.2);
}

.file-input {
  display: none;
}

.remove-button {
  padding: 6px 10px;
  background: rgba(255, 50, 50, 0.1);
  border: 1px solid rgba(255, 50, 50, 0.3);
  color: rgba(255, 50, 50, 0.8);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.remove-button:hover {
  background: rgba(255, 50, 50, 0.2);
}

.create-agent-button {
  margin-top: 16px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
