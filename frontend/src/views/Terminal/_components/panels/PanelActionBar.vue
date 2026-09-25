<template>
  <!-- Top of a collection screen's right panel: the one place to create. -->
  <div class="panel-action-bar">
    <button type="button" class="pab-create" :data-tour-id="tourId || undefined" @click="$emit('panel-action', 'create')">
      <i class="fas fa-plus" aria-hidden="true"></i>
      <span>{{ createLabel }}</span>
    </button>
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      class="pab-secondary"
      :aria-label="action.label"
      v-tooltip="action.label"
      @click="$emit('panel-action', action.id)"
    >
      <i :class="action.icon" aria-hidden="true"></i>
    </button>
  </div>
</template>

<script>
export default {
  name: 'PanelActionBar',
  props: {
    createLabel: { type: String, required: true },
    /** Guided-tour anchor for the create button (see utils/tourTargets.js). */
    tourId: { type: String, default: '' },
    /** Secondary, icon-only actions: [{ id, label, icon }]; `id` is emitted as the panel action. */
    actions: { type: Array, default: () => [] },
  },
  emits: ['panel-action'],
};
</script>

<style scoped>
.panel-action-bar {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pab-create {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid rgba(var(--primary-rgb), 0.35);
  border-radius: 10px;
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--color-primary);
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.pab-create:hover,
.pab-create:focus-visible {
  background: rgba(var(--primary-rgb), 0.16);
  border-color: rgba(var(--primary-rgb), 0.6);
  outline: none;
}

.pab-secondary {
  width: 40px;
  flex-shrink: 0;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.pab-secondary:hover,
.pab-secondary:focus-visible {
  color: var(--color-text);
  border-color: rgba(var(--primary-rgb), 0.4);
  outline: none;
}
</style>
