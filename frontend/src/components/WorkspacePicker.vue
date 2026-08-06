<template>
  <div class="workspace-picker">
    <label v-if="label" class="wp-label" :for="inputId">{{ label }}</label>

    <div class="wp-row">
      <input
        :id="inputId"
        ref="inputEl"
        class="wp-input"
        :class="{ invalid: Boolean(error) }"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :value="modelValue"
        :placeholder="placeholder || defaultPath || 'Choose a folder…'"
        :aria-describedby="`${inputId}-hint`"
        :aria-invalid="error ? 'true' : undefined"
        v-tooltip="modelValue || placeholder || defaultPath || ''"
        @input="$emit('update:modelValue', $event.target.value)"
        @keyup.enter="$emit('submit')"
        @keyup.escape="$emit('cancel')"
      />

      <!-- Typing a path stays available in every context. The button is the
           easy road, never the only one — see useDirectoryPicker for the two
           contexts that have no native dialog to offer. -->
      <button
        v-if="available"
        type="button"
        class="wp-browse"
        :disabled="browsing"
        @click="onBrowse"
      >
        <SvgIcon name="folder" />
        {{ browsing ? 'Choosing…' : 'Browse…' }}
      </button>
    </div>

    <!-- One reserved slot. Swapping a hint for an error of a different height
         moved every control below it, which reads as the form flinching. -->
    <p :id="`${inputId}-hint`" class="wp-hint" :class="{ error: Boolean(error) }">
      <template v-if="error">{{ error }}</template>
      <template v-else-if="unavailableReason === 'remote-backend'">
        AGNT is using the server at <span class="wp-path">{{ remoteUrl || 'another machine' }}</span>,
        so this path is on that machine and can't be browsed from here. Type it instead.
      </template>
      <!-- Only when it ADDS something. While the field is empty the placeholder
           already shows the default, and repeating it verbatim underneath spent
           a row to say nothing. -->
      <template v-else-if="defaultPath && modelValue">
        Default: <span class="wp-path">{{ defaultPath }}</span>
      </template>
      <template v-else-if="defaultPath">Leave blank to use the folder shown above.</template>
      <template v-else>Leave blank to use the default location.</template>
    </p>
  </div>
</template>

<script>
import { ref } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { useDirectoryPicker } from '@/composables/useDirectoryPicker.js';

export default {
  name: 'WorkspacePicker',
  components: { SvgIcon },
  props: {
    modelValue: { type: String, default: '' },
    /** The path used when the field is left empty. Shown, never submitted. */
    defaultPath: { type: String, default: '' },
    /** Validation or save failure from the parent, shown in place of the hint. */
    error: { type: String, default: '' },
    label: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    /** Unique so the label and hint can reference it on a page with two fields. */
    inputId: { type: String, default: 'workspace-root' },
    /** Title bar of the native dialog. */
    dialogTitle: { type: String, default: 'Choose your workspace folder' },
  },
  emits: ['update:modelValue', 'submit', 'cancel', 'browsed'],
  setup(props, { emit }) {
    const { available, unavailableReason, remoteUrl, browse } = useDirectoryPicker();
    const browsing = ref(false);
    const inputEl = ref(null);

    const onBrowse = async () => {
      if (browsing.value) return;
      browsing.value = true;
      try {
        // Open where they already are, so "Browse" refines the current answer
        // rather than dropping them at an unrelated corner of the disk.
        const chosen = await browse({
          defaultPath: props.modelValue || props.defaultPath || '',
          title: props.dialogTitle,
        });
        // Null covers cancel as well as failure. Both mean "leave it alone" —
        // clearing the field because someone changed their mind would be its
        // own small betrayal.
        if (!chosen) return;
        emit('update:modelValue', chosen);
        emit('browsed', chosen);
      } finally {
        browsing.value = false;
      }
    };

    /**
     * Exposed because the field is now inside this component while the dialogs
     * that open it still own "focus the path when I appear". Returning it from
     * setup() puts it on the component instance, so `ref.focus()` at the call
     * site keeps working unchanged whether the ref points at an <input> or at
     * this component.
     */
    const focus = () => inputEl.value?.focus();

    return { available, unavailableReason, remoteUrl, browsing, inputEl, onBrowse, focus };
  },
};
</script>

<style scoped>
.workspace-picker {
  width: 100%;
  text-align: left;
}

/* Matches the form-label treatment already used by the onboarding steps, so a
   user moving between fields does not see two conventions on one screen. */
.wp-label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.wp-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

/* No `background` here on purpose: text fields take their fill from the app's
   zero-specificity default, which is the only one that stays legible in every
   theme. themeSurfaces.spec.js enforces this. */
.wp-input {
  flex: 1;
  /* Without an explicit minimum a flex item refuses to shrink below its content
     width, so a long path pushes the button out of a narrow sidebar. */
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-family: var(--font-family-mono, monospace);
  font-size: 0.9em;
  /* A path is usually wider than the field, and in a sidebar always is. An
     ellipsis says "there is more" where a hard mid-token clip reads as a
     rendering bug; the full string is on the tooltip either way. */
  text-overflow: ellipsis;
}

.wp-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

/* Bind the failure to the control that caused it. A red sentence under an
   otherwise untouched field reads as page-level noise rather than as this
   field being wrong. */
.wp-input.invalid {
  border-color: var(--color-red);
}

/* Deliberately NOT the field's treatment. Both started as a dark fill behind a
   hairline border, so the eye parsed the row as "input, input" rather than
   "input, action" — and the button was actually the DARKER of the two, reading
   as recessed when it is the one thing here you can press. The brighter outline
   over a transparent ground is the same affordance the provider tiles use. */
.wp-browse {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 0 16px;
  border: 1px solid var(--color-text-muted);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.wp-browse:hover:not(:disabled) {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.wp-browse:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.wp-browse:disabled {
  opacity: 0.6;
  cursor: default;
}

/* Sized below cap-height and painted with currentColor. SvgIcon paints every
   path with --color-text from a global rule, and an icon with no size falls
   back to its intrinsic dimensions — together that renders a framed glyph
   larger and brighter than the label beside it. */
.wp-browse :deep(.svg-icon) {
  display: inline-flex;
  width: 0.85em;
  height: 0.85em;
  color: inherit;
}

.wp-browse :deep(.svg-icon svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.wp-browse :deep(.svg-icon path[fill]) {
  fill: currentColor;
}

.wp-browse :deep(.svg-icon path[stroke]) {
  stroke: currentColor;
}

.wp-hint {
  margin: 8px 0 0;
  /* Reserves the row so the layout does not jump when a hint becomes an error. */
  min-height: 1.5em;
  font-size: 0.82em;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.wp-hint.error {
  color: var(--color-red);
}

/* A SPAN, not <code>.
   `<code>` is a syntax-highlighting element in this app: global rules give it
   `font-size: var(--font-size-sm)` — an ABSOLUTE 14px that ignores the density
   it sits in — and the highlight.js theme paints every `code` with
   --color-pink. In the sidebar dialog that made the default path the largest
   text in the box, bigger than the field and the title, and coloured close
   enough to --color-red to read as a warning. Chrome is not a code block. */
.wp-path {
  font-family: var(--font-family-mono, monospace);
  font-size: 0.95em;
  color: var(--color-text);
  /* The longest unbroken string on the screen; let it wrap rather than widen a
     sidebar dialog past its container. */
  overflow-wrap: anywhere;
}
</style>
