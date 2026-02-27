<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="AgentForgeScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    activeRightPanel="AgentForgePanel"
    :panelProps="panelProps"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
    @panel-action="handlePanelAction"
  >
    <template #default>
      <div class="agentforge-content">
        <!-- Header Section -->
        <!-- <div class="forge-header">
          <div class="forge-title-section">
            <h2 class="forge-title">
              <i class="fas fa-robot"></i>
              Agent Forge
            </h2>
            <p class="forge-subtitle">Create a new agent, assign tools, workflows, and configure its capabilities.</p>
          </div>
          <div class="forge-stats">
            <div class="stat-item">
              <span class="stat-value">{{ availableTools.length }}</span>
              <span class="stat-label">Tools Available</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">{{ availableWorkflows.length }}</span>
              <span class="stat-label">Workflows Available</span>
            </div>
          </div>
        </div> -->

        <!-- Main Form Container -->
        <div class="form-container">
          <BaseForm class="agent-form" @submit="createAgent">
            <!-- Main Content Grid -->
            <div class="main-content-grid">
              <!-- Row 1: Avatar | Personal Info -->
              <div class="two-column-row">
                <!-- Avatar Section -->
                <div class="avatar-card half-width">
                  <div class="card-header">
                    <h3 class="card-title">Your Agent</h3>
                    <p class="card-subtitle">This will be displayed on your agent profile</p>
                  </div>

                  <div class="avatar-section">
                    <div class="avatar-wrapper">
                      <img :src="newAgent.avatar || defaultAvatarUrl" class="avatar-preview" alt="Agent avatar preview" />
                    </div>
                    <div class="avatar-controls">
                      <button type="button" class="upload-button" @click="triggerFileUpload">
                        <i class="fas fa-upload"></i>
                        Upload New
                      </button>
                      <input ref="fileInput" type="file" @change="handleAvatarUpload" accept="image/*" class="file-input" />
                      <button v-if="newAgent.avatar" class="remove-button" type="button" @click="removeAvatar">
                        <i class="fas fa-times"></i>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Personal Information -->
                <div class="info-card half-width">
                  <div class="card-header">
                    <h3 class="card-title">Personal Information</h3>
                  </div>

                  <div class="info-fields">
                    <div class="form-field">
                      <BaseInput
                        id="agentName"
                        label="Agent Name"
                        v-model="newAgent.name"
                        type="text"
                        placeholder="Enter agent name"
                        autocomplete="off"
                        required
                      />
                    </div>

                    <div class="form-field">
                      <BaseSelect
                        id="agentCategory"
                        label="Category"
                        v-model="newAgent.category"
                        :options="categoryOptions"
                        placeholder="Select category"
                      />
                    </div>

                    <div class="form-field">
                      <BaseSelect
                        id="agentProvider"
                        label="AI Provider"
                        v-model="newAgent.provider"
                        :options="providerOptions"
                        placeholder="Use Global Default"
                      />
                    </div>

                    <div class="form-field">
                      <BaseSelect
                        id="agentModel"
                        label="AI Model"
                        v-model="newAgent.model"
                        :options="modelOptions"
                        :disabled="!newAgent.provider"
                        placeholder="Use Global Default"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Row 2: Description (Full Width) -->
              <div class="bio-card full-width">
                <div class="card-header">
                  <h3 class="card-title">Description</h3>
                </div>

                <div class="bio-content">
                  <BaseTextarea
                    id="description"
                    v-model="newAgent.description"
                    placeholder="Describe what this agent will do, its specializations, and key capabilities. This helps users understand how to best utilize your agent..."
                    rows="4"
                    :show-label="false"
                  />
                </div>
              </div>

              <!-- Row 3: Tools & Workflows (Full Width) -->
              <div class="capabilities-card full-width">
                <div class="card-header">
                  <h3 class="card-title">Tools & Workflows</h3>
                </div>

                <div class="capabilities-content">
                  <div class="capability-section">
                    <div class="capability-header">
                      <i class="fas fa-tools"></i>
                      <span>Available Tools</span>
                      <span class="add-more-btn" @click="showToolsModal = true">+ Add more</span>
                    </div>
                    <div class="capability-tags">
                      <div v-for="tool in newAgent.tools.slice(0, 6)" :key="tool" class="capability-tag">
                        {{ getToolName(tool) }}
                        <i class="fas fa-times" @click="removeFromArray(newAgent.tools, tool)"></i>
                      </div>
                      <div v-if="newAgent.tools.length > 6" class="more-count">+{{ newAgent.tools.length - 6 }} more</div>
                    </div>
                  </div>

                  <div class="capability-section">
                    <div class="capability-header">
                      <i class="fas fa-sitemap"></i>
                      <span>Workflows</span>
                      <span class="add-more-btn" @click="showWorkflowsModal = true">+ Add more</span>
                    </div>
                    <div class="capability-tags">
                      <div v-for="workflow in newAgent.workflows.slice(0, 6)" :key="workflow" class="capability-tag">
                        {{ getWorkflowName(workflow) }}
                        <i class="fas fa-times" @click="removeFromArray(newAgent.workflows, workflow)"></i>
                      </div>
                      <div v-if="newAgent.workflows.length > 6" class="more-count">+{{ newAgent.workflows.length - 6 }} more</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </BaseForm>
        </div>
      </div>
    </template>
  </BaseScreen>

  <!-- Modals for Tools and Workflows Selection - placed outside BaseScreen to avoid overflow issues -->
  <Teleport to="body">
    <div v-if="showToolsModal" class="modal-overlay" @click="showToolsModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>Select Tools</h3>
          <button class="modal-close" @click="showToolsModal = false">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <ListWithSearch
            :items="availableTools"
            v-model="newAgent.tools"
            labelKey="title"
            idKey="id"
            placeholder="Search and select tools..."
            :empty-message="availableTools.length === 0 ? 'No tools available' : 'No tools selected'"
          />
        </div>
      </div>
    </div>

    <div v-if="showWorkflowsModal" class="modal-overlay" @click="showWorkflowsModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>Select Workflows</h3>
          <button class="modal-close" @click="showWorkflowsModal = false">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <ListWithSearch
            :items="availableWorkflows"
            v-model="newAgent.workflows"
            labelKey="name"
            idKey="id"
            placeholder="Search and select workflows..."
            :empty-message="availableWorkflows.length === 0 ? 'No workflows available' : 'No workflows selected'"
          />
        </div>
      </div>
    </div>
  </Teleport>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="AgentForgeScreen" @close="onTutorialClose" />
