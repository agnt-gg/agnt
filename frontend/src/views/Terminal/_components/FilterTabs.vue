<template>
  <!--
    The root element stays `.wm-tabs`. Screens carry parent-scoped overrides
    such as `.agents-panel.has-details.expanded .wm-tabs { display: none }`;
    a child component's root receives the PARENT's scope id as well as its own,
    so those overrides keep matching. Renaming this root would silently break
    them.
  -->
  <div class="wm-tabs">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="wm-tab"
      :class="{ active: active === tab.id }"
      @click="$emit('select', tab.id)"
    >
      <i :class="tab.icon"></i> {{ labelOf(tab) }}
    </button>

    <!--
      A second, independent group behind a divider (Runs filters by status AND
      by type). Kept as explicit props rather than a slot because slotted
      content is styled by the PARENT's scope, so a slot would force every
      caller to re-declare .wm-tab — which is the duplication this removes.
    -->
    <template v-if="secondaryTabs.length">
      <span class="wm-tab-separator"></span>
      <button
        v-for="tab in secondaryTabs"
        :key="tab.id"
        class="wm-tab"
        :class="{ active: secondaryActive === tab.id }"
        @click="$emit('select-secondary', tab.id)"
      >
        <i :class="tab.icon"></i> {{ labelOf(tab) }}
      </button>
    </template>
  </div>
</template>

<script>
/**
 * The horizontal filter strip under a screen's toolbar.
 *
 * Agents, Tools, Workflows, WidgetManager and Runs each carried this markup
 * plus a byte-identical five-rule stylesheet. One divergence in any copy and
 * the screens stop matching, which is exactly what had started to happen.
 *
 * Tabs FILTER, they never navigate.
 */
export default {
  name: 'FilterTabs',
  props: {
    /** `{ id, icon, name|label }` — both label keys are accepted. */
    tabs: { type: Array, default: () => [] },
    /** id of the selected tab. */
    active: { type: [String, Number], default: null },
    secondaryTabs: { type: Array, default: () => [] },
    secondaryActive: { type: [String, Number], default: null },
  },
  emits: ['select', 'select-secondary'],
  methods: {
    labelOf(tab) {
      return tab.name ?? tab.label ?? '';
    },
  },
};
</script>

<style scoped>
.wm-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  overflow-x: auto;
  flex-shrink: 0;
  width: calc(100% - 32px);
  justify-content: center;
}

.wm-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--color-text-muted);
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
  font-family: inherit;
}

.wm-tab:hover {
  color: var(--color-text);
  border-color: var(--color-darker-1);
}

.wm-tab.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

.wm-tab i {
  font-size: 10px;
}

.wm-tab-separator {
  width: 1px;
  background: var(--terminal-border-color);
  margin: 0 8px;
  align-self: stretch;
}
</style>
