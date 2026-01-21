<template>
  <div class="chat-provider-selector" ref="selectorRef">
    <div class="provider-dropdown" :class="{ open: isOpen }">
      <div class="dropdown-header">
        <span class="dropdown-title">AI Provider</span>
        <Tooltip text="Close" width="auto">
        <button @click="closeDropdown" class="close-btn">
          <i class="fas fa-times"></i>
        </button>
        </Tooltip>
      </div>

      <div class="dropdown-content">
        <!-- Current Selection Display -->
        <div class="current-selection">
          <div class="selection-label">Current:</div>
          <div class="selection-value">
            <span class="provider-name">{{ selectedProviderDisplayName }}</span>
            <span v-if="selectedProvider" class="model-name">{{ selectedModel || 'No model' }}</span>
          </div>
        </div>

        <!-- Provider Selector -->
        <div class="selector-group">
          <label>Provider:</label>
          <CustomSelect
            ref="providerSelect"
            :options="providerOptions"
            :placeholder="selectedProvider || 'Select Provider'"
            :zIndex="10001"
            maxHeight="156px"
            @option-selected="handleProviderSelected"
          />
        </div>

        <!-- Model Selector -->
        <div class="selector-group">
          <label>Model:</label>
          <CustomSelect
            ref="modelSelect"
            :options="modelOptions"
            :placeholder="isLoadingModels ? 'Loading models...' : selectedModel || 'Select Model'"
            :zIndex="10001"
            maxHeight="156px"
            @option-selected="handleModelSelected"
          />
          <!-- Error Message -->
          <div v-if="modelError" class="model-error-message">
            <div class="error-content">
              <i class="fas fa-exclamation-circle"></i>
              <span class="error-text">{{ modelError }}</span>
            </div>
            <button v-if="modelError.includes('API key') || modelError.includes('configure')" 
                    @click="openSettings" 
                    class="btn-settings-link">
              Open Settings
            </button>
          </div>
        </div>

        <!-- Connection Status -->
        <div v-if="selectedProvider" class="connection-status">
          <span class="status-indicator" :class="{ connected: isProviderConnected }"></span>
          <span class="status-text">
            {{ isProviderConnected ? 'Connected' : 'Not Connected' }}
          </span>
        </div>

        <!-- Tool Support Warning -->
        <div v-if="toolSupportWarning" class="tool-support-warning">
          <i class="fas fa-exclamation-triangle"></i>
          <span class="warning-text">{{ toolSupportWarning }}</span>
        </div>

        <!-- Custom Provider Actions Row -->
        <div class="custom-provider-row">
          <Tooltip text="Add Custom Provider" width="auto">
          <button @click="openCustomProviderDialog" class="btn-add-custom">
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
      </div>
    </div>

    <!-- Custom Provider Dialog -->
    <CustomProviderDialog :is-open="isDialogOpen" :edit-provider="editingProvider" @close="closeDialog" @saved="handleProviderSaved" />
  </div>
</template>

