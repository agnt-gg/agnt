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

.base-button:hover {
  background: rgba(var(--primary-rgb), 0.1);
  box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.5);
}

.base-button:focus {
  box-shadow: 0 0 12px rgba(var(--primary-rgb), 0.7);
  background: rgba(var(--primary-rgb), 0.15);
  outline: none;
}

.base-button.success {
  border-color: var(--color-green);
  color: var(--color-green);
}

.base-button.success:hover {
  background: rgba(var(--green-rgb), 0.1);
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.5);
}

.base-button.success:focus {
  box-shadow: 0 0 12px rgba(var(--green-rgb), 0.7);
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
  box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.2);
  color: var(--color-text);
}

.base-button.secondary:focus {
  box-shadow: 0 0 12px rgba(var(--primary-rgb), 0.3);
  background: rgba(var(--primary-rgb), 0.08);
}

.base-button.full-width {
  width: 100%;
}

.base-button.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: transparent;
  box-shadow: none;
}
</style>
