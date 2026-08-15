<template>
  <div class="chat-provider-selector" :class="{ 'no-offset': cleanPosition }" ref="selectorRef">
    <div class="provider-dropdown" :class="{ open: isOpen }" v-viewport-clamp>
      <div class="dropdown-header">
        <span class="dropdown-title">AI Provider</span>
        <Tooltip text="Close" width="auto">
          <button @click="closeDropdown" class="close-btn">
            <i class="fas fa-times"></i>
          </button>
        </Tooltip>
      </div>

      <div class="dropdown-content">
        <div v-if="activeMode === 'default'" class="routing-mode-note">
          Following your global setting:
          <strong>{{ globalProviderDisplayName }}</strong>
          <span v-if="globalModel"> · {{ globalModel }}</span>
          <div v-if="globalRoutingMode === 'dynamic'" class="routing-mode-sub">
            <i class="fas fa-bolt"></i> Global routing is Dynamic, so this chat routes too.
          </div>
        </div>

        <div v-else-if="activeMode === 'dynamic'" class="routing-mode-note">
          Annie picks the best model for each request — balancing cost, quality,
          speed and availability.
          <div class="routing-mode-sub">
            <i class="fas fa-thumbtack"></i> Pinned chats and agents keep their own models.
          </div>
        </div>

        <!-- Everything below is the PINNED experience, unchanged. -->
        <template v-if="activeMode === 'pinned'">
        <!-- Current Selection Display -->
        <div class="current-selection">
          <div class="selection-label">Current:</div>
          <div class="selection-value">
            <span class="provider-name">{{ selectedProviderDisplayName }}</span>
            <span v-if="selectedProvider" class="model-name">{{ selectedModel || 'No model' }}</span>
          </div>
        </div>

        <!-- Conversation-scoped mode: override status + reset -->
        <div v-if="scopedAi" class="conv-override-row">
          <span class="conv-override-pill"><i class="fas fa-thumbtack"></i> This chat only</span>
          <button class="conv-override-reset" @click="resetConversationAi">Reset to default</button>
        </div>
        <div v-else-if="conversationId" class="conv-scope-hint">
          Choices here apply to this conversation only
        </div>

        <!-- Quick search across all providers + models -->
        <ProviderModelSearch class="chat-provider-search" :apply-globally="!conversationId" @selected="handleSearchSelected" />

        <!-- Provider Selector -->
        <div class="selector-group">
          <label>Provider:</label>
          <CustomSelect
            ref="providerSelect"
            :options="providerOptions"
            :placeholder="selectedProviderDisplayName || 'Select Provider'"
            :zIndex="10001"
            maxHeight="156px"
            @option-selected="handleProviderSelected"
          />
        </div>

        <!-- Model Selector -->
        <div class="selector-group">
          <div class="selector-label-row">
            <label>Model:</label>
            <RefreshModelsButton :provider="selectedProvider" size="sm" variant="icon" />
          </div>
          <CustomSelect
            ref="modelSelect"
            :options="modelOptions"
            :placeholder="isLoadingModels ? 'Loading models...' : selectedModel || 'Select Model'"
            :zIndex="10001"
            maxHeight="156px"
            @option-selected="handleModelSelected"
          />
        </div>

        <div class="selector-group">
          <ReasoningControl v-if="selectedReasoningControl" :provider="selectedProvider" :model="selectedModel" compact :show-hint="false" />
          <div v-else class="reasoning-fallback">
            <label>Reasoning</label>
            <div class="reasoning-fallback-message">{{ reasoningStatusText }}</div>
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

        <!--
          Custom Provider Actions Row — INSIDE the pinned block.

          Adding, editing or deleting a provider only means anything when you
          are choosing one by hand. In Default and Dynamic the user has
          explicitly said "I am not picking", so a provider-management row
          there is an action with no visible consequence.
        -->
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
        </template>

        <!--
          MODE — the tri-state that was missing, and the last thing in the
          panel by design.

          "Default" was previously unreachable: every send pinned a concrete
          pair, so a chat given a model could never be handed back to the
          global setting. Dynamic routing needs that same absent state, so one
          control delivers both.

          It sits at the BOTTOM because the popup is anchored by its
          bottom-right corner: the row nearest that corner is the one that
          holds still while the panel above it grows and shrinks with the
          selected mode. Ordering it first put the control furthest from the
          fixed edge, so it was the part that appeared to move most.
        -->
        <div class="routing-mode-row" role="radiogroup" aria-label="Model selection mode">
          <button
            v-for="opt in modeOptions"
            :key="opt.value"
            class="routing-mode-btn"
            :class="{ active: activeMode === opt.value }"
            role="radio"
            :aria-checked="activeMode === opt.value ? 'true' : 'false'"
            @click="selectMode(opt.value)"
          >
            <i :class="opt.icon"></i>
            <span>{{ opt.label }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Custom Provider Dialog -->
    <CustomProviderDialog :is-open="isDialogOpen" :edit-provider="editingProvider" @close="closeDialog" @saved="handleProviderSaved" />

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import { computed, watch, onMounted, onUnmounted, ref, nextTick } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import ProviderModelSearch from '@/components/common/ProviderModelSearch.vue';
import CustomProviderDialog from '../../Settings/components/ProviderSelector/CustomProviderDialog.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import RefreshModelsButton from '@/components/common/RefreshModelsButton.vue';
import ReasoningControl from '@/components/common/ReasoningControl.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { AI_PROVIDERS_WITH_API, PROVIDER_FETCH_ACTIONS, PROVIDER_DISPLAY_NAMES, resolveProviderKey } from '@/store/app/aiProvider.js';
import { getToolSupportWarning } from '@/store/app/toolSupport.js';
import { DEPLOYMENT_CONFIG } from '@/tt.config.js';
import {
  getChannelConfig,
  setChannelProvider,
  setChannelModel,
  setChannelMode,
  resolveChannelMode,
} from '@/services/chatChannelConfig.js';

export default {
  name: 'ChatProviderSelector',
  components: {
    CustomSelect,
    CustomProviderDialog,
    ProviderModelSearch,
    Tooltip,
    RefreshModelsButton,
    ReasoningControl,
    SimpleModal,
  },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    // When true the dropdown places its visible popup exactly at the root
    // element's position (top/left from the parent). The default mode keeps the
    // legacy negative-margin offset that the orchestrator chat relies on to
    // pop the panel up-and-left from the trigger button.
    cleanPosition: {
      type: Boolean,
      default: false,
    },
    // When set, the selector reads/writes this channel's saved provider/model
    // (chatChannelConfig.js). Each chat surface gets its own remembered choice;
    // global Vuex aiProvider remains the fallback for unconfigured channels.
    channelKey: {
      type: String,
      default: '',
    },
    // When set, the selector operates in CONVERSATION-SCOPED mode: picks
    // write a per-conversation AI override (chat/aiByConv + backend
    // conversation_settings) and never touch the global Vuex selection or
    // the channel config. Display falls back to the global selection while
    // no override exists.
    conversationId: {
      type: String,
      default: '',
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const store = useStore();
    const selectorRef = ref(null);
    const providerSelect = ref(null);
    const modelSelect = ref(null);
    const simpleModal = ref(null);
    const isLocalServerRunning = ref(false);
    const isDialogOpen = ref(false);
    const editingProvider = ref(null);

    const providers = computed(() => store.getters['aiProvider/filteredProviders']);
    const customProviders = computed(() => store.state.aiProvider.customProviders || []);
    const connectedProviders = computed(() => store.state.appAuth.connectedApps);
    const connectedProvidersLower = computed(() => connectedProviders.value.map((p) => p.toLowerCase()));

    // Conversation-scoped override (atomic { provider, model } or null).
    const scopedAi = computed(() =>
      props.conversationId ? store.state.chat?.aiByConv?.[props.conversationId] || null : null,
    );

    const selectedProvider = computed(() => scopedAi.value?.provider || store.state.aiProvider.selectedProvider);
    const selectedModel = computed(() =>
      scopedAi.value ? scopedAi.value.model : store.state.aiProvider.selectedModel,
    );

    // Get display name for the selected provider (handles custom providers showing UUID)
    const selectedProviderDisplayName = computed(() => {
      if (!selectedProvider.value) return 'None';

      // Check if it's a custom provider (UUID format)
      const customProvider = customProviders.value.find((p) => p.id === selectedProvider.value);
      if (customProvider) {
        return customProvider.provider_name;
      }

      // For built-in providers, apply display name mapping
      return PROVIDER_DISPLAY_NAMES[selectedProvider.value] || selectedProvider.value;
    });
    // Keyed on the EFFECTIVE provider (scoped override wins) — the global
    // getter reads state.selectedProvider and would list the wrong provider's
    // models while a conversation override is active.
    const filteredModels = computed(() => store.state.aiProvider.allModels[selectedProvider.value] || []);
    const isLoadingModels = computed(() => store.state.aiProvider.loadingModels[selectedProvider.value] || false);
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

      // Built-in providers check — resolve display name to key for comparison
      // e.g. selectedProvider "Z-AI" → key "zai" to match connectedApps ["zai"]
      const providerKey = resolveProviderKey(selectedProvider.value);
      return connectedProvidersLower.value.includes(providerKey);
    });

    // Check local server status using the actual LM Studio API endpoint
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

    // Transform providers into CustomSelect options format
    const providerOptions = computed(() => {
      // Built-in providers
      const builtInOptions = providers.value.map((provider) => ({
        label: PROVIDER_DISPLAY_NAMES[provider] || provider,
        value: provider,
        disabled: provider.toLowerCase() === 'local' ? false : !connectedProvidersLower.value.includes(resolveProviderKey(provider)),
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
      return filteredModels.value.map((model) => ({
        label: model,
        value: model,
        disabled: false,
      }));
    });

    // Handle provider selection. Always update Vuex (so any code reading the
    // global selection still works) AND persist to the per-channel config so
    // this chat remembers the choice next time it's opened.
    const handleProviderSelected = async (option) => {
      if (option.disabled) return;
      if (props.conversationId) {
        // Conversation-scoped: pin { provider, first-available-model } to this
        // conversation. Global Vuex and channel config stay untouched.
        const providerId = option.value;
        let models = store.state.aiProvider.allModels[providerId] || [];
        if (models.length === 0) {
          const action = PROVIDER_FETCH_ACTIONS[providerId];
          const isCustom = customProviders.value.some((p) => p.id === providerId);
          try {
            if (action) await store.dispatch(action);
            else if (isCustom) await store.dispatch('aiProvider/fetchCustomProviderModels', providerId);
          } catch (error) {
            console.error(`Failed to fetch ${providerId} models:`, error);
          }
          models = store.state.aiProvider.allModels[providerId] || [];
        }
        store.dispatch('chat/setConversationAi', {
          conversationId: props.conversationId,
          provider: providerId,
          model: models[0] || null,
        });
        return;
      }
      store.dispatch('aiProvider/setProvider', option.value);
      if (props.channelKey) setChannelProvider(props.channelKey, option.value);
    };

    const handleModelSelected = (option) => {
      if (option.disabled) return;
      if (props.conversationId) {
        store.dispatch('chat/setConversationAi', {
          conversationId: props.conversationId,
          provider: selectedProvider.value,
          model: option.value,
        });
        return;
      }
      store.dispatch('aiProvider/setModel', option.value);
      if (props.channelKey) setChannelModel(props.channelKey, option.value);
    };

    // Quick-search pick in scoped mode — the search component skipped the
    // global dispatches (applyGlobally=false) and hands us the pair here.
    const handleSearchSelected = (result) => {
      if (!props.conversationId || !result) return;
      store.dispatch('chat/setConversationAi', {
        conversationId: props.conversationId,
        provider: result.provider,
        model: result.model,
      });
    };

    const resetConversationAi = () => {
      if (!props.conversationId) return;
      store.dispatch('chat/clearConversationAi', { conversationId: props.conversationId });
    };

    // ── ROUTING MODE ──────────────────────────────────────────────────
    // Channel config lives in localStorage, which Vue cannot observe. This
    // counter is the reactivity handle for it.
    const channelModeTick = ref(0);

    const modeOptions = [
      { value: 'default', label: 'Default', icon: 'fas fa-globe' },
      { value: 'dynamic', label: 'Dynamic', icon: 'fas fa-bolt' },
      { value: 'pinned', label: 'Specific', icon: 'fas fa-thumbtack' },
    ];

    const globalRoutingMode = computed(() => store.state.aiProvider?.routingMode || 'static');
    const globalModel = computed(() => store.state.aiProvider?.selectedModel || '');
    const globalProviderDisplayName = computed(() => {
      const p = store.state.aiProvider?.selectedProvider;
      return p ? (PROVIDER_DISPLAY_NAMES[p] || p) : 'Not set';
    });

    /**
     * Which mode this surface is in.
     *
     * Conversation scope and channel scope are read from their own stores. In
     * BOTH, an existing provider/model pair means 'pinned' — that is how every
     * chat saved before this control existed was stored, and treating those as
     * anything else would silently move a model the user deliberately chose.
     */
    const activeMode = computed(() => {
      if (props.conversationId) {
        if (scopedAi.value) return 'pinned';
        return store.state.chat?.routingModeByConv?.[props.conversationId] || 'default';
      }
      if (props.channelKey) {
        channelModeTick.value; // eslint-disable-line no-unused-expressions -- reactivity dependency
        return resolveChannelMode(getChannelConfig(props.channelKey));
      }
      // The global settings surface has no scope of its own; it always edits a
      // concrete pair.
      return 'pinned';
    });

    const selectMode = (mode) => {
      if (mode === activeMode.value) return;
      if (props.conversationId) {
        store.dispatch('chat/setConversationRoutingMode', {
          conversationId: props.conversationId,
          mode,
        });
        return;
      }
      if (props.channelKey) {
        setChannelMode(props.channelKey, mode);
        // localStorage writes are invisible to Vue's reactivity, so nudge the
        // computed. Without this the buttons do not move until the panel is
        // reopened, which reads as a dead control.
        channelModeTick.value += 1;
      }
    };

    // Restore the channel's saved provider/model into Vuex so the rest of the
    // chat (request payload, model badges, reasoning controls) reflects this
    // chat's choice rather than whatever the previous chat left in Vuex.
    const restoreChannelConfig = () => {
      // Conversation-scoped mode never smears its selection into global Vuex —
      // the scoped computeds already display the right pair.
      if (props.conversationId) return;
      if (!props.channelKey) return;
      const cfg = getChannelConfig(props.channelKey);
      if (!cfg) return;
      if (cfg.provider && cfg.provider !== store.state.aiProvider.selectedProvider) {
        store.dispatch('aiProvider/setProvider', cfg.provider);
      }
      if (cfg.model && cfg.model !== store.state.aiProvider.selectedModel) {
        store.dispatch('aiProvider/setModel', cfg.model);
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

    // Sync selects immediately when dropdown opens
    watch(
      () => props.isOpen,
      (open) => {
        if (open) {
          restoreChannelConfig();
          updateCustomSelects();
        }
      },
    );

    // When the active channel changes (e.g. parent chat switches surfaces
    // while this selector is mounted), reload that channel's saved provider.
    watch(
      () => props.channelKey,
      () => restoreChannelConfig(),
    );

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

      // Ensure models are loaded for the current provider
      if (selectedProvider.value && filteredModels.value.length === 0) {
        const action = PROVIDER_FETCH_ACTIONS[selectedProvider.value];
        if (action) {
          try {
            await store.dispatch(action);
          } catch (error) {
            console.error(`Failed to fetch models for ${selectedProvider.value} on mount:`, error);
          }
        } else {
          const isCustom = customProviders.value.some((p) => p.id === selectedProvider.value);
          if (isCustom) {
            try {
              await store.dispatch('aiProvider/fetchCustomProviderModels', selectedProvider.value);
            } catch (error) {
              console.error('Failed to fetch custom provider models on mount:', error);
            }
          }
        }
      }

      // Initialize CustomSelect components
      updateCustomSelects();

      // Add event listeners
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscape);

      // Poll for local server status (check every 60 seconds)
      localServerCheckInterval = setInterval(() => {
        checkLocalServer();
      }, 60000);
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

    // Delete current custom provider
    const deleteCurrentProvider = async () => {
      if (!selectedProvider.value) return;

      const currentProvider = customProviders.value.find((p) => p.id === selectedProvider.value);
      if (!currentProvider) return;

      // Confirm deletion
      const confirmed = await simpleModal.value?.showModal({
        title: 'Delete Provider?',
        message: `Are you sure you want to delete "${currentProvider.provider_name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });
      if (!confirmed) return;

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
        await simpleModal.value?.showModal({
          title: 'Delete Failed',
          message: 'Failed to delete custom provider: ' + error.message,
          confirmText: 'OK',
          showCancel: false,
        });
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
      simpleModal,
      selectedProvider,
      selectedModel,
      selectedProviderDisplayName,
      providerOptions,
      modelOptions,
      isLoadingModels,
      selectedReasoningControl,
      reasoningStatusText,
      isProviderConnected,
      handleProviderSelected,
      handleModelSelected,
      handleSearchSelected,
      resetConversationAi,
      modeOptions,
      activeMode,
      selectMode,
      globalRoutingMode,
      globalModel,
      globalProviderDisplayName,
      scopedAi,
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
      PROVIDER_DISPLAY_NAMES,
    };
  },
};
</script>

<style scoped>
.chat-provider-selector {
  position: fixed;
  z-index: 10000;
}

/* Routing mode selector — Default / Dynamic / Specific.

   Uses this component's own idiom: --color-darker-0 for a recessed surface and
   --terminal-border-color for a border, the same pair .dropdown-header and
   .provider-dropdown already use a few rules below.

   NOT --color-border: it is declared once, in themes/_core.css, and NO theme
   overrides it — so it stays core's --color-light-navy in dark, cyberpunk,
   ember, hacker, light, midnight, nord and rose alike. That is the wrong-
   coloured border. --terminal-border-color is the token every theme redefines,
   which is what makes it the app's border. */
.routing-mode-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 3px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

.routing-mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 6px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--color-med-navy);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}

.routing-mode-btn i {
  font-size: 11px;
  opacity: 0.85;
}

.routing-mode-btn:hover {
  color: var(--color-light-med-navy);
}

/* The app's active-chip idiom, verbatim from .preset-chip.active and .fb-tier:
   a green tint, green text, green border. Not a solid accent fill. */
.routing-mode-btn.active {
  background: rgba(var(--green-rgb), 0.12);
  color: var(--color-green);
}

.routing-mode-note {
  padding: 9px 11px;
  background: var(--color-darker-0);
  border-left: 2px solid var(--color-green);
  border-radius: 4px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.routing-mode-note strong {
  color: var(--color-text);
  font-weight: 600;
}

.routing-mode-sub {
  margin-top: 5px;
  font-size: 11px;
  opacity: 0.8;
}

.routing-mode-sub i {
  margin-right: 4px;
  color: var(--color-green);
}

/* Conversation-scoped override indicator */
.conv-override-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.conv-override-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-blue, #4a9eff);
  background: color-mix(in srgb, var(--color-blue, #4a9eff) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-blue, #4a9eff) 35%, transparent);
  white-space: nowrap;
}

.conv-override-pill i {
  font-size: 9px;
}

.conv-override-reset {
  background: none;
  border: none;
  padding: 2px 4px;
  font-size: 11px;
  color: var(--color-lighter-3, #999);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.conv-override-reset:hover {
  color: var(--color-lightest, #fff);
}

.conv-scope-hint {
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--color-lighter-3, #888);
  font-style: italic;
}

/* When the parent positions the root precisely (e.g. UnifiedChatContainer
   computing top/left to fit the sidebar viewport), drop the legacy offset
   that was tuned for the orchestrator chat's trigger-button geometry. */
.chat-provider-selector.no-offset .provider-dropdown {
  margin-top: 0;
  margin-left: 0;
}

.provider-dropdown {
  margin-top: -202px;
  margin-left: -156px;
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
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.15);
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

.reasoning-fallback {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reasoning-fallback-message {
  min-height: 34px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  border: 1px dashed var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-med-navy);
  font-size: 0.85em;
  line-height: 1.35;
}

.selector-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  border: 1px dashed rgba(var(--green-rgb), 0.4);
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
  background: rgba(var(--green-rgb), 0.1);
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
  color: var(--color-yellow);
  font-size: 1em;
  flex-shrink: 0;
  margin-top: 2px;
}

.tool-support-warning .warning-text {
  color: var(--color-yellow);
  line-height: 1.4;
}
</style>
