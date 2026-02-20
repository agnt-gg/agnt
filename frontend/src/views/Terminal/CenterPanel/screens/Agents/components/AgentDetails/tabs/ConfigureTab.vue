<template>
  <div class="tab-pane configure">
    <div class="configure-section">
      <h3 class="section-title"><i class="fas fa-cog"></i> Agent Configuration</h3>

      <!-- Basic Settings -->
      <div class="config-group">
        <h4 class="section-title">
          <i class="fas fa-id-card"></i>
          Basic Settings
        </h4>

        <!-- Add Avatar Upload Field -->
        <div class="config-item avatar-upload">
          <label>Agent Avatar</label>
          <div class="avatar-preview-container">
            <img
              :src="
                agentConfig.avatar ||
                selectedAgent.avatar ||
                'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5RUY4MyIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMiAxMmMyLjIxIDAgNC0xLjc5IDQtNHMtMS43OS00LTQtNC00IDEuNzktNCA0IDEuNzkgNCA0IDR6bTAgMmMtMi42NyAwLTggMS4zNC04IDR2MmgxNnYtMmMwLTIuNjYtNS4zMy00LTgtNHoiLz48L3N2Zz4='
              "
              class="avatar-preview"
              alt="Agent avatar preview"
            />
            <div class="avatar-controls">
              <label for="config-avatar-input" class="upload-button"> <i class="fas fa-upload"></i> Upload </label>
              <input type="file" id="config-avatar-input" @change="handleConfigAvatarUpload" accept="image/*" class="file-input" />
              <button v-if="agentConfig.avatar || selectedAgent.avatar" class="remove-button" @click="removeConfigAvatar">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Name and Category Row -->
        <div class="config-row">
          <div class="config-item">
            <label>Agent Name</label>
            <input type="text" v-model="agentConfig.name" class="input" placeholder="Enter agent name" />
          </div>
          <div class="config-item">
            <BaseSelect id="agentConfigCategory" label="Category" v-model="agentConfig.category" :options="categoryOptions" maxHeight="200px" />
          </div>
        </div>

        <!-- Description (full width) -->
        <div class="config-item">
          <label>Description</label>
          <textarea v-model="agentConfig.description" class="input" rows="3" placeholder="Describe the agent's purpose and capabilities"></textarea>
        </div>

        <!-- Provider and Model Selection Row -->
        <div class="config-row">
          <div class="config-item">
            <BaseSelect
              id="agentConfigProvider"
              label="AI Provider"
              v-model="agentConfig.provider"
              :options="providerOptions"
              placeholder="Use Global Default"
              maxHeight="200px"
            />
          </div>
          <div class="config-item">
            <BaseSelect
              id="agentConfigModel"
              label="AI Model"
              v-model="agentConfig.model"
              :options="modelOptions"
              :disabled="!agentConfig.provider"
              placeholder="Use Global Default"
              maxHeight="200px"
            />
          </div>
        </div>
      </div>

      <!-- Assign Tools & Workflows Row -->
      <!-- <div class="config-row assign-tools-workflows-row"> -->
      <!-- Assign Tools -->
      <div class="config-group">
        <h4 class="section-title">
          <i class="fas fa-tools"></i>
          Assign Tools
        </h4>
        <ListWithSearch :items="availableTools" v-model="agentConfig.tools" label-key="title" id-key="id" placeholder="Search tools..." />
      </div>
      <!-- Assign Workflows -->
      <!-- <div class="config-group half-width">
          <h4 class="section-title">
            <i class="fas fa-sitemap"></i>
            Assign Workflows
          </h4>
          <ListWithSearch
            :items="availableWorkflows"
            v-model="agentConfig.workflows"
            label-key="name"
            id-key="id"
            placeholder="Search workflows..."
          />
        </div> -->
      <!-- </div> -->

      <!-- Performance and Resource Limits Row -->
      <!-- <div class="config-row">
        <div class="config-group">
          <h4 class="section-title">
            <i class="fas fa-tachometer-alt"></i>
            Performance Settings
          </h4>
          <div class="config-item">
            <label>Tick Speed (ms)</label>
            <div class="input-with-buttons">
              <button @click="updateTickSpeed('decrease')" class="adjust-button">
                <i class="fas fa-minus"></i>
              </button>
              <input type="number" v-model="agentConfig.tickSpeed" class="input number-input" min="100" max="10000" step="100" />
              <button @click="updateTickSpeed('increase')" class="adjust-button">
                <i class="fas fa-plus"></i>
              </button>
            </div>
            <span class="input-description">Time between agent processing cycles</span>
          </div>
        </div>

        <div class="config-group">
          <h4 class="section-title">
            <i class="fas fa-coins"></i>
            Resource Limits
          </h4>
          <div class="config-item">
            <label>Token Budget (per day)</label>
            <input type="number" v-model="agentConfig.tokenBudget" class="input" min="0" step="1000" />
            <span class="input-description">Maximum tokens the agent can use per day</span>
          </div>
          <div class="config-item">
            <label>Memory Limit (MB)</label>
            <input type="number" v-model="agentConfig.memoryLimit" class="input" min="64" step="64" />
            <span class="input-description">Maximum memory allocation for this agent</span>
          </div>
        </div>
      </div> -->

      <!-- Behavior Settings -->
      <div class="config-group">
        <h4 class="section-title">
          <i class="fas fa-sliders-h"></i>
          Behavior Settings
        </h4>
        <div class="config-row">
          <div class="config-item checkbox">
            <label class="checkbox-label">
              <input type="checkbox" v-model="agentConfig.autoRestart" />
              <span>Auto-restart on failure</span>
            </label>
            <span class="input-description">Automatically restart agent if it crashes or fails</span>
          </div>
          <div class="config-item">
            <label>Retry Attempts</label>
            <input type="number" v-model="agentConfig.maxRetries" class="input" min="0" max="10" step="1" />
            <span class="input-description">Maximum number of retry attempts before giving up</span>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="config-actions">
        <button
          class="action-button primary"
          @click="saveConfiguration"
          :disabled="saveStatus === 'saving'"
          :class="{ error: saveStatus === 'error' }"
        >
          <i v-if="saveStatus === 'saving'" class="fas fa-spinner fa-spin"></i>
          <i v-else-if="saveStatus === 'success'" class="fas fa-check"></i>
          <i v-else-if="saveStatus === 'error'" class="fas fa-exclamation-triangle"></i>
          <i v-else class="fas fa-save"></i>
          {{ saveStatus === 'saving' ? 'Saving...' : saveStatus === 'success' ? 'Saved!' : saveStatus === 'error' ? 'Error!' : 'Save Configuration' }}
        </button>
      </div>
      <div class="config-actions danger-actions">
        <button class="action-button danger" @click="confirmDeleteAgentFromConfig">
          <i class="fas fa-trash"></i>
          Delete Agent
        </button>
      </div>
    </div>

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { useStore } from 'vuex';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import ListWithSearch from '@/views/Terminal/_components/ListWithSearch.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

