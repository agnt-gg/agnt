<template>
  <!--
    CARD 01 · MODEL — "which model answers?"

    THE ONE IDEA IN THIS FILE
    ─────────────────────────
    Dynamic routing is NOT a separate section above the model pickers. It is the
    second answer to the question this card already asks: either you name the
    model, or Annie picks per request. Those are the same decision, so they are
    one control with two modes.

    Making routing its own card put the rarest decision (set once, maybe never)
    above the most common one (the reason anyone opens this page), and forced
    the pickers to sprout a paragraph explaining they were no longer the command
    whenever routing was on. As a mode, they simply are not rendered. Two
    states, no explanation needed.
  -->
  <SettingsCard num="01" title="Model" question="— which model answers?" hero>
    <template #value>
      <span class="model-head-value">
        <span class="model-head-dot" :class="{ 'is-dynamic': isDynamic }"></span>
        <span>{{ headValue }}</span>
      </span>
    </template>

    <div class="mode-row" role="radiogroup" aria-label="How the model is chosen">
      <button
        type="button"
        class="mode-btn"
        :class="{ active: !isDynamic }"
        role="radio"
        :aria-checked="!isDynamic ? 'true' : 'false'"
        @click="setMode('static')"
      >
        <span class="mode-title"><i class="fas fa-thumbtack"></i>Specific model</span>
        <span class="mode-hint">Always this exact provider and model.</span>
      </button>
      <button
        type="button"
        class="mode-btn"
        :class="{ active: isDynamic }"
        role="radio"
        :aria-checked="isDynamic ? 'true' : 'false'"
        @click="setMode('dynamic')"
      >
        <span class="mode-title"><i class="fas fa-bolt"></i>Let Annie choose</span>
        <span class="mode-hint">Best model per request — cost, quality, speed, availability.</span>
      </button>
    </div>

    <!-- ── SPECIFIC ─────────────────────────────────────────────────── -->
    <div v-if="!isDynamic" class="provider-selector">
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

      <div v-if="toolSupportWarning" class="tool-support-warning">
        <i class="fas fa-exclamation-triangle"></i>
        <span class="warning-text">{{ toolSupportWarning }}</span>
      </div>
    </div>

    <!-- ── DYNAMIC ──────────────────────────────────────────────────── -->
    <div v-else class="routing-pane">
      <div class="policy-row" role="radiogroup" aria-label="Routing policy">
        <button
          v-for="p in routingPolicies"
          :key="p.value"
          type="button"
          class="policy-btn"
          :class="{ active: routingPolicy === p.value }"
          role="radio"
          :aria-checked="routingPolicy === p.value ? 'true' : 'false'"
          @click="selectPolicy(p.value)"
        >
          <span class="policy-title">{{ p.label }}</span>
          <span class="policy-hint">{{ p.hint }}</span>
        </button>
      </div>

      <div class="routing-stats">
        <template v-if="routingStats && routingStats.decisions > 0">
          <div class="stat">
            <div class="stat-value">{{ routingStats.decisions }}</div>
            <div class="stat-label">Routed · 24h</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ formatUsd(routingStats.predictedUsd) }}</div>
            <div class="stat-label">Spent</div>
          </div>
          <div class="stat">
            <div class="stat-value is-good">{{ formatUsd(routingStats.savedUsd) }}</div>
            <div class="stat-label">Saved</div>
          </div>
          <span class="routing-stats-spacer"></span>
          <div v-if="routingStats.distribution.length" class="routing-dist">
            <span v-for="d in routingStats.distribution.slice(0, 4)" :key="d.provider + d.model" class="routing-dist-item">
              {{ Math.round(d.share * 100) }}% {{ d.model }}
            </span>
          </div>
          <!--
            Unpriced decisions are reported, never folded into the saving. A
            figure that treats "we don't know" as "we saved it" is why most
            routing savings claims cannot be reproduced.
          -->
          <div v-if="routingStats.unpricedDecisions > 0" class="routing-stats-caveat">
            {{ routingStats.unpricedDecisions }} decision(s) excluded — no published price for the model.
          </div>
        </template>
        <div v-else class="routing-stats-empty">
          No routed requests yet. Send a message and the numbers appear here.
        </div>
      </div>

      <div class="pin-note">
        <i class="fas fa-thumbtack"></i>
        <span class="pin-note-text">
          <b>Pinned chats and agents keep their own models.</b>
          Routing only fills the slot where Annie was about to guess — it never overrides a choice you made.
        </span>
      </div>
    </div>

    <CustomProviderDialog :is-open="isDialogOpen" :edit-provider="editingProvider" @close="closeDialog" @saved="handleProviderSaved" />
    <SimpleModal ref="simpleModal" />
  </SettingsCard>
