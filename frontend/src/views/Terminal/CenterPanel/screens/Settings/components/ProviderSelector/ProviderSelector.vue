<template>
  <div class="provider-selector-wrapper">
    <h3>
      Orchestrator AI Model
      <span class="provider-selector-subtext"> (The AI model to use for Annie, AI orchestration, and generating agents, workflows, & tools) </span>
    </h3>
    <div class="provider-selector">
      <ProviderModelSearch class="provider-selector-search" />
      <div class="provider-selector-main">
        <div class="selector-field">
          <label>AI Provider</label>
          <CustomSelect
            ref="providerSelect"
            :options="providerOptions"
            :placeholder="PROVIDER_DISPLAY_NAMES[selectedProvider] || selectedProvider || 'Select Provider'"
            @option-selected="handleProviderSelected"
          />
        </div>

        <div class="selector-field">
          <div class="selector-label-row">
            <label>Model</label>
            <RefreshModelsButton :provider="selectedProvider" size="md" variant="icon+label" />
          </div>
          <CustomSelect
            ref="modelSelect"
            :options="modelOptions"
            :placeholder="isLoadingModels ? 'Loading models...' : selectedModel || 'Select Model'"
            @option-selected="handleModelSelected"
          />
        </div>

        <div class="selector-field selector-field-reasoning">
          <ReasoningControl v-if="selectedReasoningControl" :provider="selectedProvider" :model="selectedModel" :show-hint="false" />
          <div v-else class="reasoning-fallback">
            <label>Reasoning</label>
            <div class="reasoning-fallback-message">{{ reasoningStatusText }}</div>
          </div>
        </div>
      </div>

      <div class="provider-selector-actions">
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
    </div>

    <!-- Tool Support Warning -->
    <div v-if="toolSupportWarning" class="tool-support-warning">
      <i class="fas fa-exclamation-triangle"></i>
      <span class="warning-text">{{ toolSupportWarning }}</span>
    </div>

    <!-- Custom System Instructions -->
    <div class="custom-instructions-section">
      <div class="custom-instructions-header">
        <label for="custom-instructions-textarea">Custom System Instructions</label>
        <Tooltip
          title="Applies system-wide"
          text="These instructions are appended to Annie's system prompt in every orchestrator chat. Use this for persistent tone/style preferences, default context about you, or rules you want followed everywhere. Takes effect on new chats."
          position="top"
          width="320px"
        >
          <i class="fas fa-info-circle info-icon"></i>
        </Tooltip>
      </div>
      <textarea
        id="custom-instructions-textarea"
        v-model="customInstructionsDraft"
        class="custom-instructions-textarea"
        rows="4"
        maxlength="4000"
        placeholder="e.g. Always respond concisely. I'm a senior engineer — skip the hand-holding. Prefer bullet points over prose."
        @blur="saveCustomInstructions"
      ></textarea>
      <div class="custom-instructions-footer">
        <span class="char-count" :class="{ 'char-count-warn': customInstructionsDraft.length > 3600 }">
          {{ customInstructionsDraft.length }} / 4000
        </span>
        <span v-if="customInstructionsStatus === 'saving'" class="status-indicator saving">Saving…</span>
        <span v-else-if="customInstructionsStatus === 'saved'" class="status-indicator saved"> <i class="fas fa-check"></i> Saved </span>
      </div>
    </div>

    <!-- Async tool execution toggle (experimental, off by default) -->
    <div class="async-tools-section">
      <div class="async-tools-row">
        <label for="async-tools-toggle" class="async-tools-label">
          <span>Async tool execution</span>
          <span class="experimental-badge">Experimental</span>
          <Tooltip
            title="Background &amp; scheduled tool calls (experimental)"
            text="Off by default. When on, Annie can run tools in the background, schedule recurring tasks, and delay actions (e.g. 'do this in 15 seconds'). The capability is still being hardened — turn it on if you want to try it. With it off, every tool call runs synchronously, just like a normal chat. Takes effect on new chats."
          >
            <i class="fas fa-info-circle info-icon"></i>
          </Tooltip>
        </label>
        <button
          id="async-tools-toggle"
          type="button"
          role="switch"
          class="async-tools-switch"
          :class="{ 'is-on': asyncToolsEnabled }"
          :aria-checked="asyncToolsEnabled"
          @click="toggleAsyncTools"
        >
          <span class="switch-thumb" :class="{ 'is-on': asyncToolsEnabled }"></span>
        </button>
      </div>
      <p class="async-tools-help">
        {{ asyncToolsEnabled
          ? 'On — Annie can queue tools to run in the background and on a schedule. (Experimental capability.)'
          : 'Off (default) — every tool call runs synchronously. No background tasks, no scheduled actions, no autonomous follow-ups.' }}
      </p>
    </div>

    <!-- Custom Provider Dialog -->
    <CustomProviderDialog :is-open="isDialogOpen" :edit-provider="editingProvider" @close="closeDialog" @saved="handleProviderSaved" />
  </div>
