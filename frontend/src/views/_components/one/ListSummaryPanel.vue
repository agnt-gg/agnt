<template>
  <InspectorShell :caption="caption" :closable="false">
    <InspSection :title="overviewTitle">
      <div class="ls-stats" v-if="stats.length">
        <div v-for="s in stats" :key="s.label" class="ls-stat" :class="{ 'is-live': s.live }" @click="s.onClick && s.onClick()">
          <span class="ls-stat-v">{{ s.value }}</span>
          <span class="ls-stat-l">{{ s.label }}</span>
        </div>
      </div>
      <p v-else class="ls-muted">{{ emptyText }}</p>
    </InspSection>

    <slot></slot>

    <InspSection v-if="hint" title="Inspector">
      <p class="ls-muted">{{ hint }}</p>
    </InspSection>

    <template #footer>
      <slot name="footer">
        <button v-if="primaryLabel" type="button" class="ls-btn pri" @click="$emit('primary')">
          <i class="fas fa-plus"></i> {{ primaryLabel }}
        </button>
        <button v-for="a in actions" :key="a.label" type="button" class="ls-btn" @click="a.onClick && a.onClick()">{{ a.label }}</button>
      </slot>
    </template>
  </InspectorShell>
</template>

<script>
/**
 * ListSummaryPanel — the "nothing selected" state of a list screen's right
 * panel. Replaces the "Select an X to view details" placeholder: instead of
 * telling you the panel is empty, it tells you about the list beside it.
 *
 *   stats   [{ label, value, live?, onClick? }]
 *   hint    one sentence on what selecting does here
 *   primary the screen's one creation verb (emits `primary`)
 *   actions [{ label, onClick }] secondary verbs
 */
import InspectorShell from './InspectorShell.vue';
import InspSection from './InspSection.vue';

export default {
  name: 'ListSummaryPanel',
  components: { InspectorShell, InspSection },
  props: {
    caption: { type: String, required: true },
    overviewTitle: { type: String, default: 'Overview' },
    stats: { type: Array, default: () => [] },
    emptyText: { type: String, default: 'Nothing here yet.' },
    hint: { type: String, default: 'Click a card to inspect it here. Esc comes back to this summary.' },
    primaryLabel: { type: String, default: '' },
    actions: { type: Array, default: () => [] },
  },
  emits: ['primary'],
};
</script>

<style scoped>
.ls-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.ls-stat {
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ls-stat.is-live {
  border-color: rgba(18, 224, 255, 0.3);
}
.ls-stat-v {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ls-stat-l {
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ls-muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.ls-btn {
  height: 28px;
  padding: 0 11px;
  border-radius: 7px;
  border: 1px solid var(--terminal-border-color);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ls-btn.pri {
  background: var(--color-green);
  color: #04120a;
  border-color: var(--color-green);
  font-weight: 600;
}
</style>