</template>

<script>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import BaseForm from '@/views/Terminal/_components/BaseForm.vue';
import BaseInput from '@/views/Terminal/_components/BaseInput.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import BaseTextarea from '@/views/Terminal/_components/BaseTextarea.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ListWithSearch from '@/views/Terminal/_components/ListWithSearch.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import { useAgentForgeTutorial } from './useAgentForgeTutorial.js';

export default {
  name: 'AgentForgeScreen',
  components: {
    BaseScreen,
    BaseForm,
    BaseInput,
    BaseSelect,
    BaseTextarea,
    BaseButton,
    ListWithSearch,
    PopupTutorial,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const { tutorialConfig, startTutorial, onTutorialClose, initializeAgentForgeTutorial } = useAgentForgeTutorial();
    const store = useStore();
    // Reactive success message for UI feedback
    const successMessage = ref('');
    const baseScreenRef = ref(null);
    const fileInput = ref(null);
    const terminalLines = ref(['Welcome to the Agent Forge!', 'Fill out the form below to create a new agent.']);
    const availableTools = ref([]);
    const availableWorkflows = ref([]);
    const isLoading = ref(false);
    const error = ref(null);
    const defaultAvatarUrl =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5RUY4MyIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMiAxMmMyLjIxIDAgNC0xLjc5IDQtNHMtMS43OS00LTQtNC00IDEuNzktNCA0IDEuNzkgNCA0IDR6bTAgMmMtMi42NyAwLTggMS4zNC04IDR2MmgxNnYtMmMwLTIuNjYtNS4zMy00LTgtNHoiLz48L3N2Zz4=';

    const newAgent = ref({
      name: '',
      description: '',
      tools: [],
      workflows: [],
      avatar: null,
      memory: 'vector-db',
      category: '',
      role: '',
      provider: '',
      model: '',
      tickSpeed: 1000,
      tokenBudget: 10000,
      memoryLimit: 256,
      autoRestart: true,
      maxRetries: 3,
    });

    const showToolsModal = ref(false);
    const showWorkflowsModal = ref(false);

    const isFormValid = computed(() => {
      return newAgent.value.name.trim() !== '';
    });

    // Panel props for AgentForgePanel
    const panelProps = computed(() => ({
      availableTools: availableTools.value,
      availableWorkflows: availableWorkflows.value,
      isLoading: isLoading.value,
      onRefresh: () => fetchData(true),
      availableCategories: store.getters['agents/agentCategories'] || [],
      isFormValid: isFormValid.value,
      onCreateAgent: createAgent,
    }));

    // Memory system options
    const memorySystemOptions = [
      { value: 'vector-db', label: 'Vector Database' },
      { value: 'local', label: 'Local Storage' },
      { value: 'redis', label: 'Redis' },
      { value: 'pinecone', label: 'Pinecone' },
      { value: 'none', label: 'No Memory' },
    ];

    // Category options for select
    const categoryOptions = computed(() => (store.getters['agents/agentCategories'] || []).map((cat) => ({ value: cat, label: cat })));

    // AI Provider and Model options
    const aiProviders = computed(() => store.getters['aiProvider/filteredProviders']);
    const availableModels = computed(() => {
      const provider = newAgent.value.provider;
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

    // Watch for categoryOptions changes and set default if available
    watch(
      categoryOptions,
      (opts) => {
        if (opts.length > 0 && !newAgent.value.category) {
          newAgent.value.category = opts[0].value;
        }
      },
      { immediate: true }
    );

    // Watch for provider changes to fetch models dynamically
    watch(
      () => newAgent.value.provider,
      async (newProvider) => {
        if (newProvider) {
          await store.dispatch('aiProvider/fetchProviderModels', { provider: newProvider });
        }
      }
    );

    // Fetch tools and workflows on mount
    const fetchData = async (force = false) => {
      isLoading.value = true;
      terminalLines.value.push(force ? '[AgentForge] Refreshing tools and workflows...' : '[AgentForge] Loading tools and workflows...');

      try {
        await Promise.all([store.dispatch('tools/fetchTools', { force }), store.dispatch('workflows/fetchWorkflows', { force })]);

        availableTools.value = store.getters['tools/allTools'] || [];
        availableWorkflows.value = store.getters['workflows/allWorkflows'] || [];

        if (force) {
          terminalLines.value.push('[AgentForge] Refreshed data successfully.');
        } else if (store.state.tools.lastFetched && store.state.workflows.lastFullFetch) {
          terminalLines.value.push('[AgentForge] Loaded from cache.');
        } else {
          terminalLines.value.push('[AgentForge] Loaded data successfully.');
        }
      } catch (e) {
        error.value = e.message;
        terminalLines.value.push(`[Error] ${e.message}`);
      } finally {
        isLoading.value = false;
        await nextTick();
        baseScreenRef.value?.scrollToBottom();
      }
    };

    // Avatar upload logic
    const handleAvatarUpload = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (!file.type.match(/image.*/)) {
        showFeedback('error', 'Please upload an image file.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showFeedback('error', 'Image must be less than 5MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          // Use larger dimensions for better quality
          const MAX_SIZE = 256;
          let width = img.width;
          let height = img.height;

          // Maintain aspect ratio while fitting within MAX_SIZE
          if (width > height) {
            if (width > MAX_SIZE) {
              height = Math.round((height * MAX_SIZE) / width);
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width = Math.round((width * MAX_SIZE) / height);
              height = MAX_SIZE;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: true });

          // Enable image smoothing for better quality
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw image with high quality
          ctx.drawImage(img, 0, 0, width, height);

          // Try PNG first for lossless quality
          let dataUrl = canvas.toDataURL('image/png');
          let base64Length = dataUrl.length - 'data:image/png;base64,'.length;
          let sizeInKB = (base64Length * 3) / 4 / 1024;

          // If PNG is too large, fall back to high-quality JPEG
          if (sizeInKB > 200) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            base64Length = dataUrl.length - 'data:image/jpeg;base64,'.length;
            sizeInKB = (base64Length * 3) / 4 / 1024;

            if (sizeInKB > 200) {
              showFeedback('error', 'Compressed image is still too large (max 200KB). Please use a smaller image.');
              return;
            }
          }

          newAgent.value.avatar = dataUrl;
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    };
    const removeAvatar = () => {
      newAgent.value.avatar = null;
    };

    // Trigger file upload
    const triggerFileUpload = () => {
      fileInput.value?.click();
    };

    // Helper methods for new layout
    const getToolName = (toolId) => {
      const tool = availableTools.value.find((t) => t.id === toolId);
      return tool ? tool.title : toolId;
    };

    const getWorkflowName = (workflowId) => {
      const workflow = availableWorkflows.value.find((w) => w.id === workflowId);
      return workflow ? workflow.name : workflowId;
    };

    const removeFromArray = (array, item) => {
      const index = array.indexOf(item);
      if (index > -1) {
        array.splice(index, 1);
      }
    };

    // Update tick speed
    const updateTickSpeed = (action) => {
      const step = 100;
      const min = 100;
      const max = 10000;

      if (action === 'increase') {
        newAgent.value.tickSpeed = Math.min(newAgent.value.tickSpeed + step, max);
      } else {
        newAgent.value.tickSpeed = Math.max(newAgent.value.tickSpeed - step, min);
      }
    };

    // Feedback helper
    const showFeedback = (type, message) => {
      terminalLines.value.push(`[Panel Feedback - ${type.toUpperCase()}]: ${message}`);
      nextTick(() => baseScreenRef.value?.scrollToBottom());
    };

    // Create agent
    const createAgent = async () => {
      if (!isFormValid.value) return;
      terminalLines.value.push('[AgentForge] Creating agent...');
      isLoading.value = true;
      try {
        await store.dispatch('agents/createAgent', {
          ...newAgent.value,
          assignedTools: newAgent.value.tools,
          assignedWorkflows: newAgent.value.workflows,
          category: newAgent.value.category,
        });
        terminalLines.value.push(`[AgentForge] Agent "${newAgent.value.name}" created successfully!`);
        // Reset form
        newAgent.value = {
          name: '',
          description: '',
          tools: [],
          workflows: [],
          avatar: null,
          memory: 'vector-db',
          category: categoryOptions.value.length > 0 ? categoryOptions.value[0].value : '',
          role: '',
          provider: '',
          model: '',
          tickSpeed: 1000,
          tokenBudget: 10000,
          memoryLimit: 256,
          autoRestart: true,
          maxRetries: 3,
        };
      } catch (e) {
        terminalLines.value.push(`[AgentForge] Error: ${e.message}`);
      } finally {
        isLoading.value = false;
        await nextTick();
        baseScreenRef.value?.scrollToBottom();
      }
    };

    // Initialization
    const initializeScreen = () => {
      terminalLines.value = ['Welcome to the Agent Forge!', 'Fill out the form below to create a new agent.'];
      document.body.setAttribute('data-page', 'terminal-agent-forge');
      // Non-blocking: render form immediately, data fills in reactively
      fetchData().then(() => {
        nextTick(() => baseScreenRef.value?.scrollToBottom());
      });

      setTimeout(() => {
        initializeAgentForgeTutorial();
      }, 2000);
    };

    onMounted(() => {
      console.log('=== AGENT FORGE MOUNTED ===');
      console.log('Setting up event listeners for agent-loaded');

      fetchData();

      // Listen for agent events from the chat
      window.addEventListener('agent-field-updated', handleAgentFieldUpdate);
      window.addEventListener('agent-loaded', handleAgentLoaded);
      window.addEventListener('agent-saved', handleAgentSaved);
      window.addEventListener('agent-fields-cleared', handleAgentFieldsCleared);
      window.addEventListener('chat-sse-event', handleChatSSEEvent);

      console.log('Event listeners attached successfully');
      console.log('==============================');
    });

    // Clean up event listeners
    const cleanup = () => {
      window.removeEventListener('agent-field-updated', handleAgentFieldUpdate);
      window.removeEventListener('agent-loaded', handleAgentLoaded);
      window.removeEventListener('agent-saved', handleAgentSaved);
      window.removeEventListener('agent-fields-cleared', handleAgentFieldsCleared);
      window.removeEventListener('chat-sse-event', handleChatSSEEvent);
    };

    // Event handlers for agent actions from chat
    const handleAgentFieldUpdate = (event) => {
      const { field, value } = event.detail;
      console.log('AgentForge: Updating field', field, 'with value', value);

      if (field in newAgent.value) {
        newAgent.value[field] = value;
        terminalLines.value.push(`[AgentForge] Updated ${field}: ${value}`);
        nextTick(() => baseScreenRef.value?.scrollToBottom());
      }
    };

    const handleAgentLoaded = (event) => {
      console.log('=== AGENT FORGE RECEIVED EVENT ===');
      console.log('Event type:', event.type);
      console.log('Event detail:', event.detail);

      const agentData = event.detail;
      console.log('AgentForge: Loading agent data', agentData);
      console.log('AgentForge: assignedTools:', agentData?.assignedTools);
      console.log('AgentForge: assignedWorkflows:', agentData?.assignedWorkflows);

      // Populate form with loaded agent data
      if (agentData) {
        const newAgentData = {
          name: agentData.name || '',
          description: agentData.description || '',
          instructions: agentData.instructions || '',
          tools: agentData.assignedTools || agentData.tools || [],
          workflows: agentData.assignedWorkflows || agentData.workflows || [],
          avatar: agentData.avatar || null,
          memory: agentData.memory || 'vector-db',
          category: agentData.category || (categoryOptions.value.length > 0 ? categoryOptions.value[0].value : ''),
          role: agentData.role || '',
        };

        console.log('AgentForge: Setting newAgent.value to:', newAgentData);
        newAgent.value = newAgentData;
        // Reset dirty flag after loading external data
        isDirty.value = false;

        console.log('AgentForge: newAgent.value after assignment:', newAgent.value);
        console.log('AgentForge: Form populated successfully');
        terminalLines.value.push(`[AgentForge] Loaded agent: ${agentData.name}`);
        terminalLines.value.push(`[AgentForge] Assigned ${newAgent.value.tools.length} tools and ${newAgent.value.workflows.length} workflows`);
        console.log('===================================');
        nextTick(() => baseScreenRef.value?.scrollToBottom());
      } else {
        console.error('AgentForge: No agent data in event!');
      }
    };

    const handleAgentSaved = (event) => {
      const result = event.detail;
      console.log('AgentForge: Agent saved', result);

      if (result.success) {
        terminalLines.value.push(`[AgentForge] Agent saved successfully!`);
        successMessage.value = 'Agent saved successfully!';
        setTimeout(() => {
          successMessage.value = '';
        }, 3000);
        nextTick(() => baseScreenRef.value?.scrollToBottom());
      }
    };

    const handleAgentFieldsCleared = () => {
      console.log('AgentForge: Clearing all fields');

      // Reset form to default state
      newAgent.value = {
        name: '',
        description: '',
        tools: [],
        workflows: [],
        avatar: null,
        memory: 'vector-db',
        category: categoryOptions.value.length > 0 ? categoryOptions.value[0].value : '',
        role: '',
        provider: '',
        model: '',
        tickSpeed: 1000,
        tokenBudget: 10000,
        memoryLimit: 256,
        autoRestart: true,
        maxRetries: 3,
      };

      isDirty.value = false;
      terminalLines.value.push('[AgentForge] Form cleared');
      nextTick(() => baseScreenRef.value?.scrollToBottom());
    };

    const handleChatSSEEvent = (event) => {
      const { eventType, eventData } = event.detail;
      console.log('AgentForge: Received chat SSE event', eventType, eventData);

      // Prevent unsolicited updates if form is dirty
      if (isDirty.value) {
        console.warn(`AgentForge: Ignoring SSE event ${eventType} because form is dirty`);
        return;
      }

      switch (eventType) {
        case 'agent-created':
        case 'agent-updated':
          if (eventData && eventData.updatedAgent) {
            handleAgentLoaded({ detail: eventData.updatedAgent });
          }
          break;
        case 'agent-field-updated':
          handleAgentFieldUpdate({ detail: eventData });
          break;
        case 'agent-loaded':
          handleAgentLoaded({ detail: eventData });
          break;
        case 'agent-fields-cleared':
          handleAgentFieldsCleared();
          break;
      }
    };

    // Handle panel actions from AgentForgePanel
    const handlePanelAction = (action, data) => {
      console.log('AgentForge: Received panel action', action, data);

      switch (action) {
        case 'agent-generated':
          handleAgentLoaded({ detail: data });
          break;
        case 'show-feedback':
          showFeedback(data.type, data.message);
          break;
        default:
          console.warn('AgentForge: Unknown panel action', action);
      }
    };

    // Cleanup on unmount
    onUnmounted(cleanup);

    return {
      baseScreenRef,
      fileInput,
      terminalLines,
      availableTools,
      availableWorkflows,
      isLoading,
      newAgent,
      isFormValid,
      createAgent,
      handleAvatarUpload,
      removeAvatar,
      triggerFileUpload,
      defaultAvatarUrl,
      initializeScreen,
      emit,
      panelProps,
      memorySystemOptions,
      categoryOptions,
      providerOptions,
      modelOptions,
      showToolsModal,
      showWorkflowsModal,
      getToolName,
      getWorkflowName,
      removeFromArray,
      updateTickSpeed,
      handlePanelAction,
      tutorialConfig,
      startTutorial,
      onTutorialClose,
    };
  },
};
</script>

<style scoped>
/* Main Layout */
.agentforge-content {
  position: relative;
  top: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  align-self: flex-start;
  height: fit-content;
  flex: 1;
}

/* Header Section */
.forge-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 0;
  border-bottom: 1px solid var(--terminal-border-color);
  margin-bottom: 8px;
}

.forge-title-section {
  flex: 1;
}

.forge-title {
  color: var(--color-text);
  font-size: var(--font-size-xxl);
  font-weight: var(--font-weight-bold);
  margin: 0 0 var(--spacing-sm) 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.forge-title i {
  font-size: var(--font-size-lg);
  color: var(--color-text-secondary);
}

.forge-subtitle {
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
  line-height: 1.4;
  margin: 0;
  opacity: 0.9;
}

.forge-stats {
  display: flex;
  gap: 24px;
  align-items: center;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  background: var(--terminal-lighten-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  min-width: 80px;
}

.stat-value {
  font-size: 1.4em;
  font-weight: 700;
  color: var(--color-text);
}

.stat-label {
  font-size: 0.8em;
  color: var(--color-text-muted);
  text-align: center;
  line-height: 1.2;
}

/* Form Container */
.form-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.agent-form {
  flex: 1;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}

/* Header Banner */
.form-banner {
  position: relative;
  height: 120px;
  overflow: hidden;
  border-radius: 12px 12px 0 0;
  margin-bottom: 20px;
}

.banner-gradient {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #f5576c 75%, #4facfe 100%);
  opacity: 0.9;
}

.banner-content {
  position: relative;
  z-index: 2;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: white;
}

.banner-title {
  font-size: 1.8em;
  font-weight: 700;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.banner-subtitle {
  font-size: 1em;
  opacity: 0.9;
  margin: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* Main Content Grid */
.main-content-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100%;
}

.full-width {
  width: calc(100% - 4px);
}

/* Two Column Row Layout */
.two-column-row {
  display: flex;
  gap: 20px;
  width: 100%;
  align-items: stretch;
}

.half-width {
  flex: 2;
  display: flex;
  flex-direction: column;
}

/* Card Styles */
.avatar-card,
.info-card,
.bio-card,
.capabilities-card,
.action-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-primary);
  border-radius: 12px;
  overflow: visible;
  transition: all 0.2s ease;
}

.avatar-card:hover,
.info-card:hover,
.bio-card:hover,
.capabilities-card:hover {
  /* border-color: rgba(var(--green-rgb), 0.3); */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-header {
  padding: 16px 20px;
  background: var(--terminal-darken-color);
  border-bottom: 1px solid var(--terminal-border-color);
}

.card-title {
  color: var(--color-text);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin: 0;
}

.card-subtitle {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin: var(--spacing-xs) 0 0 0;
  opacity: 0.8;
}

/* Avatar Card */
.avatar-section {
  padding: 24px;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  justify-content: space-evenly;
}

.avatar-wrapper {
  position: relative;
  width: 128px;
  height: 128px;
}

.avatar-preview {
  width: 128px;
  height: 128px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--color-dark-0);
  border: 2px solid var(--terminal-border-color);
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* .avatar-preview:hover {
  border-color: var(--color-primary);
  transform: scale(1.05);
} */

.avatar-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  width: 100%;
  max-width: 200px;
}

.avatar-card.half-width {
  flex: 1;
}

.upload-button,
.save-button {
  padding: 10px 16px;
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.9em;
  font-weight: 600;
  transition: all 0.2s ease;
  text-decoration: none;
  width: 100%;
}

.upload-button:hover,
.save-button:hover {
  background: var(--color-dark-1);
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.remove-button {
  padding: 8px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: rgba(239, 68, 68, 0.9);
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.85em;
  font-weight: 600;
  transition: all 0.2s ease;
  width: 100%;
}

.remove-button:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
}

.file-input {
  display: none;
}

/* Info Card */
.info-fields {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: visible;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  z-index: 1;
}

.form-field:focus-within {
  z-index: 10;
}

/* New field styles for performance settings */
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
  border: 1px solid var(--terminal-border-color);
  background: var(--color-dark-0);
  color: var(--color-text);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.9em;
}

.resource-input {
  border: 1px solid var(--terminal-border-color);
  background: var(--color-dark-0);
  color: var(--color-text);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.9em;
  width: 100%;
}

.input-description {
  color: var(--color-text-muted);
  font-size: 0.8em;
  opacity: 0.8;
}

.checkbox-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
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

/* Bio Card */
.bio-card {
  display: flex;
  flex-direction: column;
}

.bio-card .card-header {
  flex-shrink: 0;
}

.bio-card .bio-content {
  flex: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.bio-card :deep(.form-field) {
  display: flex;
  flex-direction: column;
}

.bio-card :deep(textarea) {
  resize: vertical !important;
  min-height: 100px !important;
  max-height: 600px !important;
}

.bio-content {
  padding: 24px;
}

/* Capabilities Card */
.capabilities-card {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.capabilities-card .card-header {
  flex-shrink: 0;
}

.capabilities-content {
  flex: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 0;
}

.capability-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--terminal-darken-color);
  border-radius: 10px;
  border: 1px solid var(--terminal-border-color);
  min-height: 0;
  overflow-y: auto;
}

.capability-header {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  font-weight: 600;
  font-size: 0.95em;
}

.capability-header i {
  color: var(--color-primary);
  font-size: 1em;
}

.add-more-btn {
  margin-left: auto;
  color: var(--color-green);
  cursor: pointer;
  font-size: 0.85em;
  font-weight: 600;
  transition: all 0.2s ease;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
}

.add-more-btn:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.4);
  transform: translateY(-1px);
}

