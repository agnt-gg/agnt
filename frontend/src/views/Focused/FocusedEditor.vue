<template>
  <section class="focused-page focused-editor" :aria-label="name || kindLabel">
    <button type="button" class="focused-page-back" @click="$emit('back')">
      <i class="fas fa-arrow-left" aria-hidden="true"></i>{{ backLabel }}
    </button>

    <!-- Header: icon, name and description are edited where they are shown. -->
    <header class="focused-edit-head">
      <slot name="icon">
        <span class="focused-edit-icon" aria-hidden="true"><FocusedGlyph :icon="icon" /></span>
      </slot>
      <div class="focused-edit-names">
        <input
          class="focused-inline-title"
          :value="name"
          :placeholder="namePlaceholder"
          :readonly="readOnly || nameReadOnly"
          maxlength="160"
          :aria-label="namePlaceholder"
          @input="$emit('update:name', $event.target.value)"
        />
        <textarea
          v-if="description !== null"
          ref="descEl"
          class="focused-inline-sub"
          :value="description"
          :placeholder="descriptionPlaceholder"
          :readonly="readOnly"
          rows="1"
          maxlength="600"
          aria-label="Description"
          @input="onDescription"
        ></textarea>
        <span v-else-if="meta" class="focused-edit-meta">{{ meta }}</span>
      </div>
      <slot name="actions" />
      <button v-if="chatAsk" type="button" class="focused-btn" @click="$emit('ask', chatAsk)">Change in chat</button>
    </header>

    <p v-if="note" class="focused-edit-note" :class="{ warn: !readOnly }">{{ note }}</p>

    <slot />

    <footer v-if="showFoot" class="focused-form-foot">
      <button v-if="deleteLabel" type="button" class="focused-btn danger" @click="$emit('delete')">{{ deleteLabel }}</button>
      <span class="focused-flex"></span>
      <span v-if="meta && description !== null" class="focused-edit-meta">{{ meta }}</span>
    </footer>

    <!-- Save bar: appears as soon as something changes, like a document. -->
    <div v-if="dirty || saving || error" class="focused-save-bar" role="region" aria-label="Unsaved changes">
      <span class="focused-save-text" :class="{ error: !!error }">{{ error || (saving ? 'Saving…' : 'Unsaved changes') }}</span>
      <button type="button" class="focused-btn" :disabled="saving" @click="$emit('discard')">Discard</button>
      <button type="button" class="focused-primary" :disabled="saving || !dirty" @click="$emit('save')">Save</button>
    </div>
  </section>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import FocusedGlyph from './FocusedGlyph.vue';

const props = defineProps({
  kindLabel: { type: String, default: 'Library' },
  backLabel: { type: String, default: 'Library' },
  icon: { type: String, default: 'fas fa-cube' },
  name: { type: String, default: '' },
  namePlaceholder: { type: String, default: 'Name' },
  nameReadOnly: { type: Boolean, default: false },
  /** null hides the description field (files have none). */
  description: { type: String, default: null },
  descriptionPlaceholder: { type: String, default: 'What this is for' },
  readOnly: { type: Boolean, default: false },
  note: { type: String, default: '' },
  meta: { type: String, default: '' },
  chatAsk: { type: String, default: '' },
  deleteLabel: { type: String, default: '' },
  showFoot: { type: Boolean, default: true },
  dirty: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['back', 'save', 'discard', 'delete', 'ask', 'update:name', 'update:description']);

const descEl = ref(null);
const grow = (el) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};
function onDescription(e) {
  emit('update:description', e.target.value);
  grow(e.target);
}
onMounted(() => grow(descEl.value));
watch(
  () => props.description,
  () => nextTick(() => grow(descEl.value)),
);
</script>
