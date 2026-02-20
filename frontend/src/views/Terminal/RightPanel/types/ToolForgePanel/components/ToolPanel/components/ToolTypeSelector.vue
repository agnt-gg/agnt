<template>
  <div class="tool-type-selector">
    <div class="selector-label">Tool Type:</div>
    <div class="selector-buttons">
      <Tooltip text="AI Prompt-based tool" width="auto">
        <button type="button" :class="['type-btn', { active: modelValue === 'AI' }]" @click="selectType('AI')">
          <i class="fas fa-magic"></i>
          AI
        </button>
      </Tooltip>
      <Tooltip text="JavaScript code execution tool" width="auto">
        <button
          type="button"
          :class="['type-btn', { active: modelValue === 'CODE_JS' }]"
          @click="selectType('CODE_JS')"
        >
          <i class="fab fa-js"></i>
          JS
        </button>
      </Tooltip>
      <Tooltip text="Python code execution tool" width="auto">
        <button
          type="button"
          :class="['type-btn', { active: modelValue === 'CODE_PYTHON' }]"
          @click="selectType('CODE_PYTHON')"
        >
          <i class="fab fa-python"></i>
          PY
        </button>
      </Tooltip>
    </div>
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ToolTypeSelector',
  components: {
    Tooltip,
  },
  props: {
    modelValue: {
      type: String,
      default: 'AI',
    },
  },
  emits: ['update:modelValue'],
  methods: {
    selectType(type) {
      this.$emit('update:modelValue', type);
    },
  },
};
</script>

<style scoped>
.tool-type-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  background: transparent;
  border-radius: 0;
  margin-bottom: 0;
  width: 100%;
}

.selector-label {
  color: var(--color-text);
  font-size: 0.9em;
  font-weight: 500;
}

.selector-buttons {
  display: flex;
  gap: 8px;
  flex: 1;
}

.type-btn {
  flex: 0;
  padding: 6px 16px 4px;
  background: var(--color-dull-white, #fff);
  border: 1px solid var(--terminal-border-color, #ddd);
  border-radius: 6px;
  color: var(--color-navy, #01052a);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--font-family-primary);
}

.type-btn:hover {
  background: var(--color-lighter-0, #f8f9fa);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.type-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.type-btn i {
  font-size: 14px;
}

/* Dark mode adjustments */
body.dark .type-btn {
  background: var(--color-darker-0);
  border-color: var(--terminal-border-color);
  color: var(--color-text);
}

body.dark .type-btn:hover {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

body.dark .type-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}
</style>
