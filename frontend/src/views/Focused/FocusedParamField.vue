<template>
  <!-- A <label> forwards clicks to the first button inside it, which would
       toggle a dropdown twice: a dropdown row, or one with the field picker,
       is a plain block. -->
  <component :is="choices || canInsert ? 'div' : 'label'" class="focused-param-row">
    <span class="focused-param-label">{{ humanKey(name) }}</span>
    <CustomSelect
      v-if="choices"
      class="focused-param-select"
      :model-value="modelValue"
      :options="choices"
      :disabled="readOnly"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <button
      v-else-if="kind === 'switch'"
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
    <!-- Text settings: click in and the earlier steps' fields are offered. -->
    <div v-else class="focused-param-text">
      <div class="focused-param-text-row">
        <textarea
          v-if="kind === 'textarea'"
          ref="field"
          class="focused-input"
          :value="modelValue ?? ''"
          :readonly="readOnly"
          :rows="Math.min(8, Math.max(2, String(modelValue ?? '').split('\n').length))"
          :aria-label="humanKey(name)"
          @input="emit('update:modelValue', $event.target.value)"
          @focus="openPicker"
          @blur="closeSoon"
          @keydown.esc="pickerOpen = false"
        ></textarea>
        <input
          v-else
          ref="field"
          class="focused-input"
          :value="modelValue ?? ''"
          :readonly="readOnly"
          :aria-label="humanKey(name)"
          @input="emit('update:modelValue', $event.target.value)"
          @focus="openPicker"
          @blur="closeSoon"
          @keydown.esc="pickerOpen = false"
        />
        <button
          v-if="canInsert"
          type="button"
          class="focused-icon-btn focused-insert-btn"
          :aria-label="'Insert a field from an earlier step into ' + humanKey(name)"
          :aria-expanded="pickerOpen ? 'true' : 'false'"
          v-tooltip="'Use a field from an earlier step'"
          data-action="insert-field"
          @mousedown.prevent
          @click="togglePicker"
        >{ }</button>
      </div>
      <div v-if="pickerOpen && canInsert" class="focused-field-picker" role="listbox" :aria-label="'Fields for ' + humanKey(name)" data-testid="field-picker" @mousedown.prevent>
        <div v-for="step in stepsWithFields" :key="step.id" class="focused-field-group">
          <div class="focused-field-group-head"><span class="focused-step-num">{{ step.number }}</span>{{ step.name }}</div>
          <button
            v-for="f in step.fields"
            :key="f.key"
            type="button"
            role="option"
            class="focused-field-option"
            :data-token="f.token"
            v-tooltip="f.description ? f.description + ' · ' + f.token : f.token"
            @click="insert(f.token)"
          >
            <span class="focused-field-key">{{ humanKey(f.key) }}</span>
            <span v-if="f.sample" class="focused-field-sample">{{ f.sample }}</span>
            <span v-else-if="f.type" class="focused-field-type">{{ f.type }}</span>
          </button>
        </div>
        <p v-if="!stepsWithFields.length" class="focused-edit-hint">The earlier steps have no fields to use.</p>
      </div>
    </div>
  </component>
</template>

<script setup>
// One step setting. The control follows the value's type (the demo's rule):
// a boolean is a switch, a number a number field, an object JSON that only
// saves once it parses, and text a field or a box when it is long.
// A setting with a list of choices (a step's `<key>_options`) is a dropdown.
// A text setting offers the earlier steps' fields (previousStepFields) and
// inserts {{step.field}} at the cursor.
import { ref, computed, nextTick } from 'vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { humanKey, paramKind, insertAt } from './focusedEditors.js';

const props = defineProps({
  name: { type: String, required: true },
  modelValue: { type: null, default: '' },
  readOnly: { type: Boolean, default: false },
  options: { type: Array, default: null },
  /** previousStepFields(): earlier steps and their output fields. */
  insertables: { type: Array, default: () => [] },
});
// The current value stays choosable even when the list no longer has it.
const choices = computed(() => {
  if (!Array.isArray(props.options) || !props.options.length) return null;
  const list = props.options.map((o) => (o && typeof o === 'object' ? { label: String(o.label ?? o.value), value: o.value } : { label: String(o), value: o }));
  const cur = props.modelValue;
  return cur !== '' && cur != null && !list.some((o) => o.value === cur) ? [{ label: String(cur), value: cur }, ...list] : list;
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

// ── Field picker ────────────────────────────────────────────────────────────
const field = ref(null);
const pickerOpen = ref(false);
const stepsWithFields = computed(() => (props.insertables || []).filter((s) => s.fields?.length));
const canInsert = computed(() => !props.readOnly && !choices.value && (kind === 'text' || kind === 'textarea') && (props.insertables || []).length > 0);

function openPicker() {
  if (canInsert.value) pickerOpen.value = true;
}
function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
  if (pickerOpen.value) field.value?.focus();
}
// Clicks inside the picker keep focus (mousedown.prevent), so a blur means
// the user went elsewhere.
function closeSoon() {
  pickerOpen.value = false;
}
async function insert(token) {
  const el = field.value;
  const { text, caret } = insertAt(props.modelValue ?? '', token, el?.selectionStart, el?.selectionEnd);
  emit('update:modelValue', text);
  await nextTick();
  if (el) {
    el.value = text;
    el.focus();
    el.setSelectionRange(caret, caret);
  }
}
</script>
