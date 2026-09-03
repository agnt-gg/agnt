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
        @input="onInput"
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
          :key="`${result.provider}::${result.model ?? '(provider-only)'}`"
          class="search-result"
          :class="{ active: idx === cursor }"
          @mousedown.prevent="select(result)"
          @mouseenter="cursor = idx"
        >
          <span class="result-provider">{{ result.providerLabel }}</span>
          <span class="result-divider">·</span>
          <span v-if="result.model" class="result-model">{{ result.model }}</span>
          <span v-else class="result-model result-model-none">no models loaded</span>
        </div>
      </template>
      <div v-else class="search-empty">No matches</div>
    </div>
  </div>
</template>

<script>
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { PROVIDER_DISPLAY_NAMES } from '@/store/app/aiProvider.js';

const MAX_RESULTS = 40;// Dispatch fetches for every provider that hasn't loaded its models yet.
// fetchProviderModels uses stale-while-revalidate: cached models paint
// instantly and a background refresh runs on every call, so repeated
// invocations are cheap and always converge on fresh data. Per-provider
// failures (missing API key, not connected) are silenced so unrelated
// providers still populate.
// `only` narrows the sweep to a specific set of providers. The mount-time call
// omits it and covers everything; the custom-provider watcher passes just the
// custom ids, because re-sweeping everything would re-fetch every built-in that
// has no models — which is most of them, since an unconnected provider never
// gets any. Measured on a realistic 20-built-in store with 2 connected: the
// unnarrowed watcher fired 20 requests to obtain the 2 that were wanted.
async function ensureAllProviderModelsLoaded(store, only = null) {
  const { allModels = {}, providers = [], customProviders = [] } = store.state.aiProvider;
  const pool = only || [
    ...providers,
    ...customProviders.map((cp) => cp.id),
  ];
  const targets = pool.filter((p) => !allModels[p] || allModels[p].length === 0);

  if (!targets.length) return;
  await Promise.all(
    targets.map((provider) =>
      store.dispatch('aiProvider/fetchProviderModels', { provider }).catch(() => {}),
    ),
  );
}

export default {
  name: 'ProviderModelSearch',
  props: {
    placeholder: {
      type: String,
      default: 'Search providers and models…',
    },
    // When false, a pick does NOT write the global Vuex selection — the
    // parent receives the 'selected' emit and applies it to its own scope
    // (e.g. a per-conversation override). Default true preserves the legacy
    // behavior for every existing caller.
    applyGlobally: {
      type: Boolean,
      default: true,
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
      // A custom provider is user-created, and the picker is the only place it
      // can be edited or deleted — so it has to stay findable precisely when it
      // is broken. Its model list comes from its own endpoint, so an unreachable
      // one has no models and would contribute no rows at all, disappearing from
      // search exactly when the user needs to go fix it. Emit a single
      // provider-only row instead.
      //
      // Built-ins deliberately get no such row: an empty built-in means "not
      // connected", and listing every unconnected provider would bury the ones
      // that actually work.
      for (const cp of customProviders) {
        const label = `${cp.provider_name} (Custom)`;
        const models = allModels[cp.id] || [];
        for (const model of models) {
          entries.push({ provider: cp.id, providerLabel: label, model });
        }
        if (!models.length) {
          entries.push({ provider: cp.id, providerLabel: label, model: null });
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
        // A provider-only row has no model name to match against.
        const modelIdx = entry.model ? entry.model.toLowerCase().indexOf(q) : -1;
        const providerIdx = entry.providerLabel.toLowerCase().indexOf(q);
        if (modelIdx === -1 && providerIdx === -1) continue;
        const score = (modelIdx === -1 ? Infinity : modelIdx) + (providerIdx === -1 ? 100 : providerIdx) * 0.01;
        scored.push({ entry, score });
      }
      // Every provider-name-only match scores Infinity, so those rows all tie
      // at Infinity - Infinity = NaN. That is not the hazard it looks like:
      // ECMA-262 SortCompare specifies "If v is NaN, return +0", so the engine
      // reads it as a genuine tie and the sort stays stable. Left as-is
      // deliberately — guarding it would be redundant with the spec.
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

    // Re-open after a previous selection closed the dropdown — the input
    // keeps focus, so the focus handler doesn't fire again on next keystroke.
    const onInput = () => {
      open.value = true;
      cursor.value = 0;
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

      // A provider-only row carries no model, so resolve one first. The fetch
      // routes custom-provider ids to their own endpoint, which means a provider
      // that was merely never fetched (rather than unreachable) ends up behaving
      // exactly like an ordinary model hit.
      let picked = result;
      if (!picked.model) {
        const models = await store
          .dispatch('aiProvider/fetchProviderModels', { provider: picked.provider })
          .catch(() => []);
        picked = { ...picked, model: Array.isArray(models) && models.length ? models[0] : null };
      }

      if (props.applyGlobally) {
        // setProvider auto-picks the first model for that provider; setModel
        // immediately overrides it with the user's chosen pair. With nothing
        // resolved there is no pair to pin, and dispatching a null model would
        // undo the selection the provider mutation just made.
        await store.dispatch('aiProvider/setProvider', picked.provider);
        if (picked.model) {
          await store.dispatch('aiProvider/setModel', picked.model);
        }
      } else if (!picked.model) {
        // A per-conversation override pins provider AND model; a null model
        // writes a half-pin that cannot route. Selecting an unreachable provider
        // globally is a meaningful way to reach its Edit button — pinning one
        // conversation to it is not.
        return;
      }

      emit('selected', picked);
    };    // Models for a provider are only fetched when that provider is first
    // selected. To make search cover every provider, kick off background
    // fetches on mount — fetchProviderModels uses stale-while-revalidate,
    // so subsequent mounts paint from cache instantly and revalidate in
    // the background.
    onMounted(() => {
      ensureAllProviderModelsLoaded(store);
    });

    // The mount-time sweep above cannot see custom providers. This component is
    // a child of the provider picker, Vue mounts children before parents, and it
    // is the PARENT that dispatches fetchCustomProviders — so on mount the list
    // is still empty and every custom provider is skipped, permanently. Re-run
    // the sweep when the ids actually change. Keying on the joined ids rather
    // than the array reference catches both a wholesale replace
    // (SET_CUSTOM_PROVIDERS) and an in-place push (ADD_CUSTOM_PROVIDER).
    watch(
      () => (store.state.aiProvider.customProviders || []).map((cp) => cp.id).join(','),
      () => ensureAllProviderModelsLoaded(
        store,
        (store.state.aiProvider.customProviders || []).map((cp) => cp.id),
      ),
    );

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
      onInput,
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
  /* --color-light-med-navy is #d1d1db in dark and the TEXT colour in light, so
     it drew a white edge in dark and a heavy ink edge in light. A focus ring
     has a token. */
  border-color: var(--color-primary);
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

.result-model-none {
  color: var(--color-med-navy);
  font-style: italic;
}

.search-empty {
  padding: 12px;
  text-align: center;
  color: var(--color-med-navy);
  font-size: 0.85em;
}

:deep(body.dark) .search-input-wrapper {
  background-color: var(--color-darker-0);
}

:deep(body.dark) .search-results {
  background-color: var(--color-darker-3);
}

:deep(body.dark) .search-result.active,
:deep(body.dark) .search-result:hover {
  background-color: var(--color-darker-3);
}
</style>
