<template>
  <label class="focused-param-row">
    <span class="focused-param-label">{{ humanKey(name) }}</span>
    <button
      v-if="kind === 'switch'"
      type="button"
      class="focused-switch"
      role="switch"
      :aria-checked="modelValue ? 'true' : 'false'"
      :aria-label="humanKey(name)"
      :disabled="readOnly"
      @click="emit('update:modelValue', !modelValue)"
    ></button>
    <input
      v-else-if="kind === 'number'"
      class="focused-input"
      type="number"
      :value="modelValue"
      :readonly="readOnly"
      @input="onNumber"
    />
    <textarea
      v-else-if="kind === 'json'"
      class="focused-input mono"
      :class="{ bad: jsonError }"
      :value="jsonText"
      :readonly="readOnly"
      :rows="Math.min(8, jsonText.split('\n').length)"
      spellcheck="false"
      @input="onJson"
    ></textarea>
    <textarea
      v-else-if="kind === 'textarea'"
      class="focused-input"
      :value="modelValue ?? ''"
      :readonly="readOnly"
      :rows="Math.min(8, Math.max(2, String(modelValue ?? '').split('\n').length))"
      @input="emit('update:modelValue', $event.target.value)"
    ></textarea>
    <input
      v-else
      class="focused-input"
      :value="modelValue ?? ''"
      :readonly="readOnly"
      @input="emit('update:modelValue', $event.target.value)"
    />
  </label>
</template>

<script setup>
// One step setting. The control follows the value's type (the demo's rule):
// a boolean is a switch, a number a number field, an object JSON that only
// saves once it parses, and text a field or a box when it is long.
import { ref } from 'vue';
import { humanKey, paramKind } from './focusedEditors.js';

const props = defineProps({
  name: { type: String, required: true },
  modelValue: { type: null, default: '' },
  readOnly: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

// The kind is fixed from the value it started with: clearing a number field
// must not turn it into a text setting.
const kind = paramKind(props.modelValue);
const jsonText = ref(kind === 'json' ? JSON.stringify(props.modelValue, null, 2) : '');
const jsonError = ref(false);

function onNumber(e) {
  const raw = e.target.value;
  const n = Number(raw);
  if (raw !== '' && Number.isFinite(n)) emit('update:modelValue', n);
}
function onJson(e) {
  jsonText.value = e.target.value;
  try {
    emit('update:modelValue', JSON.parse(jsonText.value));
    jsonError.value = false;
  } catch {
    jsonError.value = true; // kept on screen, not saved, until it parses
  }
}
</script>
