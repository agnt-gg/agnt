<template>
  <div class="level-control">
    <div class="track" :style="{ '--steps': options.length }">
      <div class="fill" :style="fillStyle"></div>
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        :class="['step', option.value, { active: modelValue === option.value }]"
        :aria-label="option.label"
        :aria-pressed="modelValue === option.value"
        @click="$emit('update:modelValue', option.value)"
      >
        <span class="dot"></span>
        <span class="step-label">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, required: true },
});
defineEmits(['update:modelValue']);

const activeIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));
const fillStyle = computed(() => {
  if (activeIndex.value < 0 || props.options.length < 2) return { width: '0%' };
  return { width: `${(activeIndex.value / (props.options.length - 1)) * 100}%` };
});
</script>

<style scoped>
.level-control{width:100%;min-width:220px}.track{position:relative;display:grid;grid-template-columns:repeat(var(--steps),1fr);padding-top:2px}.track::before,.fill{content:"";position:absolute;top:9px;left:calc(100% / var(--steps) / 2);height:3px;border-radius:3px}.track::before{right:calc(100% / var(--steps) / 2);background:var(--terminal-border-color-light)}.fill{max-width:calc(100% - 100% / var(--steps));background:linear-gradient(90deg,var(--color-red),var(--color-yellow),var(--color-green));transition:width .18s ease}.step{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px;border:0;background:transparent;color:var(--color-text-muted);font:600 10px var(--font-family-monospace);cursor:pointer;padding:0 4px 4px}.dot{width:15px;height:15px;border:3px solid var(--terminal-border-color-light);background:var(--terminal-section-bg);border-radius:50%;transition:.15s}.step:hover .dot{border-color:var(--color-primary);transform:scale(1.12)}.step.active{color:var(--color-text)}.step.active.inherit .dot{border-color:var(--color-primary);background:var(--color-primary);box-shadow:0 0 12px color-mix(in srgb,var(--color-primary) 60%,transparent)}.step.active.allow .dot,.step.active.off .dot{border-color:var(--color-red);background:var(--color-red);box-shadow:0 0 12px color-mix(in srgb,var(--color-red) 60%,transparent)}.step.active.audit .dot,.step.active.report .dot,.step.active.observe .dot{border-color:var(--color-yellow);background:var(--color-yellow);box-shadow:0 0 12px color-mix(in srgb,var(--color-yellow) 60%,transparent)}.step.active.block .dot,.step.active.enforce .dot,.step.active.balanced .dot,.step.active.strict .dot{border-color:var(--color-green);background:var(--color-green);box-shadow:0 0 12px color-mix(in srgb,var(--color-green) 60%,transparent)}.step-label{white-space:nowrap}@media(max-width:700px){.level-control{min-width:180px}.step-label{font-size:9px}}
</style>