</template>

<script>
import { computed, watch, onMounted, onUnmounted, ref, nextTick } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import SettingsCard from '@/views/_components/common/SettingsCard.vue';
import ProviderModelSearch from '@/components/common/ProviderModelSearch.vue';
import CustomProviderDialog from './CustomProviderDialog.vue';
import { AI_PROVIDERS_WITH_API, PROVIDER_FETCH_ACTIONS, PROVIDER_DISPLAY_NAMES, resolveProviderKey } from '@/store/app/aiProvider.js';
import { getToolSupportWarning } from '@/store/app/toolSupport.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import RefreshModelsButton from '@/components/common/RefreshModelsButton.vue';
import ReasoningControl from '@/components/common/ReasoningControl.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { DEPLOYMENT_CONFIG, API_CONFIG } from '@/tt.config.js';

export default {
  components: {
    CustomSelect,
    SettingsCard,
    CustomProviderDialog,
    ProviderModelSearch,
    Tooltip,
    RefreshModelsButton,
    ReasoningControl,
    SimpleModal,
  },
  setup() {
    const providerSelect = ref(null);
    const modelSelect = ref(null);
    const simpleModal = ref(null);
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
      const custom = store.state.aiProvider.customProviders || [];
      const customOptions = custom.map((provider) => ({
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

    // ── Dynamic provider routing ──────────────────────────────────────
    const routingMode = computed(() => store.state.aiProvider.routingMode || 'static');
    const routingPolicy = computed(() => store.state.aiProvider.routingPolicy || 'balanced');
    const isDynamic = computed(() => routingMode.value === 'dynamic');
    const routingStats = ref(null);

    const routingPolicies = [
      { value: 'save', label: 'Save money', hint: 'Cheapest model that can do the job' },
      { value: 'balanced', label: 'Balanced', hint: 'Cost and quality weighed evenly' },
      { value: 'quality', label: 'Best quality', hint: 'Prefer the strongest capable model' },
    ];

    /**
     * The card header always states the CURRENT ANSWER, so the page is readable
     * without opening or scrolling anything.
     */
    const headValue = computed(() => {
      if (isDynamic.value) {
        const p = routingPolicies.find((x) => x.value === routingPolicy.value);
        return `Annie chooses · ${p ? p.label : 'Balanced'}`;
      }
      const provider = PROVIDER_DISPLAY_NAMES[selectedProvider.value] || selectedProvider.value;
      if (!provider) return 'Not set';
      return selectedModel.value ? `${provider} · ${selectedModel.value}` : provider;
    });

    /**
     * Money is rendered from the ledger or not at all.
     *
     * Sub-cent amounts get four decimals rather than rounding to "$0.00" — a
     * real saving displayed as zero is indistinguishable from a broken feature.
     */
    const formatUsd = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return '—';
      if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
      return `$${n.toFixed(2)}`;
    };

    const loadRoutingStats = async () => {
      if (routingMode.value !== 'dynamic') return;
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const res = await fetch(`${API_CONFIG.BASE_URL}/routing/summary?hours=24`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        routingStats.value = await res.json();
      } catch (e) {
        // The panel simply shows nothing rather than a fabricated figure.
        console.warn('[Routing] Could not load summary:', e);
      }
    };

    const setMode = async (mode) => {
      const next = mode === 'dynamic' ? 'dynamic' : 'static';
      if (next === routingMode.value) return;
      await store.dispatch('aiProvider/setRoutingMode', next);
      if (next === 'dynamic') await loadRoutingStats();
      else routingStats.value = null;
    };

    const selectPolicy = async (value) => {
      if (value === routingPolicy.value) return;
      await store.dispatch('aiProvider/setRoutingPolicy', value);
    };

    onMounted(loadRoutingStats);
    watch(routingMode, (m) => {
      if (m === 'dynamic') loadRoutingStats();
      // Returning to the specific pane re-mounts the CustomSelects, which start
      // empty until they are told what is selected.
      else updateCustomSelects();
    });

    return {
      routingMode,
      routingPolicy,
      isDynamic,
      routingPolicies,
      routingStats,
      headValue,
      setMode,
      selectPolicy,
      formatUsd,
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
      simpleModal,
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
/* ── header value ─────────────────────────────────────────────────────── */
.model-head-value {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-family-mono);
  font-size: 0.72em;
  color: var(--color-text-muted);
}

.model-head-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-green);
  flex: 0 0 auto;
}

/* ── mode switch ──────────────────────────────────────────────────────── */
.mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 20px;
}

.mode-btn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  text-align: left;
  padding: 12px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.mode-btn:hover {
  border-color: var(--color-light-med-navy);
}

.mode-btn.active {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
}

.mode-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  font-weight: 500;
  color: var(--color-text);
}

