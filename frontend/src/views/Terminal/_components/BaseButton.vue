<template>
  <button
    :class="['base-button', variant, { 'full-width': fullWidth }, { 'is-disabled': disabled }]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot></slot>
  </button>
</template>

<script>
export default {
  name: 'BaseButton',
  props: {
    variant: {
      type: String,
      default: 'primary',
      validator: (value) => ['primary', 'success', 'danger', 'secondary'].includes(value),
    },
    fullWidth: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['click'],
};
</script>

<style scoped>
.base-button {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  align-content: center;
  flex-wrap: nowrap;
  flex-direction: row;
  background: transparent;
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  padding: 12px 12px 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.3s ease;
  position: relative;
  z-index: 3;
  font-size: 1em;
  text-wrap-mode: nowrap;
  width: 100%;
}

.base-button.icon {
  padding-top: 8px;
}

/* background-COLOR, not the `background` shorthand.

   The shorthand resets background-image, so a hover state written that way
   DESTROYS any fill a consumer set with `background-image` — while leaving the
   ink that was chosen for that fill. background-color paints UNDERNEATH an
   image, so this tint shows on a plain button and is simply covered on a filled
   one. Same intent, no collateral. */
.base-button:hover {
  background-color: rgba(var(--primary-rgb), 0.1);
  box-shadow: var(--glow-accent);
}

.base-button:focus {
  box-shadow: var(--glow-accent-strong);
  background-color: rgba(var(--primary-rgb), 0.15);
  outline: none;
}

.base-button.success {
  border-color: var(--color-green);
  color: var(--color-green);
}

.base-button.success:hover {
  background: rgba(var(--green-rgb), 0.1);
  box-shadow: var(--glow-success);
}

.base-button.success:focus {
  box-shadow: var(--glow-success);
  background: rgba(var(--green-rgb), 0.15);
}

.base-button.danger {
  border-color: var(--color-red);
  color: var(--color-red);
}

.base-button.danger:hover {
  background: rgba(239, 25, 25, 0.1);
  box-shadow: 0 0 8px rgba(239, 25, 25, 0.5);
}

.base-button.danger:focus {
  box-shadow: 0 0 12px rgba(239, 25, 25, 0.7);
  background: rgba(239, 25, 25, 0.15);
}

.base-button.secondary {
  border-color: var(--terminal-border-color);
  color: var(--color-text-muted);
}

.base-button.secondary:hover {
  background: rgba(var(--primary-rgb), 0.05);
  box-shadow: var(--glow-accent);
  color: var(--color-text);
}

.base-button.secondary:focus {
  box-shadow: var(--glow-accent-strong);
  background: rgba(var(--primary-rgb), 0.08);
}

.base-button.full-width {
  width: 100%;
}

/* A DISABLED BUTTON IS DIMMED, NOT STRIPPED.

   This used to set `background: transparent`, which reset background-image and
   removed a consumer's fill while its on-fill ink survived — white text on the
   bare panel. A fill and the ink chosen for it are a PAIR; no state may remove
   one without the other. `opacity` dims the whole button, so the pair survives.

   BUT OPACITY IS NOT FREE: it composites the entire element with the page, so
   ink and fill BOTH move toward the canvas and their mutual contrast collapses.
   White-on-teal measured 6.46:1 declared and only 2.30:1 as rendered at 0.5,
   because white ink over a white page barely moves while the fill washes out
   fast. Light mode is the worst case; dark measured 3.83:1 at the same value.

   0.65 is the measured floor that keeps the label readable in light mode
   (3.07:1) while still reading as clearly inactive. WCAG 1.4.3 exempts
   inactive controls from the 4.5:1 bar, but "exempt" is not "illegible" — the
   original report on this button was that its label could not be seen. */
.base-button.is-disabled {
  opacity: 0.65;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
