// useUiModeDefault — give an account its starting shell, once.
//
// Runs in Terminal.vue. If this browser has no Simple/Studio choice yet, it
// waits for the account's first data to load, classifies the account
// (services/uiModeDefault.js) and commits the default through the normal
// mutation, so the choice is saved and synced like any other. After that the
// mode only ever changes because the person changed it.
//
// A failed load must never make an existing account look new: the decision
// waits for a SUCCESSFUL conversation fetch and for agents and workflows to
// have settled without error. Undecided is safe — the app stays in Studio.

import { computed, ref, watch } from 'vue';
import { readStoredUiMode } from '@/services/uiMode.js';
import { classifyAccount, defaultModeFor, readFlag, writeFlag, INTRO_SEEN_KEY } from '@/services/uiModeDefault.js';

export function useUiModeDefault(store) {
  const decided = ref(readStoredUiMode() !== null);
  const introSeen = ref(readFlag(INTRO_SEEN_KEY));

  const facts = computed(() => {
    const g = store.getters;
    const loaded =
      g.criticalDataReady === true &&
      store.state.contentOutputs?.lastFetched != null &&
      !g['agents/error'] &&
      !g['workflows/error'];
    if (!loaded) return {};
    return {
      chats: g['contentOutputs/totalCount'] || (g['contentOutputs/outputs'] || []).length,
      agents: (g['agents/allAgents'] || []).length,
      workflows: (g['workflows/allWorkflows'] || []).length,
    };
  });

  const stop = watch(
    facts,
    (f) => {
      if (decided.value) return;
      const kind = classifyAccount(f);
      if (!kind) return;
      decided.value = true;
      // Re-read at the moment of deciding: the preference sync may have
      // brought a choice from another device while the data was loading.
      if (readStoredUiMode() === null) store.dispatch('theme/setUiMode', defaultModeFor(kind));
    },
    { immediate: true },
  );
  if (decided.value) stop();

  // Studio users are told about Simple once. Seeing Simple at all counts.
  const showTrySimple = computed(() => decided.value && !introSeen.value && store.getters['theme/uiMode'] === 'studio');
  watch(
    () => store.getters['theme/uiMode'],
    (mode) => {
      if (mode === 'simple' && !introSeen.value) markIntroSeen();
    },
    { immediate: true },
  );

  function markIntroSeen() {
    introSeen.value = true;
    writeFlag(INTRO_SEEN_KEY);
  }

  return { showTrySimple, dismissTrySimple: markIntroSeen };
}