.mode-title i {
  font-size: 0.8em;
  color: var(--color-green);
}

.mode-hint {
  font-size: 0.75em;
  line-height: 1.45;
  color: var(--color-med-navy);
}

/* ── specific pane ────────────────────────────────────────────────────── */
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

.btn-add-provider {
  padding: 6px 12px;
  background: transparent;
  color: var(--color-green);
  border: 1px dashed rgba(var(--green-rgb), 0.4);
  border-radius: 5px;
  font-family: inherit;
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
  display: flex;
  gap: 6px;
  align-items: center;
}

.btn-edit-provider,
.btn-delete-provider {
  padding: 5px 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--color-med-navy);
  font-size: 0.8em;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-edit-provider:hover {
  background: rgba(127, 129, 147, 0.15);
  color: var(--color-light-med-navy);
  border-color: var(--color-light-med-navy);
}

.btn-delete-provider:hover {
  background: rgba(254, 78, 78, 0.15);
  color: var(--color-red);
  border-color: rgba(254, 78, 78, 0.5);
}

.tool-support-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 215, 0, 0.08);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 6px;
  font-size: 0.85em;
}

.tool-support-warning i {
  color: var(--color-yellow);
  flex-shrink: 0;
  margin-top: 2px;
}

.warning-text {
  color: var(--color-text-muted);
  line-height: 1.45;
}

/* ── dynamic pane ─────────────────────────────────────────────────────── */
.routing-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.policy-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.policy-btn {
  padding: 11px 13px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.policy-btn:hover {
  border-color: var(--color-light-med-navy);
}

.policy-btn.active {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
}

.policy-title {
  display: block;
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-text);
}

.policy-hint {
  display: block;
  margin-top: 3px;
  font-size: 0.72em;
  line-height: 1.4;
  color: var(--color-med-navy);
}

.routing-stats {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
}

.stat-value {
  font-family: var(--font-family-mono);
  font-size: 1.05em;
  color: var(--color-text);
}

.stat-value.is-good {
  color: var(--color-green);
}

.stat-label {
  margin-top: 2px;
  font-size: 0.68em;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-dull);
}

.routing-stats-spacer {
  flex: 1;
}

.routing-dist {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.routing-dist-item {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--surface-hover);
  font-family: var(--font-family-mono);
  font-size: 0.68em;
  color: var(--color-med-navy);
}

.routing-stats-caveat {
  width: 100%;
  padding-top: 10px;
  border-top: 1px solid var(--terminal-border-color);
  font-size: 0.7em;
  color: var(--color-text-dull);
}

.routing-stats-empty {
  font-size: 0.78em;
  color: var(--color-med-navy);
}

.pin-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(var(--green-rgb), 0.08);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  font-size: 0.85em;
}

.pin-note i {
  color: var(--color-green);
  flex-shrink: 0;
  margin-top: 2px;
}

.pin-note-text {
  color: var(--color-text-muted);
  line-height: 1.45;
}

.pin-note-text b {
  color: var(--color-text);
  font-weight: 600;
}

@media (max-width: 760px) {
  .mode-row,
  .policy-row {
    grid-template-columns: 1fr;
  }
}
</style>