const store = useStore();
const simpleModal = ref(null);

const props = defineProps({
  selectedAgent: {
    type: Object,
    required: true,
  },
  availableTools: {
    type: Array,
    default: () => [],
  },
  // availableWorkflows: {
  //   type: Array,
  //   default: () => [],
  // },
  categoryOptions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['save-configuration', 'delete-agent', 'add-terminal-line']);

function initializeAgentConfig(agent) {
  return {
    name: agent.name,
    description: agent.description || '',
    tickSpeed: agent.config?.tickSpeed || 1000,
    tokenBudget: agent.config?.tokenBudget || 10000,
    memoryLimit: agent.config?.memoryLimit || 256,
    autoRestart: agent.config?.autoRestart || true,
    maxRetries: agent.config?.maxRetries || 3,
    avatar: agent.avatar || null,
    category: agent.category || '',
    provider: agent.provider || '',
    model: agent.model || '',
    tools: agent.assignedTools ? [...agent.assignedTools] : [],
    workflows: agent.assignedWorkflows ? [...agent.assignedWorkflows] : [],
  };
}

const agentConfig = ref(initializeAgentConfig(props.selectedAgent));
const saveStatus = ref('idle'); // 'idle', 'saving', 'success', 'error'

// AI Provider and Model options - use exact same data as store
const aiProviders = computed(() => store.getters['aiProvider/filteredProviders']);
const availableModels = computed(() => {
  const provider = agentConfig.value.provider;
  return provider ? store.state.aiProvider.allModels[provider] || [] : [];
});

// Format options for BaseSelect component
const providerOptions = computed(() => [
  { value: '', label: 'Use Global Default' },
  ...aiProviders.value.map((provider) => ({
    value: provider,
    label: provider,
  })),
]);

const modelOptions = computed(() => [
  { value: '', label: 'Use Global Default' },
  ...availableModels.value.map((model) => ({
    value: model,
    label: model,
  })),
]);

watch(
  () => props.selectedAgent,
  (newAgent) => {
    if (newAgent) {
      agentConfig.value = initializeAgentConfig(newAgent);
    }
  },
  { deep: true, immediate: true }
);

// Watch for provider changes to fetch models dynamically
watch(
  () => agentConfig.value.provider,
  async (newProvider) => {
    if (newProvider) {
      await store.dispatch('aiProvider/fetchProviderModels', { provider: newProvider });
    }
  }
);

const updateTickSpeed = (action) => {
  const step = 100;
  const min = 100;
  const max = 10000;

  if (action === 'increase') {
    agentConfig.value.tickSpeed = Math.min(agentConfig.value.tickSpeed + step, max);
  } else {
    agentConfig.value.tickSpeed = Math.max(agentConfig.value.tickSpeed - step, min);
  }
};

const handleConfigAvatarUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.match(/image.*/)) {
    emit('add-terminal-line', `[Agents] Error: Please upload an image file.`);
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    emit('add-terminal-line', `[Agents] Error: Image must be less than 2MB.`);
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

      const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // 0.7 = quality
      agentConfig.value.avatar = dataUrl;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

const removeConfigAvatar = () => {
  agentConfig.value.avatar = null;
};

const saveConfiguration = async () => {
  if (!props.selectedAgent) return;

  // Set saving status
  saveStatus.value = 'saving';

  try {
    const payload = {
      id: props.selectedAgent.id,
      name: agentConfig.value.name,
      description: agentConfig.value.description,
      category: agentConfig.value.category,
      provider: agentConfig.value.provider,
      model: agentConfig.value.model,
      avatar: agentConfig.value.avatar !== null ? agentConfig.value.avatar : props.selectedAgent.avatar,
      assignedTools: agentConfig.value.tools,
      assignedWorkflows: agentConfig.value.workflows,
      // Include other config fields if needed by the parent component
      tickSpeed: agentConfig.value.tickSpeed,
      tokenBudget: agentConfig.value.tokenBudget,
      memoryLimit: agentConfig.value.memoryLimit,
      autoRestart: agentConfig.value.autoRestart,
      maxRetries: agentConfig.value.maxRetries,
    };

    emit('save-configuration', payload);

    // Show success status briefly, then reset
    saveStatus.value = 'success';
    setTimeout(() => {
      saveStatus.value = 'idle';
    }, 2000);
  } catch (error) {
    // Show error status briefly, then reset
    saveStatus.value = 'error';
    setTimeout(() => {
      saveStatus.value = 'idle';
    }, 3000);

    emit('add-terminal-line', `[Agents] Error saving configuration: ${error.message}`);
  }
};

const confirmDeleteAgentFromConfig = async () => {
  if (!props.selectedAgent) return;

  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Agent?',
    message: `Are you sure you want to delete agent '${props.selectedAgent.name}'? This cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: 'btn-danger',
  });

  if (confirmed) {
    // Emit delete event to parent
    emit('delete-agent', { id: props.selectedAgent.id });

    // Emit a terminal line for immediate feedback
    emit('add-terminal-line', `[Agents] Agent '${props.selectedAgent.name}' deleted.`);
  }
};
</script>

<style scoped>
/* Scoped styles for the Configure tab */
.tab-pane.configure {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.configure-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0 auto;
  width: 100%;
}

h3.section-title,
h4.section-title {
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
}
h3.section-title {
  font-size: 1em;
}
h4.section-title {
  font-size: 0.9em;
  margin-bottom: 16px;
}

.section-title i {
  color: var(--color-green);
}

.config-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  width: 100%;
}

.config-group {
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 6px;
  padding: 16px;
}

.config-item {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-item:last-child {
  margin-bottom: 0;
}
.config-item label {
  color: var(--color-grey);
  font-size: 0.9em;
}

/* .input {
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
  padding: 0 6px;
  border-radius: 4px;
  width: 100%;
  font-size: 1em;
}
textarea.input {
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
} */

.input-with-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.adjust-button {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
  width: 32px;
  height: 32px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.adjust-button:hover {
  background: rgba(var(--green-rgb), 0.2);
}
.number-input {
  text-align: center;
  width: 120px;
}

.input-description {
  color: var(--color-grey);
  font-size: 0.8em;
  opacity: 0.8;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-light-green);
  cursor: pointer;
}
.checkbox-label input[type='checkbox'] {
  width: 16px;
  height: 16px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 3px;
  cursor: pointer;
  appearance: none;
  position: relative;
}
.checkbox-label input[type='checkbox']:checked {
  background: var(--color-green);
}
.checkbox-label input[type='checkbox']:checked::after {
  content: '✓';
  position: absolute;
  color: black;
  font-size: 12px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.config-actions {
  display: flex;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
}

.action-button {
  padding: 8px 16px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 4px;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}
.action-button:hover {
  background: rgba(var(--green-rgb), 0.2);
}
.action-button.primary {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
}
.action-button.primary:hover {
  background: rgba(var(--green-rgb), 0.8);
}
.action-button.primary.error {
  background: var(--color-red);
  color: #fff;
  border: 1px solid var(--color-red);
}
.action-button.primary.error:hover {
  background: var(--color-red);
  border-color: var(--color-red);
}
.action-button.danger {
  background: var(--color-red);
  color: #fff;
  border: 1px solid var(--color-red);
  transition: background 0.2s, color 0.2s;
}
.action-button.danger:hover {
  background: var(--color-red);
  color: #fff;
  border-color: var(--color-red);
}

.config-actions.danger-actions {
  margin-bottom: 16px;
  border-top: 1px dashed rgba(255, 77, 79, 0.2);
  padding-top: 16px;
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
  color: var(--color-light-green);
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

.config-row.assign-tools-workflows-row {
  display: flex;
  flex-direction: row;
  gap: 16px;
  width: 100%;
}
.config-group.half-width {
  flex: 1 1 0;
  min-width: 0;
}
</style>