.capability-tags {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  min-height: 64px;
  gap: 8px;
  height: auto;
  align-items: flex-start;
  overflow-y: auto;
  align-content: flex-start;
  justify-content: flex-start;
}

.capability-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 20px;
  color: var(--color-text);
  font-size: 0.9em;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.capability-tag:hover {
  background: var(--color-dark-1);
  border-color: var(--color-primary);
  /* transform: translateY(-2px); */
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.capability-tag i {
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.2s ease;
  padding: 2px;
}

.capability-tag i:hover {
  color: var(--color-red);
  transform: scale(1.2);
}

.more-count {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  background: rgba(127, 129, 147, 0.15);
  border: 1px solid rgba(127, 129, 147, 0.3);
  border-radius: 20px;
  color: var(--color-text-muted);
  font-size: 0.9em;
  font-weight: 600;
}

/* Action Card */
.action-card {
  width: 100%;
  max-width: 1400px;
  margin: 20px auto 0;
}

.action-content {
  padding: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  background: var(--terminal-darken-color);
  border-radius: 10px;
  margin: 4px;
}

.validation-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95em;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
}

.validation-status.valid {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.05);
}

.validation-status.invalid {
  color: var(--color-red);
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.05);
}

.validation-status i {
  font-size: 1.1em;
}

