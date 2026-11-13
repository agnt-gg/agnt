<template>
  <span>{{ text }}</span>
</template>

<script setup>
// A figure that counts up when its card comes on screen; still (reduced motion) shows it at once.
import { onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  value: { type: Number, required: true },
  active: { type: Boolean, default: false },
  still: { type: Boolean, default: false },
  prefix: { type: String, default: '' },
  suffix: { type: String, default: '' },
});

const DELAY_MS = 260;
const DURATION_MS = 1300;
const nextFrame = globalThis.requestAnimationFrame?.bind(globalThis) || ((cb) => setTimeout(() => cb(performance.now()), 16));
const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout;

const format = (v) => props.prefix + Math.round(v).toLocaleString('en-US') + props.suffix;
const text = ref(format(props.value));
let frame = 0;

function run() {
  cancelFrame(frame);
  if (props.still || !props.active) {
    text.value = format(props.value);
    return;
  }
  const start = performance.now() + DELAY_MS;
  text.value = format(0);
  const step = (now) => {
    const p = Math.min(1, Math.max(0, (now - start) / DURATION_MS));
    text.value = format(props.value * (1 - Math.pow(1 - p, 4)));
    if (p < 1) frame = nextFrame(step);
  };
  frame = nextFrame(step);
}

watch(() => [props.active, props.value, props.still], run, { immediate: true });
onBeforeUnmount(() => cancelFrame(frame));
</script>
