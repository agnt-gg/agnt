<template>
  <div id="model-selector" class="field-group model-selector">
    <div class="select-wrapper">
      <p class="label">Provider:</p>
      <CustomSelect :options="providerOptions" placeholder="Select Provider" @option-selected="updateSelectorProvider" ref="providerSelect" />
    </div>
    <div class="select-wrapper">
      <p class="label">Model:</p>
      <CustomSelect :options="modelOptions" placeholder="Select Model" @option-selected="updateSelectorModel" ref="modelSelect" />
    </div>
  </div>
</template>

<script>
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { useStore } from 'vuex';
import { computed, onMounted, ref, watch } from 'vue';

export default {
  components: {
    CustomSelect,
  },
  /**
   * initialProvider/initialModel are only used to initialize the UI for the Model Selector.
   * They have NO impact on the global provider/model stored in localStorage.
   */
  props: {
    initialProvider: {
      type: String,
      default: '',
    },
    initialModel: {
      type: String,
      default: '',
    },
  },
  // We removed any event emission that could alter the global state.
  emits: [],
  setup(props) {
    const store = useStore();

    // Local UI variables for the Model Selector.
    const localProvider = ref(props.initialProvider);
    const localModel = ref(props.initialModel);
    const providerSelect = ref(null);
    const modelSelect = ref(null);

    const connectedProviders = computed(() => store.state.appAuth.connectedApps);
    const providers = computed(() => store.state.aiProvider.providers);
    const modelsByProvider = computed(() => store.state.aiProvider.allModels);

    // Get the global provider from the aiProvider module.
    const globalProvider = computed(() => store.state.aiProvider.selectedProvider);

    // The list of available models is based solely on the component’s own provider selection.
    const availableModels = computed(() => modelsByProvider.value[localProvider.value] || []);

    const providerOptions = computed(() =>
      providers.value.map((p) => ({
        label: `${p}${connectedProviders.value.includes(p.toLowerCase()) ? '' : ' (not connected)'}`,
        value: p,
        disabled: !connectedProviders.value.includes(p.toLowerCase()),
      }))
    );

    const modelOptions = computed(() => availableModels.value.map((m) => ({ label: m, value: m })));

    /**
     * When the user selects a provider from the dropdown,
     * only update the local provider and then update the local model.
     * (No event is emitted so the global provider is not affected.)
     */
    const updateSelectorProvider = async (option) => {
      const newProvider = option.value;
      if (newProvider !== localProvider.value) {
        localProvider.value = newProvider;
        if (providerSelect.value?.setSelectedOption) {
          providerSelect.value.setSelectedOption({
            label: newProvider,
            value: newProvider,
          });
        }

        // Fetch models for the new provider
        await store.dispatch('aiProvider/fetchProviderModels', { provider: newProvider });

        updateSelectorModels(newProvider);
      }
    };

    /**
     * Update the model dropdown based on the given provider.
     * Only update local state (without emitting any update).
     */
    const updateSelectorModels = (newProvider) => {
      const newModels = modelsByProvider.value[newProvider] || [];
      const newModel = newModels[0] || '';
      localModel.value = newModel;
      if (modelSelect.value?.setSelectedOption) {
        modelSelect.value.setSelectedOption({
          label: newModel,
          value: newModel,
        });
      }
    };

    /**
     * When the user picks a model manually, update only the local model.
     * (No update event is emitted so the global selectedModel remains untouched.)
     */
    const updateSelectorModel = (option) => {
      const newModel = option.value;
      if (newModel !== localModel.value) {
        localModel.value = newModel;
      }
    };

    onMounted(() => {
      store.dispatch('appAuth/fetchConnectedApps').then(async () => {
        // If many providers are connected and the global provider is among them,
        // default the Model Selector to display the same provider as the global one.
        if (connectedProviders.value.length > 1 && connectedProviders.value.includes(globalProvider.value.toLowerCase())) {
          if (!props.initialProvider) {
            localProvider.value = globalProvider.value;
          }
          if (providerSelect.value?.setSelectedOption) {
            providerSelect.value.setSelectedOption({
              label: globalProvider.value,
              value: globalProvider.value,
            });
          }

          // Ensure models are fetched
          await store.dispatch('aiProvider/fetchProviderModels', { provider: globalProvider.value });

          const defaultModel =
            modelsByProvider.value[globalProvider.value] && modelsByProvider.value[globalProvider.value][0]
              ? modelsByProvider.value[globalProvider.value][0]
              : '';
          if (!props.initialModel && defaultModel) {
            localModel.value = defaultModel;
            if (modelSelect.value?.setSelectedOption) {
              modelSelect.value.setSelectedOption({
                label: defaultModel,
                value: defaultModel,
              });
            }
          } else if (props.initialProvider) {
            updateSelectorModels(props.initialProvider);
          }
        }
        // Otherwise, if only one provider is connected, use that.
        else if (connectedProviders.value.length > 0) {
          const firstConnectedProvider = connectedProviders.value[0];
          const providerConfig = providers.value.find((p) => p.toLowerCase() === firstConnectedProvider);
          if (providerConfig) {
            if (!props.initialProvider) {
              localProvider.value = providerConfig;
            }
            if (providerSelect.value?.setSelectedOption) {
              providerSelect.value.setSelectedOption({
                label: providerConfig,
                value: providerConfig,
              });
            }

            // Ensure models are fetched
            await store.dispatch('aiProvider/fetchProviderModels', { provider: providerConfig });

            const defaultModel =
              modelsByProvider.value[providerConfig] && modelsByProvider.value[providerConfig][0] ? modelsByProvider.value[providerConfig][0] : '';
            if (!props.initialModel && defaultModel) {
              localModel.value = defaultModel;
              if (modelSelect.value?.setSelectedOption) {
                modelSelect.value.setSelectedOption({
                  label: defaultModel,
                  value: defaultModel,
                });
              }
            } else if (props.initialProvider) {
              updateSelectorModels(props.initialProvider);
            }
          }
        }
        // Fallback in the unlikely case that there are no connected providers.
        else if (!props.initialProvider && providers.value.length > 0) {
          localProvider.value = providers.value[0];
          if (providerSelect.value?.setSelectedOption) {
            providerSelect.value.setSelectedOption({
              label: providers.value[0],
              value: providers.value[0],
            });
          }

          // Ensure models are fetched
          await store.dispatch('aiProvider/fetchProviderModels', { provider: providers.value[0] });

          const defaultModel =
            modelsByProvider.value[providers.value[0]] && modelsByProvider.value[providers.value[0]][0]
              ? modelsByProvider.value[providers.value[0]][0]
              : '';
          if (!props.initialModel && defaultModel) {
            localModel.value = defaultModel;
            if (modelSelect.value?.setSelectedOption) {
              modelSelect.value.setSelectedOption({
                label: defaultModel,
                value: defaultModel,
              });
            }
          }
        } else if (props.initialProvider) {
          // Ensure models are fetched for initial provider
          await store.dispatch('aiProvider/fetchProviderModels', { provider: props.initialProvider });
          updateSelectorModels(props.initialProvider);
        }
      });
    });

    // Optionally, watch for changes in the initialModel prop to update the UI.
    watch(
      () => props.initialModel,
      (newModel) => {
        if (newModel !== localModel.value) {
          localModel.value = newModel;
          if (modelSelect.value?.setSelectedOption) {
            modelSelect.value.setSelectedOption({
              label: newModel || availableModels.value[0] || '',
              value: newModel || availableModels.value[0] || '',
            });
          }
        }
      },
      { immediate: true }
    );

    return {
      providerOptions,
      modelOptions,
      updateSelectorProvider,
      updateSelectorModel,
      providerSelect,
      modelSelect,
      localProvider,
      localModel,
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
  color: var(--color-navy);
  padding: 0;
  border-radius: 0px;
}

body[data-page='chat'] .field-group.model-selector {
  width: calc(100% - 18px);
  padding: 8px;
  border: 1px solid var(--color-light-navy);
}

body[data-page='chat'].dark .field-group.model-selector {
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
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  background-color: var(--color-ultra-light-navy);
  color: var(--color-navy);
  font-family: 'League Spartan', sans-serif;
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
  background-color: var(--color-ultra-dark-navy);
  border: 1px solid var(--color-dull-navy);
  font-weight: 300;
}

body[data-page='create'] .field-group.model-selector {
  font-size: 15px;
  font-weight: 500;
}

.custom-select .option.disabled {
  color: #999;
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
