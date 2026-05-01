<template>
  <div v-if="control || showUnavailableState" class="reasoning-control" :class="{ compact, 'without-hint': !showHint, unavailable: showUnavailableState && !control }">
    <label class="reasoning-label" :for="selectId">Reasoning</label>
    <CustomSelect
      v-if="control"
      ref="selectRef"
      :options="control.options"
      :placeholder="effectiveLabel"
      :zIndex="10001"
      maxHeight="220px"
      @option-selected="handleSelected"
    />
    <div v-else class="reasoning-unavailable-message">{{ unavailableMessage }}</div>
    <span v-if="showHint" class="reasoning-hint">{{ hintText }}</span>
  </div>
</template>

<script>
import { computed, nextTick, ref, watch } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';

let nextReasoningControlId = 0;

export default {
  name: 'ReasoningControl',
  components: { CustomSelect },
  props: {
    provider: {
      type: String,
      default: null,
    },
    model: {
      type: String,
      default: null,
    },
    compact: {
      type: Boolean,
      default: false,
    },
    showHint: {
      type: Boolean,
      default: true,
    },
    showUnavailable: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const store = useStore();
    const selectId = `reasoning-control-${nextReasoningControlId++}`;
    const selectRef = ref(null);
    const providerMetadata = computed(() => {
      if (!props.provider) return null;
      return store.state.aiProvider.modelMetadata[props.provider] || null;
    });
    const isLoadingModels = computed(() => {
      if (!props.provider) return false;
      return Boolean(store.state.aiProvider.loadingModels[props.provider]);
    });

    const control = computed(() => {
      if (!props.provider || !props.model) return null;
      return (
        providerMetadata.value?.[props.model]?.reasoningControl ||
        store.getters['aiProvider/inferReasoningControl']?.(props.provider, props.model) ||
        null
      );
    });
    const showUnavailableState = computed(() => {
      if (!props.showUnavailable || !props.provider) return false;
      return !control.value;
    });
    const unavailableMessage = computed(() => {
      if (!props.model) return 'Select a model to view reasoning options.';
      if (isLoadingModels.value) return 'Checking reasoning options for this model...';
      return 'Not configurable for this model.';
    });

    const selectedValue = computed(() => store.state.aiProvider.reasoningValue || 'default');
    const effectiveValue = computed(() => {
      if (!control.value) return 'default';
      const valid = control.value.options.some((option) => option.value === selectedValue.value);
      return valid ? selectedValue.value : (control.value.defaultValue || 'default');
    });
    const effectiveLabel = computed(() => {
      if (!control.value) return '';
      const match = control.value.options.find((option) => option.value === effectiveValue.value);
      return match ? match.label : '';
    });

    const hintText = computed(() => {
      if (!control.value) return '';
      if (control.value.kind === 'toggle') {
        return 'Use the provider default or disable model-side thinking.';
      }
      return 'Controls model-side reasoning depth when this model exposes it.';
    });

    watch(
      control,
      (nextControl) => {
        if (!nextControl) {
          if (selectedValue.value !== 'default') {
            store.commit('aiProvider/SET_REASONING_VALUE', 'default');
          }
          return;
        }

        const valid = nextControl.options.some((option) => option.value === selectedValue.value);
        if (!valid) {
          store.commit('aiProvider/SET_REASONING_VALUE', nextControl.defaultValue || 'default');
        }
      },
      { immediate: true },
    );

    // Keep CustomSelect's internal selectedOption in sync with the store value
    // (CustomSelect tracks its own state and only mutates it via selectOption /
    // setSelectedOption — initial render and external changes need a push).
    const syncSelected = async () => {
      if (!control.value) return;
      await nextTick();
      const match = control.value.options.find((opt) => opt.value === effectiveValue.value);
      if (match && selectRef.value?.setSelectedOption) {
        selectRef.value.setSelectedOption(match);
      }
    };
    watch([effectiveValue, control], syncSelected, { immediate: true });

    const handleSelected = (option) => {
      if (!option) return;
      store.commit('aiProvider/SET_REASONING_VALUE', option.value);
    };

    return {
      control,
      effectiveLabel,
      handleSelected,
      hintText,
      unavailableMessage,
      selectId,
      selectRef,
      showUnavailableState,
    };
  },
};
</script>

<style scoped>
.reasoning-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reasoning-label {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-light-med-navy);
}

.reasoning-hint {
  font-size: 0.75em;
  color: var(--color-med-navy);
}

.reasoning-unavailable-message {
  min-height: 36px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  border: 1px dashed var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-med-navy);
  font-size: 0.85em;
  line-height: 1.35;
}

.reasoning-control.compact .reasoning-unavailable-message {
  min-height: 34px;
}

.reasoning-control.without-hint {
  gap: 8px;
}
</style>
