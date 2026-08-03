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
  /* TRANSPARENT: a segmented control sits ON its panel, it is not a surface of
     its own. This was var(--color-dull-white, #fff) — a PHYSICAL name that the
     light theme remaps to var(--color-text), i.e. #4a4a60. So in light mode the
     button painted a dark slab and set --text-primary on top of it: measured
     #4a4a60 on #4a4a60, exactly 1.00:1. The fallback #fff never applied, because
     the token is defined; a fallback only fires when a token is MISSING, not
     when it resolves to something unsuitable.

     Transparent needs no per-theme patch, which is why the two body.dark rules
     below could be deleted. */
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--text-primary);
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
  /* --surface-hover inverts (ink-alpha in light, white-alpha in dark); the old
     #f8f9fa literal needed a dark-mode patch to avoid a bright flash. */
  background: var(--surface-hover);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.type-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--on-fill-accent);
}

.type-btn i {
  font-size: 14px;
}

/* The three `body.dark .type-btn*` rules that used to live here are gone.

   They existed to patch physical tokens back per theme, which is the pattern
   that hides bugs: the rules nobody remembers to patch keep the light-mode
   value forever. The base rules above are now themed, so there is nothing left
   to correct.

   The last one also set `color: white` on --color-primary, which is NEON GREEN
   in dark — measured 1.53:1. .type-btn.active uses --on-fill-accent, the
   declared partner of that fill, which is dark in dark mode and light in light
   mode. */
</style>