.create-agent-button {
  min-width: 200px;
  height: 52px;
  font-size: 1.05em;
  font-weight: 700;
  border-radius: 10px;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.create-agent-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(var(--green-rgb), 0.3);
}

.create-agent-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* Deep Styles for Components */
:deep(.list-items) {
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
}

/* Fix for select dropdown overflow */
:deep(.base-select) {
  position: relative;
  z-index: 1;
}

:deep(.base-select select) {
  position: relative;
  z-index: 2;
}

:deep(.base-select:focus-within) {
  z-index: 100;
}

/* Ensure dropdown options are visible */
:deep(.base-select select:focus) {
  z-index: 101;
}

/* :deep(.base-input input) {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(127, 129, 147, 0.3);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--color-text);
  transition: all 0.2s ease;
}

:deep(.base-input input:focus) {
  border-color: rgba(var(--green-rgb), 0.5);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.1);
}

:deep(.base-select select) {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(127, 129, 147, 0.3);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--color-text);
  transition: all 0.2s ease;
}

:deep(.base-select select:focus) {
  border-color: rgba(var(--green-rgb), 0.5);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.1);
}

:deep(.base-textarea textarea) {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(127, 129, 147, 0.3);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--color-text);
  transition: all 0.2s ease;
  resize: vertical;
  min-height: 80px;
}

:deep(.base-textarea textarea:focus) {
  border-color: rgba(var(--green-rgb), 0.5);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.1);
} */

