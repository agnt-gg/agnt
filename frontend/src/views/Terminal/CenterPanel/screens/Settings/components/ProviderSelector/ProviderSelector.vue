<template>
  <div class="provider-selector-wrapper">
    <h3>
      Orchestrator AI Model
      <span class="provider-selector-subtext"> (The AI model to use for Annie, AI orchestration, and generating agents, workflows, & tools) </span>
    </h3>
    <div class="provider-selector">
      <label>AI Provider:</label>
      <CustomSelect
        ref="providerSelect"
        :options="providerOptions"
        :placeholder="selectedProvider || 'Select Provider'"
        @option-selected="handleProviderSelected"
      />

      <label>Model:</label>
      <CustomSelect
        ref="modelSelect"
        :options="modelOptions"
        :placeholder="isLoadingModels ? 'Loading models...' : selectedModel || 'Select Model'"
        @option-selected="handleModelSelected"
      />

      <Tooltip text="Add Custom Provider" width="auto">
        <button @click="openCustomProviderDialog" class="btn-add-provider">
          <i class="fas fa-plus"></i>
          <span>Add Custom</span>
        </button>
      </Tooltip>

      <!-- Edit/Delete buttons for custom providers -->
      <div v-if="isCustomProviderSelected" class="custom-provider-actions">
        <Tooltip text="Edit" width="auto">
          <button @click="editCurrentProvider" class="btn-edit-provider">
            <i class="fas fa-edit"></i>
          </button>
        </Tooltip>
        <Tooltip text="Delete" width="auto">
          <button @click="deleteCurrentProvider" class="btn-delete-provider">
            <i class="fas fa-trash"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Tool Support Warning -->
    <div v-if="toolSupportWarning" class="tool-support-warning">
      <i class="fas fa-exclamation-triangle"></i>
      <span class="warning-text">{{ toolSupportWarning }}</span>
    </div>

    <!-- Custom Provider Dialog -->
    <CustomProviderDialog :is-open="isDialogOpen" :edit-provider="editingProvider" @close="closeDialog" @saved="handleProviderSaved" />
  </div>
</template>