<script>
import { computed, watch, onMounted, onUnmounted, ref, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import CustomProviderDialog from '../../Settings/components/ProviderSelector/CustomProviderDialog.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { AI_PROVIDERS_WITH_API, PROVIDER_FETCH_ACTIONS } from '@/store/app/aiProvider.js';
import { getToolSupportWarning } from '@/store/app/toolSupport.js';

export default {
  name: 'ChatProviderSelector',
  components: {
    CustomSelect,
    CustomProviderDialog,
    Tooltip,
  },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const selectorRef = ref(null);
    const providerSelect = ref(null);
    const modelSelect = ref(null);
    const isLocalServerRunning = ref(false);
    const isDialogOpen = ref(false);
    const editingProvider = ref(null);

    const providers = computed(() => store.state.aiProvider.providers);
    const customProviders = computed(() => store.state.aiProvider.customProviders || []);
    const connectedProviders = computed(() => store.state.appAuth.connectedApps);
    const connectedProvidersLower = computed(() => connectedProviders.value.map((p) => p.toLowerCase()));

    const selectedProvider = computed(() => store.state.aiProvider.selectedProvider);
    const selectedModel = computed(() => store.state.aiProvider.selectedModel);

    // Get display name for the selected provider (handles custom providers showing UUID)
    const selectedProviderDisplayName = computed(() => {
      if (!selectedProvider.value) return 'None';

      // Check if it's a custom provider (UUID format)
      const customProvider = customProviders.value.find((p) => p.id === selectedProvider.value);
      if (customProvider) {
        return customProvider.provider_name;
      }

      // For built-in providers, the ID is the name
      return selectedProvider.value;
    });
    const filteredModels = computed(() => store.getters['aiProvider/filteredModels']);
    const isLoadingModels = computed(() => store.state.aiProvider.loadingModels[store.state.aiProvider.selectedProvider] || false);
    const modelError = computed(() => {
      if (!selectedProvider.value) return null;
      return store.state.aiProvider.modelErrors?.[selectedProvider.value] || null;
    });

    // Check if current provider is connected
    const isProviderConnected = computed(() => {
      if (!selectedProvider.value) return false;

      // Local provider check
      if (selectedProvider.value.toLowerCase() === 'local') {
        return isLocalServerRunning.value;
      }

      // Custom providers are always "connected" (they're user-created)
      const isCustom = customProviders.value.some((p) => p.id === selectedProvider.value);
      if (isCustom) {
        return true;
      }

      // Built-in providers check
      return connectedProvidersLower.value.includes(selectedProvider.value.toLowerCase());
    });

    // Check local server status using the actual LM Studio API endpoint
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

    // Transform providers into CustomSelect options format
    const providerOptions = computed(() => {
      // Built-in providers
      const builtInOptions = providers.value.map((provider) => ({
        label: provider,
        value: provider,
        disabled: provider.toLowerCase() === 'local' ? false : !connectedProvidersLower.value.includes(provider.toLowerCase()),
      }));

      // Custom providers (always enabled)
      const customOptions = customProviders.value.map((provider) => ({
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
      if (modelError.value) {
        return [{ label: 'No models available', value: '', disabled: true }];
      }
      if (filteredModels.value.length === 0) {
        return [{ label: 'No models found', value: '', disabled: true }];
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

    // Update CustomSelect components when values change
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

    // Watch for provider changes to fetch models
    watch(selectedProvider, async (newProvider, oldProvider) => {
      if (newProvider !== oldProvider) {
        const action = PROVIDER_FETCH_ACTIONS[newProvider];
        if (action) {
          try {
            await store.dispatch(action);
          } catch (error) {
            console.error(`Failed to fetch ${newProvider} models:`, error);
          }
        } else {
          // Check if it's a custom provider
          const isCustom = customProviders.value.some((p) => p.id === newProvider);
          if (isCustom) {
            try {
              console.log('Fetching models for custom provider:', newProvider);
              await store.dispatch('aiProvider/fetchCustomProviderModels', newProvider);
            } catch (error) {
              console.error(`Failed to fetch custom provider models:`, error);
            }
          }
        }
      }
      updateCustomSelects();
    });

    // Watch for model changes
    watch(selectedModel, () => {
      updateCustomSelects();
    });

    // Close dropdown
    const closeDropdown = () => {
      emit('close');
    };

    // Handle click outside
    const handleClickOutside = (event) => {
      if (!props.isOpen || !selectorRef.value) return;

      // Don't close if clicking inside the selector
      if (selectorRef.value.contains(event.target)) return;

      // Don't close if clicking inside the dialog (which is teleported to body)
      const dialogElement = event.target.closest('.dialog-overlay');
      if (dialogElement) return;

      // Close if clicking outside both the selector and dialog
      closeDropdown();
    };

    // Handle escape key
    const handleEscape = (event) => {
      if (event.key === 'Escape' && props.isOpen) {
        closeDropdown();
      }
    };

    let localServerCheckInterval = null;

    onMounted(async () => {
      // Check local server status
      await checkLocalServer();

      // Initialize CustomSelect components
      updateCustomSelects();

      // Add event listeners
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscape);

      // Poll for local server status
      localServerCheckInterval = setInterval(() => {
        checkLocalServer();
      }, 5000);
    });

    onUnmounted(() => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      if (localServerCheckInterval) {
        clearInterval(localServerCheckInterval);
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

    const handleProviderSaved = async () => {
      // Refresh custom providers list
      await store.dispatch('aiProvider/fetchCustomProviders');
      // Update provider options will happen automatically via computed
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

    // Open settings page
    const openSettings = () => {
      // Close the dropdown first
      closeDropdown();
      // Navigate to settings using router
      router.push('/settings');
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
          // Switch to first connected provider - find proper cased name from store
          const firstProvider = connectedAIProviders[0];
          const properCasedProvider = providers.value.find((p) => p.toLowerCase() === firstProvider);
          if (properCasedProvider) {
            store.dispatch('aiProvider/setProvider', properCasedProvider);
          }
        } else {
          // No connected providers, switch to Local
          store.dispatch('aiProvider/setProvider', 'Local');
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
      selectorRef,
      providerSelect,
      modelSelect,
      selectedProvider,
      selectedModel,
      selectedProviderDisplayName,
      providerOptions,
      modelOptions,
      isLoadingModels,
      isProviderConnected,
      handleProviderSelected,
      handleModelSelected,
      closeDropdown,
      isDialogOpen,
      editingProvider,
      openCustomProviderDialog,
      closeDialog,
      handleProviderSaved,
      isCustomProviderSelected,
      editCurrentProvider,
      deleteCurrentProvider,
      toolSupportWarning,
      modelError,
      openSettings,
    };
  },
};
</script>

<style scoped>
.chat-provider-selector {
  position: fixed;
  z-index: 10000;
}

.provider-dropdown {
  margin-top: -60px;
  margin-left: -210px;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  min-width: 320px;
  max-width: 400px;
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  pointer-events: none;
}

.provider-dropdown.open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  border-radius: 8px 8px 0 0;
}

.dropdown-title {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-light-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-med-navy);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-size: 1em;
}

.close-btn:hover {
  background: rgba(255, 107, 107, 0.1);
  color: var(--color-red);
}

.dropdown-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.current-selection {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.15);
  border-radius: 6px;
}

.selection-label {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.selection-value {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.provider-name {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-green);
}

.model-name {
  font-size: 0.85em;
  color: var(--color-light-med-navy);
  font-family: var(--font-family-mono);
}

.selector-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selector-group label {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-light-med-navy);
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 6px;
  font-size: 0.85em;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-red);
  box-shadow: 0 0 8px currentColor;
}

.status-indicator.connected {
  background: var(--color-green);
}

.status-text {
  color: var(--color-light-med-navy);
  font-weight: 500;
}

.custom-provider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-add-custom {
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
}

.btn-add-custom:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: var(--color-green);
  border-style: solid;
}

.btn-add-custom i {
  font-size: 0.85em;
}

.custom-provider-actions {
  display: inline-flex;
  gap: 6px;
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
  padding: 10px 12px;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 6px;
  font-size: 0.8em;
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

/* Model Error Message */
.model-error-message {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 6px;
  font-size: 0.8em;
}

.model-error-message .error-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.model-error-message i {
  color: var(--color-red);
  font-size: 1em;
  flex-shrink: 0;
  margin-top: 2px;
}

.model-error-message .error-text {
  color: rgba(255, 107, 107, 0.9);
  line-height: 1.4;
  flex: 1;
}

.btn-settings-link {
  margin-top: 4px;
  padding: 4px 10px;
  background: rgba(255, 107, 107, 0.15);
  color: var(--color-red);
  border: 1px solid rgba(255, 107, 107, 0.4);
  border-radius: 4px;
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  align-self: flex-start;
}

.btn-settings-link:hover {
  background: rgba(255, 107, 107, 0.25);
  border-color: var(--color-red);
}
</style>
