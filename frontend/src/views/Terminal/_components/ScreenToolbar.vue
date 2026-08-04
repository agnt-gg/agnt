<template>
  <div class="wm-header">
    <div class="wm-header-left">
      <span class="wm-title">{{ title }}</span>
      <span class="wm-count">{{ count }} {{ countLabel }}</span>
    </div>
    <div class="wm-header-right">
      <!--
        When the screen has nothing of its own, this input filters an empty set
        and is inert chrome. Rather than add a SECOND search box for the
        marketplace shelf, the shelf borrows this one — `searchScope` makes the
        change of meaning visible instead of magic, so the user is never typing
        into a box whose target silently moved.
      -->
      <div class="wm-search-wrap" :class="{ scoped: !!searchScope }">
        <input
          type="text"
          class="wm-search-input"
          :placeholder="searchScope ? `Search the marketplace for ${countLabel}…` : searchPlaceholder"
          :value="searchQuery"
          @input="$emit('update:searchQuery', $event.target.value)"
        />
        <span v-if="searchScope" class="wm-search-scope"><i class="fas fa-store"></i>{{ searchScope }}</span>
      </div>
      <Tooltip v-if="showCollapseToggle" :text="allCategoriesCollapsed ? 'Expand all categories' : 'Collapse all categories'" width="auto">
        <button class="wm-btn" :class="{ active: allCategoriesCollapsed }" @click="$emit('toggleCollapseAll')">
          <i :class="allCategoriesCollapsed ? 'fas fa-expand' : 'fas fa-compress'"></i>
        </button>
      </Tooltip>
      <Tooltip v-if="showHideEmpty" :text="hideEmptyCategories ? 'Show empty categories' : 'Hide empty categories'" width="auto">
        <button class="wm-btn" :class="{ active: hideEmptyCategories }" @click="$emit('toggleHideEmpty')">
          <i :class="hideEmptyCategories ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
        </button>
      </Tooltip>
      <Tooltip :text="sortOrder === 'az' ? 'Sort Z → A' : 'Sort A → Z'" width="auto">
        <button class="wm-btn" @click="$emit('update:sortOrder', sortOrder === 'az' ? 'za' : 'az')">
          <i :class="sortOrder === 'az' ? 'fas fa-sort-alpha-down' : 'fas fa-sort-alpha-up-alt'"></i>
        </button>
      </Tooltip>
      <Tooltip v-for="opt in layoutOptions" :key="opt" :text="layoutLabels[opt] || opt" width="auto">
        <button class="wm-btn" :class="{ active: currentLayout === opt }" @click="$emit('update:layout', opt)">
          <i :class="layoutIcons[opt] || 'fas fa-th-large'"></i>
        </button>
      </Tooltip>
      <slot name="extra-buttons"></slot>
      <Tooltip v-if="createLabel" :text="createLabel" width="auto">
        <button class="wm-btn wm-btn-create" @click="$emit('create')">
          <i class="fas fa-plus"></i>
          <span>{{ createLabel }}</span>
        </button>
      </Tooltip>
    </div>
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ScreenToolbar',
  components: { Tooltip },
  props: {
    title: { type: String, required: true },
    count: { type: Number, default: 0 },
    countLabel: { type: String, default: 'items' },
    searchPlaceholder: { type: String, default: 'Search...' },
    searchQuery: { type: String, default: '' },
    /** Non-empty when another surface (the marketplace shelf) has borrowed this input. */
    searchScope: { type: String, default: '' },
    currentLayout: { type: String, default: 'grid' },
    layoutOptions: { type: Array, default: () => ['grid', 'table'] },
    showCollapseToggle: { type: Boolean, default: true },
    allCategoriesCollapsed: { type: Boolean, default: false },
    showHideEmpty: { type: Boolean, default: true },
    hideEmptyCategories: { type: Boolean, default: true },
    sortOrder: { type: String, default: 'az' },
    createLabel: { type: String, default: '' },
  },
  emits: ['update:searchQuery', 'update:layout', 'toggleCollapseAll', 'toggleHideEmpty', 'update:sortOrder', 'create'],
  setup() {
    const layoutLabels = {
      grid: 'Grid View',
      table: 'Table View',
      list: 'List View',
    };
    const layoutIcons = {
      grid: 'fas fa-th-large',
      table: 'fas fa-table',
      list: 'fas fa-table',
    };
    return { layoutLabels, layoutIcons };
  },
};
</script>

<style scoped>
/* ── Header ── */
.wm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
  width: calc(100% - 32px);
}

.wm-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wm-title {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--color-green);
  font-weight: 600;
}

.wm-count {
  font-size: 10px;
  color: var(--color-text-muted);
  padding: 1px 6px;
  background: var(--color-darker-0);
  border-radius: 3px;
}

.wm-header-right {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.wm-header-right :deep(.tooltip-container) {
  display: flex;
}

.wm-header-right .wm-btn {
  align-self: stretch;
}

.wm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.wm-search-wrap.scoped .wm-search-input {
  /* room for the chip, which is absolutely positioned so the input keeps its
     own hit area and focus ring */
  padding-right: 122px;
  width: 320px;
  border-color: rgba(var(--blue-rgb), 0.4);
}

.wm-search-scope {
  position: absolute;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 6px;
  background: rgba(var(--blue-rgb), 0.12);
  border: 1px solid rgba(var(--blue-rgb), 0.35);
  color: var(--color-secondary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  pointer-events: none;
  white-space: nowrap;
}

.wm-search-input {
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-light-green);
  font-size: 0.9em;
  font-family: inherit;
  outline: none;
  width: 200px;
}

.wm-search-input:focus {
  border-color: var(--color-green);
}

.wm-search-input::placeholder {
  color: var(--color-text-muted);
}

.wm-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: none;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: 0.5px;
}

.wm-btn:hover {
  color: var(--color-text);
  border-color: var(--terminal-border-color);
}

.wm-btn.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

.wm-btn-create {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

.wm-btn-create:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
}
</style>
