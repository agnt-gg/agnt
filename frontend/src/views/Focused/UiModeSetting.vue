<template>
  <section class="ui-mode-setting" aria-labelledby="ui-mode-heading">
    <div>
      <h3 id="ui-mode-heading">Layout</h3>
      <p>Same app, same data — choose how much of it you see. Switch any time with Ctrl+Shift+S.</p>
    </div>
    <div class="ui-mode-choices" role="radiogroup" aria-labelledby="ui-mode-heading">
      <button
        v-for="choice in choices"
        :key="choice.id"
        type="button"
        role="radio"
        class="ui-mode-choice"
        :class="{ active: mode === choice.id }"
        :aria-checked="mode === choice.id ? 'true' : 'false'"
        :data-testid="'ui-mode-' + choice.id"
        @click="setMode(choice.id)"
      >
        <i :class="choice.icon" aria-hidden="true"></i>
        <span>
          <strong>{{ choice.label }}</strong>
          <small>{{ choice.sub }}</small>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { useStore } from 'vuex';
import { UI_MODE_LABELS } from '@/services/uiMode.js';

const store = useStore();
const mode = computed(() => store.getters['theme/uiMode']);

const choices = [
  { id: 'focused', label: UI_MODE_LABELS.focused, icon: 'fas fa-comment', sub: 'One input, your chats and your library.' },
  { id: 'studio', label: UI_MODE_LABELS.studio, icon: 'fas fa-th-large', sub: 'Everything: canvas, forges, runs and panels.' },
];

function setMode(id) {
  store.dispatch('theme/setUiMode', id);
}
</script>

<style scoped>
.ui-mode-setting {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  margin-bottom: 16px;
  border-radius: 12px;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
}
h3 {
  margin: 0 0 4px;
  font-size: 15px;
  color: var(--text-primary);
}
p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.ui-mode-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.ui-mode-choice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ui-mode-choice:hover {
  background: var(--surface-hover);
}
.ui-mode-choice.active {
  border-color: rgba(var(--green-rgb), 0.35);
  background: rgba(var(--green-rgb), 0.08);
}
.ui-mode-choice i {
  margin-top: 2px;
  color: var(--text-secondary);
}
.ui-mode-choice span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ui-mode-choice small {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