<script>
import { computed, watch, onMounted, onUnmounted, ref, nextTick } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import CustomProviderDialog from './CustomProviderDialog.vue';
import { AI_PROVIDERS_WITH_API, PROVIDER_FETCH_ACTIONS } from '@/store/app/aiProvider.js';
import { getToolSupportWarning } from '@/store/app/toolSupport.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  components: {
    CustomSelect,
    CustomProviderDialog,
    Tooltip,
  },
  setup() {
    const providerSelect = ref(null);
    const modelSelect = ref(null);
    const store = useStore();
    const isLocalServerRunning = ref(false);
    const isDialogOpen = ref(false);
    const editingProvider = ref(null);

    const providers = computed(() => store.getters['aiProvider/filteredProviders']);
    const customProviders = computed(() => store.state.aiProvider.customProviders || []);
    const connectedProviders = computed(() => store.state.appAuth.connectedApps);

    // Always work with lowercase strings
    const connectedProvidersLower = computed(() => connectedProviders.value.map((p) => p.toLowerCase()));

    // Check if local server is running using the actual LM Studio API endpoint
    const checkLocalServer = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch('http://127.0.0.1:1234/v1/models', {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        isLocalServerRunning.value = response.ok;
      } catch (error) {
        isLocalServerRunning.value = false;
      }
    };

    const hasConnectedProviders = computed(() => connectedProvidersLower.value.some((p) => AI_PROVIDERS_WITH_API.includes(p)));

    const selectedProvider = computed({
      get: () => store.state.aiProvider.selectedProvider,
      set: (newProvider) => {
        store.dispatch('aiProvider/setProvider', newProvider);
      },
    });

    const selectedModel = computed({
      get: () => store.state.aiProvider.selectedModel,
      set: (newModel) => {
        store.dispatch('aiProvider/setModel', newModel);
      },
    });

    const filteredModels = computed(() => store.getters['aiProvider/filteredModels']);
    const isLoadingModels = computed(() => store.state.aiProvider.loadingModels[store.state.aiProvider.selectedProvider] || false);

    // Transform providers into CustomSelect options format
    const providerOptions = computed(() => {
      // Built-in providers
      const builtInOptions = providers.value.map((provider) => ({
        label: provider,
        value: provider,
        // Local provider is always enabled (user can select it anytime)
        // Other providers are enabled only if they're in the connected apps list
        disabled: provider.toLowerCase() === 'local' ? false : !connectedProvidersLower.value.includes(provider.toLowerCase()),
      }));

      // Custom providers (always enabled)
      const customProviders = store.state.aiProvider.customProviders || [];
      const customOptions = customProviders.map((provider) => ({
        label: `${provider.provider_name} (Custom)`,
        value: provider.id,
        disabled: false,
      }));

      return [...builtInOptions, ...customOptions];
    });

    // Transform models into CustomSelect options format
    const modelOptions = computed(() => {
      if (isLoadingModels.value) {
        return [{ label: 'Loading models...', value: '', disabled: true }];
      }
      return filteredModels.value.map((model) => ({
        label: model,
        value: model,
        disabled: false,
      }));
    });

    // Handle provider selection
    const handleProviderSelected = (option) => {
      if (!option.disabled) {
        store.dispatch('aiProvider/setProvider', option.value);
      }
    };

    // Handle model selection
    const handleModelSelected = (option) => {
      if (!option.disabled) {
        store.dispatch('aiProvider/setModel', option.value);
      }
    };

    // Update CustomSelect components when values change programmatically
    const updateCustomSelects = async () => {
      await nextTick();
      if (providerSelect.value && selectedProvider.value) {
        const providerOption = providerOptions.value.find((opt) => opt.value === selectedProvider.value);
        if (providerOption) {
          providerSelect.value.setSelectedOption(providerOption);
        }
      }
      if (modelSelect.value && selectedModel.value) {
        const modelOption = modelOptions.value.find((opt) => opt.value === selectedModel.value);
        if (modelOption) {
          modelSelect.value.setSelectedOption(modelOption);
        }
      }
    };

    // Watch for provider changes to fetch models dynamically
    watch(selectedProvider, async (newProvider, oldProvider) => {
      if (newProvider !== oldProvider) {
        console.log(`Fetching ${newProvider} models...`);
        try {
          const action = PROVIDER_FETCH_ACTIONS[newProvider];
          if (action) {
            await store.dispatch(action);
          } else {
            // Check if it's a custom provider (UUID format)
            const isCustomProvider = customProviders.value.some((p) => p.id === newProvider);
            if (isCustomProvider) {
              console.log(`Fetching models for custom provider: ${newProvider}`);
              await store.dispatch('aiProvider/fetchCustomProviderModels', newProvider);
            }
          }
        } catch (error) {
          console.error(`Failed to fetch ${newProvider} models:`, error);
        }
      }
      updateCustomSelects();
    });

    // Watch for model changes to update CustomSelect
    watch(selectedModel, () => {
      updateCustomSelects();
    });

    // Update the selected provider based on connected providers.
    // Only auto-switch if NO provider is selected OR the current provider is not connected
    const updateSelectedProvider = async () => {
      const connectedAIProviders = connectedProvidersLower.value.filter((p) => AI_PROVIDERS_WITH_API.includes(p));

      // If there's already a selected provider, check if we should keep it
      if (selectedProvider.value) {
        const currentProvider = selectedProvider.value.toLowerCase();

        // Don't auto-switch if Local is selected - let the user keep their choice
        if (currentProvider === 'local') {
          // Just ensure valid model, don't change provider
          await store.dispatch('aiProvider/ensureValidModel');
          return;
        }

        // Don't auto-switch if it's a custom provider - let the user keep their choice
        const isCustomProvider = customProviders.value.some((p) => p.id === selectedProvider.value);
        if (isCustomProvider) {
          // Just ensure valid model, don't change provider
          await store.dispatch('aiProvider/ensureValidModel');
          return;
        }

        // Don't auto-switch if the current provider is still connected
        if (connectedAIProviders.includes(currentProvider)) {
          // Just ensure valid model, don't change provider
          await store.dispatch('aiProvider/ensureValidModel');
          return;
        }
      }

      // Only auto-switch if:
      // 1. No provider is selected (null), OR
      // 2. Current provider is not connected
      // AND there are connected providers available
      if (connectedAIProviders.length > 0) {
        if (connectedAIProviders.includes('anthropic')) {
          selectedProvider.value = 'Anthropic';
        } else if (connectedAIProviders.includes('openai-codex-cli')) {
          selectedProvider.value = 'OpenAI-Codex-CLI';
        } else if (connectedAIProviders.includes('openai-codex')) {
          selectedProvider.value = 'OpenAI-Codex';
        } else if (connectedAIProviders.includes('openai')) {
          selectedProvider.value = 'OpenAI';
        } else if (connectedAIProviders.includes('gemini')) {
          selectedProvider.value = 'Gemini';
        } else if (connectedAIProviders.includes('grokai')) {
          selectedProvider.value = 'GrokAI';
        } else if (connectedAIProviders.includes('groq')) {
          selectedProvider.value = 'Groq';
        } else if (connectedAIProviders.includes('openrouter')) {
          selectedProvider.value = 'OpenRouter';
        } else if (connectedAIProviders.includes('togetherai')) {
          selectedProvider.value = 'TogetherAI';
        }
      }

      // Ensure a valid model is selected for the current provider
      await store.dispatch('aiProvider/ensureValidModel');
    };

    // Watch for changes in connectedProviders as an extra safeguard.
    watch(connectedProviders, (newConnected, oldConnected) => {
      const newNormalized = newConnected.map((p) => p.toLowerCase());
      const oldNormalized = oldConnected.map((p) => p.toLowerCase());
      const newlyConnected = newNormalized.filter((p) => !oldNormalized.includes(p));
      if (newlyConnected.some((p) => AI_PROVIDERS_WITH_API.includes(p))) {
        updateSelectedProvider();
      }
    });

    // Poll for local server status only (connected apps polling moved to Vuex store)
    let localServerCheckIntervalId = null;

    onMounted(async () => {
      // Fetch connected apps once on mount (polling handled by Vuex store)
      await store.dispatch('appAuth/fetchConnectedApps');
      updateSelectedProvider();

      // Check local server status immediately
      await checkLocalServer();

      // Fetch models for the currently selected provider on mount
      if (selectedProvider.value) {
        const action = PROVIDER_FETCH_ACTIONS[selectedProvider.value];
        if (action) {
          try {
            const forceRefresh = selectedProvider.value === 'Local' ? { forceRefresh: true } : {};
            await store.dispatch(action, forceRefresh);
          } catch (error) {
            console.error(`Failed to fetch ${selectedProvider.value} models on mount:`, error);
          }
        }
      }

      // Initialize CustomSelect components with current values
      updateCustomSelects();

      // Poll for local server status every 60 seconds
      localServerCheckIntervalId = setInterval(() => {
        checkLocalServer();
      }, 60000);
    });

    onUnmounted(() => {
      if (localServerCheckIntervalId) {
        clearInterval(localServerCheckIntervalId);
      }
    });

    // Custom provider dialog handlers
    const openCustomProviderDialog = () => {
      editingProvider.value = null;
      isDialogOpen.value = true;
    };

    const closeDialog = () => {
      isDialogOpen.value = false;
      editingProvider.value = null;
    };

    const handleProviderSaved = async (savedProvider) => {
      // Refresh custom providers list
      await store.dispatch('aiProvider/fetchCustomProviders');

      // If a new provider was created (or updated), select it
      if (savedProvider && savedProvider.id) {
        store.dispatch('aiProvider/setProvider', savedProvider.id);
      }
    };

    // Check if current provider is a custom provider
    const isCustomProviderSelected = computed(() => {
      if (!selectedProvider.value) return false;
      return customProviders.value.some((p) => p.id === selectedProvider.value);
    });

    // Tool support warning for selected provider/model
    const toolSupportWarning = computed(() => {
      return getToolSupportWarning(selectedProvider.value, selectedModel.value);
    });

    // Edit current custom provider
    const editCurrentProvider = () => {
      const currentProvider = customProviders.value.find((p) => p.id === selectedProvider.value);
      if (currentProvider) {
        editingProvider.value = currentProvider;
        isDialogOpen.value = true;
      }
    };

    // Delete current custom provider
    const deleteCurrentProvider = async () => {
      if (!selectedProvider.value) return;

      const currentProvider = customProviders.value.find((p) => p.id === selectedProvider.value);
      if (!currentProvider) return;

      // Confirm deletion
      if (!confirm(`Are you sure you want to delete "${currentProvider.provider_name}"?`)) {
        return;
      }

      try {
        await store.dispatch('aiProvider/deleteCustomProvider', selectedProvider.value);

        // Refresh custom providers list
        await store.dispatch('aiProvider/fetchCustomProviders');

        // Switch to a different provider since we deleted the current one
        const connectedAIProviders = connectedProvidersLower.value.filter((p) => AI_PROVIDERS_WITH_API.includes(p));

        if (connectedAIProviders.length > 0) {
          // Switch to first connected provider - capitalize first letter
          const firstProvider = connectedAIProviders[0];
          // Find the proper cased provider name from the store
          const properCasedProvider = providers.value.find((p) => p.toLowerCase() === firstProvider);
          if (properCasedProvider) {
            selectedProvider.value = properCasedProvider;
          }
        } else {
          // No connected providers, switch to Local
          selectedProvider.value = 'Local';
        }
      } catch (error) {
        console.error('Failed to delete custom provider:', error);
        alert('Failed to delete custom provider: ' + error.message);
      }
    };

    // Fetch custom providers on mount
    onMounted(async () => {
      await store.dispatch('aiProvider/fetchCustomProviders');
    });

    return {
      providers,
      customProviders,
      selectedProvider,
      selectedModel,
      filteredModels,
      connectedProviders,
      connectedProvidersLower,
      hasConnectedProviders,
      isLoadingModels,
      providerOptions,
      modelOptions,
      handleProviderSelected,
      handleModelSelected,
      providerSelect,
      modelSelect,
      isDialogOpen,
      editingProvider,
      openCustomProviderDialog,
      closeDialog,
      handleProviderSaved,
      isCustomProviderSelected,
      editCurrentProvider,
      deleteCurrentProvider,
      toolSupportWarning,
    };
  },
};
</script>

