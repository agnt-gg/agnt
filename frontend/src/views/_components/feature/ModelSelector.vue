<template>
  <div id="model-selector" class="field-group model-selector">
    <div class="select-wrapper">
      <p class="label">Provider:</p>
      <CustomSelect
        :options="providerOptions"
        :model-value="shownProvider"
        placeholder="Select Provider"
        @option-selected="updateSelectorProvider"
        @connect-option="connectFromPicker"
      />
    </div>
    <div class="select-wrapper">
      <p class="label">Model:</p>
      <CustomSelect :options="modelOptions" :model-value="shownModel" placeholder="Select Model" @option-selected="updateSelectorModel" />
    </div>
    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { useStore } from 'vuex';
import { computed, ref, watch } from 'vue';
import { PROVIDER_DISPLAY_NAMES, providerNeedsConnecting } from '@/store/app/aiProvider.js';
import { useProviderPickerConnect } from '@/composables/useProviderPickerConnect.js';

/**
 * The "Default AI" choice (allowDefault): stored as an EMPTY provider and model,
 * which the backend runs on the account's selected AI at call time
 * (CustomToolExecutor -> resolveAccountAi). So the tool follows whatever the
 * user selects later, instead of the model selected the day it was made.
 */
export const DEFAULT_AI = '__default_ai__';

export default {
  components: {
    CustomSelect,
    SimpleModal,
  },
  props: {
    provider: {
      type: String,
      default: '',
    },
    model: {
      type: String,
      default: '',
    },
    /** Offer "Default AI" (empty provider = the user's selected AI, resolved when it runs). */
    allowDefault: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:provider', 'update:model'],
  setup(props, { emit }) {
    const store = useStore();
    const simpleModal = ref(null);
    let latestSync = 0;

    const connectedProviders = computed(() => store.getters['appAuth/connectedApps'] ?? store.state.appAuth?.connectedApps ?? []);
    const providers = computed(() => store.getters['aiProvider/filteredProviders'] || []);

    const modelIdsFor = (provider) =>
      (store.state.aiProvider.allModels?.[provider] || [])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.id || entry?.name))
        .filter(Boolean);

    const followsDefault = computed(() => props.allowDefault && !props.provider);
    const globalAiLabel = computed(() => {
      const { selectedProvider, selectedModel } = store.state.aiProvider || {};
      if (!selectedProvider) return 'Your selected model';
      const name = PROVIDER_DISPLAY_NAMES[selectedProvider] || selectedProvider;
      return selectedModel ? `${name} · ${selectedModel}` : name;
    });
    const shownProvider = computed(() => (followsDefault.value ? DEFAULT_AI : props.provider));
    const shownModel = computed(() => (followsDefault.value ? DEFAULT_AI : props.model));

    const providerOptions = computed(() => {
      const list = props.provider && !providers.value.includes(props.provider) ? [props.provider, ...providers.value] : providers.value;
      const options = list.map((p) => ({
        label: PROVIDER_DISPLAY_NAMES[p] || p,
        value: p,
        connect: providerNeedsConnecting(p, connectedProviders.value),
      }));
      return props.allowDefault ? [{ label: 'Default AI', value: DEFAULT_AI }, ...options] : options;
    });

    const modelOptions = computed(() => {
      // Following the default: the model is whatever is selected app-wide, shown, not chosen here.
      if (followsDefault.value) return [{ label: globalAiLabel.value, value: DEFAULT_AI }];
      const ids = modelIdsFor(props.provider);
      const list = props.model && !ids.includes(props.model) ? [props.model, ...ids] : ids;
      return list.map((m) => ({ label: m, value: m }));
    });

    const isUsable = (provider) => Boolean(provider) && !providerNeedsConnecting(provider, connectedProviders.value);

    const defaultProvider = () => {
      const globalProvider = store.state.aiProvider.selectedProvider;
      if (providers.value.includes(globalProvider) && isUsable(globalProvider)) return globalProvider;
      return providers.value.find(isUsable) || '';
    };

    const loadModels = async (provider) => {
      try {
        await store.dispatch('aiProvider/fetchProviderModels', { provider });
      } catch (error) {
        console.error(`[ModelSelector] could not load models for ${provider}:`, error);
      }
    };

    const syncToProvider = async (provider) => {
      const sync = ++latestSync;
      if (!provider) {
        // Empty is a real choice here ("Default AI"), never a gap to fill.
        if (props.allowDefault) return;
        if (!connectedProviders.value.length) await store.dispatch('appAuth/fetchConnectedApps');
        if (sync !== latestSync) return;
        const fallback = defaultProvider();
        if (fallback) emit('update:provider', fallback);
        return;
      }
      await loadModels(provider);
      if (sync !== latestSync || props.model) return;
      const firstModel = modelIdsFor(provider)[0];
      if (firstModel) emit('update:model', firstModel);
    };

    watch(() => props.provider, syncToProvider, { immediate: true });

    const updateSelectorProvider = (option) => {
      const picked = option?.value;
      if (picked === DEFAULT_AI) {
        if (followsDefault.value) return;
        emit('update:model', '');
        emit('update:provider', '');
        return;
      }
      const provider = picked;
      if (!provider || provider === props.provider) return;
      emit('update:model', '');
      emit('update:provider', provider);
    };

    const updateSelectorModel = (option) => {
      if (option?.value === DEFAULT_AI) return;
      if (option?.value && option.value !== props.model) emit('update:model', option.value);
    };

    // Connecting picks the provider HERE only, like any other pick in this
    // selector; the global default is never touched.
    const { connectFromPicker } = useProviderPickerConnect(simpleModal, {
      select: updateSelectorProvider,
      currentSelection: () => props.provider,
    });

    return {
      shownProvider,
      shownModel,
      providerOptions,
      modelOptions,
      updateSelectorProvider,
      updateSelectorModel,
      connectFromPicker,
      simpleModal,
    };
  },
};
</script>

<style scoped>
.field-group.model-selector {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: space-evenly;
  align-items: flex-start;
  width: 100%;
  border: none;
  color: var(--text-primary);
  padding: 0;
  border-radius: 0px;
}

body[data-page='terminal-chat'] .field-group.model-selector {
  width: calc(100% - 18px);
  padding: 8px;
  border: 1px solid var(--terminal-border-color);
}

body[data-page='terminal-chat'].dark .field-group.model-selector {
  border: 1px solid var(--color-dull-navy);
}

.select-wrapper {
  display: flex;
  flex-direction: column;
  margin-right: 0;
  width: 50%;
  gap: 8px;
}

.select-wrapper label {
  margin-bottom: 4px;
  font-size: 14px;
}

select {
  padding: 7px 0px 5px 4px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background-color: var(--color-darker-0);
  color: var(--text-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  width: inherit;
}

select option {
  font-weight: 400;
}

body.dark select option {
  font-weight: 300;
}

body.dark select {
  background-color: var(--color-darker-0);
  border: 1px solid var(--color-dull-navy);
  font-weight: 300;
}

body[data-page='terminal-agent-forge'] .field-group.model-selector {
  font-size: 15px;
  font-weight: 500;
}

.custom-select .option.disabled {
  color: var(--color-text-muted);
  font-style: italic;
}
</style>

<style>
#template-fields div#model-selector .custom-select .selected {
  margin-top: -5px;
}
#template-fields div#model-selector .custom-select .selected::after {
  top: 14px;
}
#template-fields div#model-selector .custom-select .option-inner {
  margin-top: -4px;
}
</style>
