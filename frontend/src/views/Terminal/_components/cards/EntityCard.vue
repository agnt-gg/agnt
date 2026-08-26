<template>
  <!--
    `rootClass` keeps each caller's original root class on the element, so
    caller-scoped modifiers (`.insight-card.applied`) and any external selector
    still resolve. Same reasoning as CategoryNavPanel.
  -->
  <div
    class="entity-card"
    :class="[rootClass, statusClass, { selected, 'is-fixed': layout === 'fixed' }]"
    @click="$emit('click')"
  >
    <div class="card-header">
      <!--
        The icon is a SLOT, not a prop. Experiment and Dataset draw a bare
        1.5em glyph; Insight draws a 32px tile tinted per category. Slotted
        content is styled by the CALLER's scope, so each keeps its own
        `.card-icon` rule exactly where it already lived.
      -->
      <slot name="icon" />

      <div class="card-title-block">
        <span class="card-name">{{ title }}</span>
        <span class="card-category">{{ subtitle }}</span>
      </div>

      <div v-if="actions.length" class="card-actions">
        <Tooltip v-for="action in actions" :key="action.name" :text="action.tooltip">
          <button class="card-btn" :class="action.variant || action.name" @click.stop="$emit('action', action.name)">
            <i :class="action.icon"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <p v-if="renderDescription" class="card-description" :class="descriptionClass">{{ description }}</p>

    <!--
      Everything below the description — the middle band and the footer — is
      caller-supplied, INCLUDING its wrapper divs. That is deliberate: a
      `.card-footer` div declared here would carry this component's scope and
      the caller's `.card-footer` rule would stop matching. The three footers
      are genuinely different, so they stay with their owners.
    -->
    <slot />
  </div>
</template>

<script setup>
/**
 * The shared frame behind the entity cards on the Evolution screens.
 *
 * ExperimentCard, InsightCard and DatasetCard each shipped their own copy of
 * the same skeleton — header (icon + title + subtitle + hover actions),
 * description, then a body — with six byte-identical CSS rules between them.
 * They now supply the parts that actually differ and share the parts that
 * never did.
 */
import { computed } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const props = defineProps({
  /** Legacy root class, preserved for caller-scoped modifiers. */
  rootClass: { type: String, default: '' },
  /** Extra state class on the root (Insight puts its status here). */
  statusClass: { type: String, default: '' },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  description: { type: String, default: '' },
  /** plain | quote (italic) | clamp (three lines, fills the card). */
  descriptionStyle: { type: String, default: 'plain' },
  /**
   * `null` (default) renders the description only when there is text.
   * Pass `true` to always reserve the row — a fixed-height card whose
   * description disappears re-flows everything below it.
   */
  showDescription: { type: [Boolean, null], default: null },
  selected: { type: Boolean, default: false },
  /** auto | fixed (120px flex column). */
  layout: { type: String, default: 'auto' },
  /** `[{ name, icon, tooltip, variant }]` — emits `action` with `name`. */
  actions: { type: Array, default: () => [] },
});

defineEmits(['click', 'action']);

const renderDescription = computed(() =>
  props.showDescription === null ? !!props.description : props.showDescription,
);

const descriptionClass = computed(() => ({
  'is-quote': props.descriptionStyle === 'quote',
  'is-clamped': props.descriptionStyle === 'clamp',
}));
</script>

<style scoped>
.entity-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.entity-card:hover {
  border-color: rgba(var(--green-rgb), 0.4);
  background: var(--color-darker-1);
}
.entity-card.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}
.entity-card.is-fixed {
  height: 120px;
  display: flex;
  flex-direction: column;
}

/* Header */
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.entity-card.is-fixed .card-header {
  flex-shrink: 0;
}
.card-title-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.card-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-category {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Actions — revealed on hover */
.card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.entity-card:hover .card-actions {
  opacity: 1;
}
.card-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-grey);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75em;
  transition: all 0.15s;
}
.card-btn:hover {
  color: var(--color-text);
  background: rgba(var(--green-rgb), 0.2);
}
.card-btn.run:hover,
.card-btn.apply:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.15);
}
.card-btn.reject:hover {
  color: var(--status-amber-text);
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.1);
}
.card-btn.delete:hover {
  color: var(--color-red);
  border-color: rgba(255, 77, 79, 0.3);
  background: rgba(255, 77, 79, 0.1);
}

/* Description */
.card-description {
  font-size: 0.85em;
  color: var(--color-grey);
  margin: 0 0 8px;
  line-height: 1.4;
}
.card-description.is-quote {
  font-style: italic;
}
.card-description.is-clamped {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
</style>
