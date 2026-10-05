<template>
  <div class="insp" :class="{ 'insp-item': !!title }">
    <!-- Panel caption: what this panel is ABOUT. Two states: a screen summary
         (caption only) or a selected item (caption + identity + tabs + ✕). -->
    <div class="insp-cap">
      <span class="insp-cap-text">{{ caption }}</span>
      <span v-if="live" class="insp-live">live</span>
      <span class="insp-cap-sp"></span>
      <slot name="cap-actions"></slot>
      <button v-if="title && closable" class="insp-x" type="button" v-tooltip="'Back (Esc)'" @click="$emit('close')">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <div v-if="title" class="insp-head">
      <div class="insp-id">
        <span v-if="icon" class="insp-tile" :class="'tone-' + tone"><i :class="icon"></i></span>
        <div class="insp-titles">
          <div class="insp-title">{{ title }}</div>
          <div v-if="sub" class="insp-sub">{{ sub }}</div>
        </div>
        <span v-if="badge" class="insp-badge" :class="'tone-' + (badgeTone || tone)">{{ badge }}</span>
      </div>
      <div v-if="tabs && tabs.length" class="insp-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          class="insp-tab"
          :class="{ on: activeTab === t.id }"
          :aria-selected="activeTab === t.id"
          @click="$emit('update:tab', t.id)"
        >
          {{ t.label }}<span v-if="t.count != null" class="insp-tab-count">{{ t.count }}</span>
        </button>
      </div>
    </div>

    <div class="insp-body">
      <slot></slot>
    </div>

    <div v-if="$slots.footer" class="insp-foot">
      <slot name="footer"></slot>
    </div>
  </div>
</template>

<script>
/**
 * InspectorShell — the one shape every right panel uses.
 *
 *   caption   what the panel is about ("This conversation", "Inspector")
 *   title     the selected item's name; empty = the screen-summary state
 *   sub/badge one line of meta + a status chip
 *   tabs      [{ id, label, count? }] with v-model:tab
 *   footer    the item's verbs (slot)
 *
 * Learn it once: an agent, a run, a workflow, a plugin and a connection all
 * read the same way. The body is a scroll region; callers put <InspSection>
 * blocks in it.
 */
export default {
  name: 'InspectorShell',
  props: {
    caption: { type: String, default: 'Inspector' },
    live: { type: Boolean, default: false },
    title: { type: String, default: '' },
    sub: { type: String, default: '' },
    icon: { type: String, default: '' },
    badge: { type: String, default: '' },
    badgeTone: { type: String, default: '' },
    /** green · blue · yellow · red · pink · indigo · neutral */
    tone: { type: String, default: 'neutral' },
    tabs: { type: Array, default: () => [] },
    activeTab: { type: String, default: '' },
    closable: { type: Boolean, default: true },
  },
  emits: ['close', 'update:tab'],
};
</script>

<style scoped>
.insp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
}
.insp-cap {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  flex: 0 0 auto;
  padding: 0 2px 0 4px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.insp-cap-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.insp-cap-sp {
  flex: 1;
}
.insp-live {
  font-size: 9px;
  letter-spacing: 0.09em;
  padding: 0 6px;
  height: 16px;
  line-height: 16px;
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}
.insp-x {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.insp-x:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}
.insp-head {
  flex: 0 0 auto;
  padding: 12px 4px 0;
}
.insp-id {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.insp-tile {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  font-size: 14px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}
.insp-titles {
  flex: 1;
  min-width: 0;
}
.insp-title {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-sub {
  font-size: 10.5px;
  color: var(--color-text-dull, #767888);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.insp-badge {
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  padding: 0 7px;
  height: 18px;
  line-height: 18px;
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  background: var(--color-darker-0);
  white-space: nowrap;
  flex: 0 0 auto;
}
.tone-green {
  color: var(--text-green);
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.1);
}
.tone-blue {
  color: var(--text-blue);
  border-color: rgba(18, 224, 255, 0.3);
  background: rgba(var(--blue-rgb), 0.1);
}
.tone-yellow {
  color: var(--text-yellow);
  border-color: rgba(255, 215, 0, 0.3);
  background: rgba(var(--yellow-rgb), 0.09);
}
.tone-red {
  color: var(--color-red);
  border-color: rgba(254, 78, 78, 0.3);
  background: rgba(var(--red-rgb), 0.1);
}
.tone-pink {
  color: var(--color-pink);
  border-color: rgba(229, 61, 143, 0.3);
  background: rgba(var(--pink-rgb), 0.1);
}
.tone-indigo {
  color: var(--color-indigo);
  border-color: rgba(125, 61, 229, 0.35);
  background: rgba(var(--indigo-rgb), 0.14);
}
.insp-tabs {
  display: flex;
  gap: 2px;
  margin-top: 10px;
  padding: 3px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 9px;
  background: var(--color-darker-0);
  overflow-x: auto;
  scrollbar-width: none;
}
.insp-tabs::-webkit-scrollbar {
  display: none;
}
.insp-tab {
  flex: 1 0 auto;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.insp-tab.on {
  color: var(--text-green);
  background: rgba(var(--green-rgb), 0.14);
}
.insp-tab-count {
  margin-left: 5px;
  font-size: 9.5px;
  opacity: 0.7;
}
.insp-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 4px 12px;
  scrollbar-width: thin;
}
.insp-foot {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 10px 4px 2px;
  border-top: 1px solid var(--terminal-border-color);
}
</style>