</template>

<script>
import { computed, watch, onMounted, onUnmounted, ref, nextTick } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import ProviderModelSearch from '@/components/common/ProviderModelSearch.vue';
import CustomProviderDialog from './CustomProviderDialog.vue';
import { AI_PROVIDERS_WITH_API, PROVIDER_FETCH_ACTIONS, PROVIDER_DISPLAY_NAMES, resolveProviderKey } from '@/store/app/aiProvider.js';
import { getToolSupportWarning } from '@/store/app/toolSupport.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import RefreshModelsButton from '@/components/common/RefreshModelsButton.vue';
import ReasoningControl from '@/components/common/ReasoningControl.vue';
import { DEPLOYMENT_CONFIG } from '@/tt.config.js';

export default {
  components: {
    CustomSelect,
    CustomProviderDialog,
    ProviderModelSearch,
    Tooltip,
    RefreshModelsButton,
    ReasoningControl,
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
      // Skip polling in hosted mode to avoid CORS errors
      if (DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM) {
        isLocalServerRunning.value = false;
        return;
      }
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

    // Custom system instructions — edited locally, persisted on blur
    const customInstructionsDraft = ref(store.state.aiProvider.customInstructions || '');
    const customInstructionsStatus = ref(''); // '' | 'saving' | 'saved'
    let savedResetTimer = null;

    // Keep local draft in sync if the store value changes (e.g. after loadUserSettings)
    watch(
      () => store.state.aiProvider.customInstructions,
      (val) => {
        if (document.activeElement?.id !== 'custom-instructions-textarea') {
          customInstructionsDraft.value = val || '';
        }
      },
    );

    // Async tool execution toggle — reflects the per-user capability gate.
    // On = Annie sees the async control params on every tool and the prompt
    // section that teaches her how to use them. Off = both vanish from the
    // request, so the LLM can't queue async or recurring tool calls.
    const asyncToolsEnabled = computed(() => store.state.aiProvider.asyncToolsEnabled !== false);
    const toggleAsyncTools = () => {
      store.dispatch('aiProvider/setAsyncToolsEnabled', !asyncToolsEnabled.value);
    };

    const saveCustomInstructions = async () => {
      const next = (customInstructionsDraft.value || '').trim();
      const current = (store.state.aiProvider.customInstructions || '').trim();
      if (next === current) return;

      customInstructionsStatus.value = 'saving';
      try {
        await store.dispatch('aiProvider/setCustomInstructions', next);
        customInstructionsStatus.value = 'saved';
        clearTimeout(savedResetTimer);
        savedResetTimer = setTimeout(() => {
          if (customInstructionsStatus.value === 'saved') customInstructionsStatus.value = '';
        }, 2000);
      } catch (error) {
        console.error('Failed to save custom instructions:', error);
        customInstructionsStatus.value = '';
      }
    };

    onUnmounted(() => {
      clearTimeout(savedResetTimer);
    });

    const filteredModels = computed(() => store.getters['aiProvider/filteredModels']);
    const isLoadingModels = computed(() => store.state.aiProvider.loadingModels[store.state.aiProvider.selectedProvider] || false);
    const selectedReasoningControl = computed(() => {
      if (!selectedProvider.value || !selectedModel.value) return null;
      return (
        store.state.aiProvider.modelMetadata[selectedProvider.value]?.[selectedModel.value]?.reasoningControl ||
        store.getters['aiProvider/inferReasoningControl']?.(selectedProvider.value, selectedModel.value) ||
        null
      );
    });
    const reasoningStatusText = computed(() => {
      if (!selectedProvider.value) {
        return 'Select a provider to view reasoning options.';
      }
      if (!selectedModel.value) {
        return 'Select a model to view reasoning options.';
      }
      if (isLoadingModels.value) {
        return 'Checking reasoning options for this model...';
      }
      return 'No reasoning controls available for this model.';
    });

    // Transform providers into CustomSelect options format
    const providerOptions = computed(() => {
      // Built-in providers
      const builtInOptions = providers.value.map((provider) => ({
        label: PROVIDER_DISPLAY_NAMES[provider] || provider,
        value: provider,
        // Local provider is always enabled (user can select it anytime)
        // Other providers are enabled only if they're in the connected apps list
        disabled: provider.toLowerCase() === 'local' ? false : !connectedProvidersLower.value.includes(resolveProviderKey(provider)),
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
        } else if (connectedAIProviders.includes('claude-code')) {
          selectedProvider.value = 'Claude-Code';
        } else if (connectedAIProviders.includes('openai-codex')) {
          selectedProvider.value = 'OpenAI-Codex';
        } else if (connectedAIProviders.includes('openai')) {
          selectedProvider.value = 'OpenAI';
        } else if (connectedAIProviders.includes('gemini')) {
          selectedProvider.value = 'Gemini';
        } else if (connectedAIProviders.includes('gemini-cli')) {
          selectedProvider.value = 'Gemini-CLI';
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
      selectedReasoningControl,
      reasoningStatusText,
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
      PROVIDER_DISPLAY_NAMES,
      customInstructionsDraft,
      customInstructionsStatus,
      saveCustomInstructions,
      asyncToolsEnabled,
      toggleAsyncTools,
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
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.provider-selector-main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 16px;
  align-items: end;
  width: 100%;
}

.selector-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.selector-field label {
  width: fit-content;
  text-wrap: nowrap;
}

.selector-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.selector-field-reasoning {
  min-width: 220px;
}

.reasoning-fallback {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reasoning-fallback-message {
  height: 32px;
  padding: 0px 10px;
  display: flex;
  align-items: center;
  border: 1px dashed var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-med-navy);
  font-size: 0.85em;
  line-height: 1.35;
}

.provider-selector-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.provider-selector :deep(.custom-select) {
  width: 100%;
}

.provider-selector :deep(.reasoning-control) {
  min-width: 0;
}

.provider-selector-subtext {
  font-size: 14px;
  opacity: 0.5;
  margin-left: 8px;
  font-weight: 400;
}
.provider-message {
  color: var(--color-primary);
  font-style: italic;
}

.btn-add-provider {
  padding: 6px 12px;
  background: transparent;
  color: var(--color-green);
  border: 1px dashed rgba(var(--green-rgb), 0.4);
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
  background: rgba(var(--green-rgb), 0.1);
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
  color: var(--color-yellow);
  font-size: 1em;
  flex-shrink: 0;
  margin-top: 2px;
}

.tool-support-warning .warning-text {
  color: rgba(255, 193, 7, 0.9);
  line-height: 1.4;
}

/* Custom System Instructions */
.custom-instructions-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin-top: 4px;
}

.custom-instructions-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-instructions-header label {
  font-weight: 500;
  width: auto;
}

.custom-instructions-header .info-icon {
  color: var(--color-med-navy);
  font-size: 0.95em;
  cursor: help;
  transition: color 0.15s ease;
}

.custom-instructions-header .info-icon:hover {
  color: var(--color-primary);
}

.custom-instructions-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  background: var(--terminal-background-color, transparent);
  color: var(--color-text, inherit);
  border: 1px solid var(--terminal-border-color);
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.9em;
  line-height: 1.5;
  resize: vertical;
  min-height: 96px;
  transition: border-color 0.15s ease;
}

.custom-instructions-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.custom-instructions-textarea::placeholder {
  color: var(--color-med-navy);
  opacity: 0.7;
}

.custom-instructions-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75em;
  color: var(--color-med-navy);
  min-height: 16px;
}

.char-count-warn {
  color: var(--color-yellow);
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.status-indicator.saving {
  color: var(--color-med-navy);
  opacity: 0.7;
}

.status-indicator.saved {
  color: var(--color-green);
}

/* Async tool execution toggle */
.async-tools-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin-top: 4px;
}

.async-tools-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.async-tools-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  cursor: default;
}

.experimental-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 0.7em;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-yellow);
  border: 1px solid var(--color-yellow);
  border-radius: 999px;
  background: rgba(255, 215, 0, 0.08);
  line-height: 1;
}

.async-tools-label .info-icon {
  color: var(--color-med-navy);
  font-size: 0.95em;
  cursor: help;
  transition: color 0.15s ease;
}

.async-tools-label .info-icon:hover {
  color: var(--color-primary);
}

.async-tools-switch {
  position: relative;
  width: 38px;
  height: 22px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 11px;
  background: var(--terminal-background-color, transparent);
  cursor: pointer;
  padding: 0;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.async-tools-switch:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.async-tools-switch.is-on {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-med-navy);
  transition: transform 0.18s ease, background-color 0.18s ease;
}

.switch-thumb.is-on {
  transform: translateX(16px);
  background: var(--color-white, #fff);
}

.async-tools-help {
  margin: 0;
  font-size: 0.75em;
  color: var(--color-med-navy);
  line-height: 1.4;
}
</style>
