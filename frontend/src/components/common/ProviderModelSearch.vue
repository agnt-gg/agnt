<template>
  <div class="provider-model-search" ref="rootRef">
    <div class="search-input-wrapper" :class="{ focused }">
      <i class="fas fa-search search-icon"></i>
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="search-input"
        :placeholder="placeholder"
        @focus="onFocus"
        @blur="onBlur"
        @keydown.escape="close"
        @keydown.down.prevent="moveCursor(1)"
        @keydown.up.prevent="moveCursor(-1)"
        @keydown.enter.prevent="selectCursor"
      />
      <button v-if="query" type="button" class="search-clear" @mousedown.prevent @click="clear">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <div v-if="open && query.trim()" class="search-results">
      <template v-if="results.length">
        <div
          v-for="(result, idx) in results"
          :key="`${result.provider}::${result.model}`"
          class="search-result"
          :class="{ active: idx === cursor }"
          @mousedown.prevent="select(result)"
          @mouseenter="cursor = idx"
        >
          <span class="result-provider">{{ result.providerLabel }}</span>
          <span class="result-divider">·</span>
          <span class="result-model">{{ result.model }}</span>
        </div>
      </template>
      <div v-else class="search-empty">No matches</div>
    </div>
  </div>
</template>

<script>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { PROVIDER_DISPLAY_NAMES } from '@/store/app/aiProvider.js';

const MAX_RESULTS = 40;

export default {
  name: 'ProviderModelSearch',
  props: {
    placeholder: {
      type: String,
      default: 'Search providers and models…',
    },
  },
  emits: ['selected'],
  setup(props, { emit }) {
    const store = useStore();
    const rootRef = ref(null);
    const inputRef = ref(null);
    const query = ref('');
    const focused = ref(false);
    const open = ref(false);
    const cursor = ref(0);

    // Flatten { provider, providerLabel, model } across built-in + custom providers.
    const allEntries = computed(() => {
      const entries = [];
      const allModels = store.state.aiProvider.allModels || {};
      const builtInProviders = store.state.aiProvider.providers || [];
      const customProviders = store.state.aiProvider.customProviders || [];

      for (const provider of builtInProviders) {
        const label = PROVIDER_DISPLAY_NAMES[provider] || provider;
        const models = allModels[provider] || [];
        for (const model of models) {
          entries.push({ provider, providerLabel: label, model });
        }
      }
      for (const cp of customProviders) {
        const label = `${cp.provider_name} (Custom)`;
        const models = allModels[cp.id] || [];
        for (const model of models) {
          entries.push({ provider: cp.id, providerLabel: label, model });
        }
      }
      return entries;
    });

    // Score model-name matches above provider-name matches so a search
    // for a specific model surfaces it even when many providers also match.
    const results = computed(() => {
      const q = query.value.trim().toLowerCase();
      if (!q) return [];
      const scored = [];
      for (const entry of allEntries.value) {
        const modelLower = entry.model.toLowerCase();
        const providerLower = entry.providerLabel.toLowerCase();
        const modelIdx = modelLower.indexOf(q);
        const providerIdx = providerLower.indexOf(q);
        if (modelIdx === -1 && providerIdx === -1) continue;
        const score = (modelIdx === -1 ? Infinity : modelIdx) + (providerIdx === -1 ? 100 : providerIdx) * 0.01;
        scored.push({ entry, score });
      }
      scored.sort((a, b) => a.score - b.score);
      return scored.slice(0, MAX_RESULTS).map((s) => s.entry);
    });

    const close = () => {
      open.value = false;
      cursor.value = 0;
    };

    const clear = () => {
      query.value = '';
      cursor.value = 0;
      inputRef.value?.focus();
    };

    const onFocus = () => {
      focused.value = true;
      open.value = true;
    };

    // Delay closing on blur so result mousedown handlers fire first.
    const onBlur = () => {
      focused.value = false;
      setTimeout(() => {
        if (!rootRef.value?.contains(document.activeElement)) close();
      }, 0);
    };

    const moveCursor = (delta) => {
      if (!results.value.length) return;
      open.value = true;
      const len = results.value.length;
      cursor.value = (cursor.value + delta + len) % len;
    };

    const selectCursor = () => {
      if (!open.value || !results.value.length) return;
      select(results.value[cursor.value]);
    };

    const select = async (result) => {
      if (!result) return;
      close();
      query.value = '';
      // setProvider auto-picks the first model for that provider; setModel
      // immediately overrides it with the user's chosen pair.
      await store.dispatch('aiProvider/setProvider', result.provider);
      await store.dispatch('aiProvider/setModel', result.model);
      emit('selected', result);
    };

    return {
      rootRef,
      inputRef,
      query,
      focused,
      open,
      cursor,
      results,
      close,
      clear,
      onFocus,
      onBlur,
      moveCursor,
      selectCursor,
      select,
    };
  },
};
</script>

<style scoped>
.provider-model-search {
  position: relative;
  width: 100%;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}

.search-input-wrapper.focused {
  border-color: var(--color-light-med-navy);
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-med-navy);
  font-size: 0.85em;
  pointer-events: none;
}

.search-input {
  flex: 1;
  width: 100%;
  min-height: 24px;
  padding: 4px 32px 4px 30px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--color-lightest);
  font-size: 0.9em;
  outline: none;
}

.search-input::placeholder {
  color: var(--color-med-navy);
}

.search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--color-med-navy);
  cursor: pointer;
  font-size: 0.8em;
}

.search-clear:hover {
  background: rgba(127, 129, 147, 0.15);
  color: var(--color-light-med-navy);
}

.search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 10010;
  max-height: 280px;
  overflow-y: auto;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 4px;
}

.search-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--color-lightest);
  font-size: 0.9em;
  cursor: pointer;
  user-select: none;
}

.search-result.active,
.search-result:hover {
  background: var(--color-darker-0);
}

.result-provider {
  color: var(--color-light-med-navy);
  font-weight: 500;
  white-space: nowrap;
}

.result-divider {
  color: var(--color-med-navy);
}

.result-model {
  color: var(--color-lightest);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-empty {
  padding: 12px;
  text-align: center;
  color: var(--color-med-navy);
  font-size: 0.85em;
}

:deep(body.dark) .search-input-wrapper {
  background-color: rgba(0, 0, 0, 0.2);
}

:deep(body.dark) .search-results {
  background-color: var(--color-darker-3);
}

:deep(body.dark) .search-result.active,
:deep(body.dark) .search-result:hover {
  background-color: var(--color-darker-3);
}
</style>
