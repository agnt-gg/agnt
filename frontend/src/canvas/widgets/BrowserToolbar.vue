<template>
  <form class="browser-toolbar" aria-label="Browser navigation" @submit.prevent="submitAddress">
    <div class="nav-buttons">
      <button
        type="button"
        class="nav-button"
        aria-label="Back"
        :disabled="!canGoBack || busy"
        v-tooltip="'Back'"
        @click="$emit('back')"
      ><i class="fas fa-arrow-left"></i></button>
      <button
        type="button"
        class="nav-button"
        aria-label="Forward"
        :disabled="!canGoForward || busy"
        v-tooltip="'Forward'"
        @click="$emit('forward')"
      ><i class="fas fa-arrow-right"></i></button>
      <button
        type="button"
        class="nav-button"
        aria-label="Reload"
        :disabled="busy"
        v-tooltip="'Reload'"
        @click="$emit('reload')"
      ><i class="fas fa-redo-alt"></i></button>
    </div>

    <i class="fas fa-lock address-security" aria-hidden="true"></i>
    <input
      ref="addressRef"
      v-model="draftUrl"
      class="address-input"
      aria-label="Address"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @focus="editing = true"
      @blur="finishEditing"
      @keydown.esc="cancelEditing"
    />
    <button type="submit" class="go-button" :disabled="busy || !draftUrl.trim()">Go</button>
  </form>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  url: { type: String, default: '' },
  canGoBack: { type: Boolean, default: false },
  canGoForward: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['back', 'forward', 'reload', 'navigate']);
const addressRef = ref(null);
const draftUrl = ref(props.url || 'about:blank');
const editing = ref(false);

watch(() => props.url, (url) => {
  if (!editing.value) draftUrl.value = url || 'about:blank';
});

function normalizeBrowserAddress(value) {
  const address = String(value || '').trim();
  if (!address) return '';
  if (/^https?:\/\//i.test(address)) return address;
  return `https://${address}`;
}

function submitAddress() {
  const url = normalizeBrowserAddress(draftUrl.value);
  if (!url) return;
  draftUrl.value = url;
  editing.value = false;
  addressRef.value?.blur();
  emit('navigate', url);
}

function finishEditing() {
  editing.value = false;
  if (!draftUrl.value.trim()) draftUrl.value = props.url || 'about:blank';
}

function cancelEditing() {
  draftUrl.value = props.url || 'about:blank';
  editing.value = false;
  addressRef.value?.blur();
}
</script>

<style scoped>
.browser-toolbar {
  flex: 0 0 38px;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-popup);
}

.nav-buttons {
  display: flex;
  align-items: center;
  gap: 2px;
}

.nav-button,
.go-button {
  height: 27px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.nav-button {
  width: 28px;
  padding: 0;
}

.nav-button:hover:not(:disabled),
.go-button:hover:not(:disabled) {
  background: var(--color-darker-0);
  color: var(--color-text);
}

.nav-button:disabled,
.go-button:disabled {
  cursor: default;
  opacity: 0.32;
}

.address-security {
  margin-left: 2px;
  color: var(--color-green);
  font-size: 10px;
}

.address-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 27px;
  padding: 0 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  outline: none;
  background: var(--color-darker-0);
  color: var(--color-text);
  font: inherit;
  font-size: 11px;
}

.address-input:focus {
  border-color: var(--color-green);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.14);
}

.go-button {
  padding: 0 9px;
  font-size: 11px;
  font-weight: 600;
}
</style>