<style scoped>
.provider-selector-wrapper {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: flex-start;
  width: 100%;
  gap: 12px;
}
.provider-selector {
  display: flex;
  gap: 1rem;
  align-items: center;
  width: 100%;
}
label {
  width: fit-content;
  text-wrap: nowrap;
}
.provider-selector-subtext {
  font-size: 14px;
  opacity: 0.5;
  margin-left: 8px;
  font-weight: 400;
}
.provider-message {
  color: var(--color-pink);
  font-style: italic;
}

.btn-add-provider {
  padding: 6px 12px;
  background: transparent;
  color: var(--color-green);
  border: 1px dashed rgba(25, 239, 131, 0.4);
  border-radius: 5px;
  font-size: 0.8em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.btn-add-provider:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: var(--color-green);
  border-style: solid;
}

.btn-add-provider i {
  font-size: 0.85em;
}

.custom-provider-actions {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.btn-edit-provider,
.btn-delete-provider {
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  font-size: 0.8em;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-edit-provider {
  background: transparent;
  color: var(--color-med-navy);
  border: 1px solid var(--terminal-border-color);
}

.btn-edit-provider:hover {
  background: rgba(127, 129, 147, 0.15);
  color: var(--color-light-med-navy);
  border-color: var(--color-light-med-navy);
}

.btn-delete-provider {
  background: transparent;
  color: var(--color-med-navy);
  border: 1px solid var(--terminal-border-color);
}

.btn-delete-provider:hover {
  background: rgba(255, 107, 107, 0.15);
  color: var(--color-red);
  border-color: rgba(255, 107, 107, 0.5);
}

.btn-edit-provider i,
.btn-delete-provider i {
  font-size: 0.85em;
}

/* Tool Support Warning */
.tool-support-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 6px;
  font-size: 0.85em;
  margin-top: 4px;
}

.tool-support-warning i {
  color: #ffc107;
  font-size: 1em;
  flex-shrink: 0;
  margin-top: 2px;
}

.tool-support-warning .warning-text {
  color: rgba(255, 193, 7, 0.9);
  line-height: 1.4;
}
</style>
