<template>
  <div v-if="isCodex" class="codex-speed-control">
    <span class="speed-label">Codex speed</span>
    <div class="speed-options" role="group" aria-label="Codex speed">
      <button type="button" :aria-pressed="!priority" :class="{ active: !priority }" @click="setPriority(false)">
        <span aria-hidden="true">🐢</span> Standard
      </button>
      <button type="button" :aria-pressed="priority" :class="{ active: priority }" @click="setPriority(true)">
        <span aria-hidden="true">🐇</span> Fast
      </button>
    </div>
    <span class="speed-hint">{{ priority ? 'Priority requested' : 'Default service tier' }} · reasoning unchanged.</span>
    <span class="speed-hint">Applies to Codex chats in this browser. Priority availability varies; may use more quota or cost more.</span>
    <span v-if="priority" class="speed-hint">Applies if routing or fallback selects Codex too. Cost estimates exclude the priority surcharge.</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useStore } from 'vuex';
import { resolveProviderKey } from '@/store/app/aiProvider.js';

const props = defineProps({ provider: { type: String, default: null } });
const store = useStore();
const isCodex = computed(() => resolveProviderKey(props.provider) === 'openai-codex');
const priority = computed(() => store.state.aiProvider.codexPriority === true);
const setPriority = (enabled) => store.commit('aiProvider/SET_CODEX_PRIORITY', enabled);
</script>

<style scoped>
.codex-speed-control { display: flex; flex-direction: column; gap: 8px; }
.speed-label { font-size: 0.85em; font-weight: 500; color: var(--color-light-med-navy); }
.speed-options { display: flex; gap: 4px; }
.speed-options button {
  flex: 1;
  min-height: 36px;
  padding: 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--color-light-med-navy);
  font: inherit;
  cursor: pointer;
}
.speed-options button.active { color: var(--color-green); border-color: var(--color-green); }
.speed-options button:focus-visible { outline: 2px solid var(--color-green); outline-offset: 2px; }
.speed-hint { color: var(--color-med-navy); font-size: 0.75em; line-height: 1.5; }
</style>