/* Responsive Design */
@media (max-width: 1200px) {
  .main-content-grid {
    grid-template-columns: 340px 1fr;
    gap: 24px;
  }
}

@media (max-width: 1024px) {
  .main-content-grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .left-column {
    order: 1;
  }

  .right-column {
    order: 2;
  }

  .avatar-wrapper {
    width: 100px;
    height: 100px;
  }

  .avatar-preview {
    width: 100px;
    height: 100px;
  }
}

@media (max-width: 768px) {
  .main-content-grid {
    gap: 20px;
  }

  .card-header {
    padding: 14px 18px;
  }

  .card-title {
    font-size: 1em;
  }

  .avatar-section {
    padding: 20px;
  }

  .avatar-wrapper {
    width: 90px;
    height: 90px;
  }

  .avatar-preview {
    width: 90px;
    height: 90px;
  }

  .info-fields,
  .bio-content,
  .capabilities-content {
    padding: 20px;
  }

  .action-content {
    padding: 20px;
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
  }

  .validation-status {
    justify-content: center;
  }

  .create-agent-button {
    min-width: unset;
    width: 100%;
  }

  .modal-content {
    width: 95%;
    max-height: 90vh;
  }

  .modal-header,
  .modal-body {
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .main-content-grid {
    gap: 16px;
  }

  .left-column,
  .right-column {
    gap: 16px;
  }

  .avatar-section {
    padding: 16px;
  }

  .avatar-wrapper {
    width: 128px;
    height: 128px;
  }

  .avatar-preview {
    width: 128px;
    height: 128px;
    border-width: 3px;
  }

  .avatar-controls {
    gap: 8px;
  }

  .upload-button,
  .save-button {
    padding: 8px 12px;
    font-size: 0.85em;
  }

  .remove-button {
    padding: 6px 10px;
    font-size: 0.8em;
  }

  .card-header {
    padding: 12px 16px;
  }

  .card-title {
    font-size: 0.95em;
  }

  .card-subtitle {
    font-size: 0.8em;
  }

  .info-fields,
  .bio-content,
  .capabilities-content {
    padding: 16px;
  }

  .info-fields {
    gap: 14px;
  }

  .capabilities-content {
    gap: 18px;
  }

  .capability-section {
    padding: 12px;
  }

  .capability-tags {
    gap: 8px;
  }

  .capability-tag {
    padding: 6px 10px;
    font-size: 0.85em;
  }

  .more-count {
    padding: 6px 10px;
    font-size: 0.85em;
  }

  .action-content {
    padding: 16px;
  }

  .validation-status {
    font-size: 0.85em;
    padding: 8px 12px;
  }

  .create-agent-button {
    height: 48px;
    font-size: 0.95em;
  }
}
</style>

<!-- Global styles for teleported modals -->
<style>
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
  z-index: 10000;
}

.modal-content {
  background: var(--color-darker-0, #1a1a2e);
  border: 1px solid var(--terminal-border-color, rgba(var(--green-rgb), 0.2));
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--terminal-border-color, rgba(var(--green-rgb), 0.2));
}

.modal-header h3 {
  margin: 0;
  color: var(--color-text, #fff);
  font-size: 1.2em;
  font-weight: 600;
}

.modal-close {
  background: none;
  border: none;
  color: var(--color-text-muted, #888);
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #fff);
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}
</style>
