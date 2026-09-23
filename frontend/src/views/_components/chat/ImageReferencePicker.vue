<template>
  <div v-if="choices.length" class="image-reference-picker">
    <button data-test="reference-open" type="button" class="reference-open" :disabled="disabled" :aria-expanded="open" @click="open = !open">
      <i class="far fa-images" aria-hidden="true"></i> Use a previous image
    </button>
    <section v-if="open" class="reference-panel" aria-label="Choose image reference">
      <div class="reference-heading"><span>Attach one saved image</span><button data-test="reference-close" type="button" @click="close">Close</button></div>
      <p>Selection attaches a copy to your draft. Review it, describe the edit, then Send. Nothing is generated now.</p>
      <div class="reference-choices">
        <button v-for="choice in choices" :key="choice.imageId" :data-test="'reference-' + choice.imageId" type="button" :disabled="busy || disabled" @click="choose(choice)">
          <i class="far fa-image" aria-hidden="true"></i>
          <span>{{ choice.label }}</span><small>{{ choice.imageId }}</small>
        </button>
      </div>
      <p v-if="busy" role="status">Loading selected reference…</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { collectImageReferences, loadImageReference } from '@/services/imageReferencePicker.js';
const props = defineProps({ collection: { type: Object, default: () => ({ scopeKey: '', messages: [] }) }, scopeKey: { type: String, required: true }, disabled: Boolean });
const emit = defineEmits(['attach-files']);
const choices = computed(() => props.scopeKey && props.collection.scopeKey === props.scopeKey ? collectImageReferences(props.collection.messages) : []);
const open = ref(false), busy = ref(false), error = ref('');
let generation = 0, controller;
function cancel() { generation++; controller?.abort(); controller = null; busy.value = false; }
function close() { cancel(); open.value = false; error.value = ''; }
watch(() => props.scopeKey, close, { flush: 'sync' });
watch(() => props.disabled, disabled => { if (disabled) close(); });
watch(open, value => { if (!value) cancel(); });
onBeforeUnmount(cancel);
async function choose(choice) {
  if (busy.value || props.disabled || !choices.value.some(row => row.imageId === choice.imageId)) return;
  const epoch = ++generation, scope = props.scopeKey;
  controller = new AbortController(); busy.value = true; error.value = '';
  try {
    const file = await loadImageReference(choice.imageId, { apiBase: API_CONFIG.BASE_URL, signal: controller.signal });
    if (epoch !== generation || scope !== props.scopeKey || props.disabled || !choices.value.some(row => row.imageId === choice.imageId)) return;
    emit('attach-files', [file], scope); open.value = false;
  } catch (cause) { if (epoch === generation) error.value = cause.message || 'Could not load reference.'; }
  finally { if (epoch === generation) { busy.value = false; controller = null; } }
}
</script>
<style scoped>
.image-reference-picker { padding: 4px 0; font-size: 12px; color: var(--color-text); }
.reference-open, .reference-heading button { background: transparent; color: inherit; border: 1px solid var(--terminal-border-color); padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.reference-panel { margin-top: 6px; padding: 10px; border: 1px solid var(--terminal-border-color); background: var(--color-background); border-radius: 8px; }
.reference-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
p { margin: 8px 0; line-height: 1.5; }
.reference-choices { display: grid; grid-template-columns: repeat(auto-fill,minmax(100px,1fr)); gap: 8px; max-height: 220px; overflow: auto; }
.reference-choices button { display: flex; flex-direction: column; padding: 5px; gap: 4px; background: transparent; color: inherit; border: 1px solid var(--terminal-border-color); border-radius: 6px; cursor: pointer; }
.reference-choices small { overflow-wrap: anywhere; opacity: .7; font-size: 9px; }
.reference-choices i { font-size: 18px; }
button:focus-visible { outline: 2px solid var(--color-green); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: not-allowed; }
</style>
