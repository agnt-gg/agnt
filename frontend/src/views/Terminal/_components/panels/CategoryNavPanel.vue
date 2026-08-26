<template>
  <!--
    `rootClass` keeps each panel's original root class on the element.
    That is NOT cosmetic: the screen tutorials target '.agents-panel',
    '.tools-panel' and '.workflows-panel' as raw DOM selectors, so dropping
    the class would silently break coach-mark positioning.
  -->
  <div class="category-nav-panel" :class="rootClass">
    <div class="panel-header">
      <h2 class="title">{{ title }}</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i :class="icon"></i>
          {{ count }}
        </span>
      </div>
    </div>

    <div class="panel-content">
      <SidebarCategories
        :categories="categories"
        :items="items"
        :selected-category="selectedCategory"
        :selected-main-category="selectedMainCategory"
        title="Categories"
        :show-all-option="true"
        :all-option-label="allOptionLabel"
        :all-option-icon="allOptionIcon || icon"
        :main-categories="mainCategories"
        :item-category-key="itemCategoryKey"
        @category-selected="onCategorySelected"
        @all-selected="onAllSelected"
      />
    </div>
  </div>
</template>

<script>
/**
 * The left-hand "browse by category" panel.
 *
 * Agents, Tools, Workflows, Skills and WidgetManager each shipped their own
 * copy of this: identical markup, identical 104-line stylesheet, identical
 * selection handlers, differing only in which store they read and what noun
 * they print. They now supply data and this renders it.
 *
 * Selection state lives HERE because it is panel-local: the panel tracks what
 * is highlighted and reports changes upward via `panel-action`, exactly as the
 * five originals did. The event name and payload are unchanged, so every
 * screen listening for 'category-filter-changed' keeps working untouched.
 */
import { ref } from 'vue';
import SidebarCategories from '@/views/Terminal/_components/SidebarCategories.vue';

export default {
  name: 'CategoryNavPanel',
  components: { SidebarCategories },
  props: {
    /** Legacy root class, preserved for tutorial selectors. */
    rootClass: { type: String, default: '' },
    /** Header text, e.g. "/ Agents". */
    title: { type: String, required: true },
    /** Font Awesome class for the header stat and the "all" row. */
    icon: { type: String, required: true },
    /** Records being categorized. */
    items: { type: Array, default: () => [] },
    /** Flat list of category codes. */
    categories: { type: Array, default: () => [] },
    /** Grouped `{ code, label }` pairs — see categoryDerivations.js. */
    mainCategories: { type: Array, default: () => [] },
    allOptionLabel: { type: String, required: true },
    allOptionIcon: { type: String, default: '' },
    itemCategoryKey: { type: String, default: 'category' },
    /**
     * When a main category is picked, report its CODE rather than its label.
     * Widget records store lowercase codes while SidebarCategories emits the
     * display label, so that panel filters on the code or matches nothing.
     */
    mainCategoryUsesCode: { type: Boolean, default: false },
    /** Override the header count; defaults to items.length. */
    total: { type: Number, default: null },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const selectedCategory = ref(null);
    const selectedMainCategory = ref(null);

    const onAllSelected = () => {
      selectedMainCategory.value = null;
      selectedCategory.value = null;
      emit('panel-action', 'category-filter-changed', {
        selectedCategory: null,
        selectedMainCategory: null,
        type: 'all-selected',
      });
    };

    const onCategorySelected = (payload) => {
      if (payload.isMainCategory) {
        selectedMainCategory.value = payload.mainCategory;
        selectedCategory.value = props.mainCategoryUsesCode ? payload.mainCategory : payload.category;
      } else {
        selectedMainCategory.value = null;
        selectedCategory.value = payload.category;
      }
      emit('panel-action', 'category-filter-changed', {
        selectedCategory: selectedCategory.value,
        selectedMainCategory: selectedMainCategory.value,
        type: 'category-selected',
        payload,
      });
    };

    return { selectedCategory, selectedMainCategory, onAllSelected, onCategorySelected };
  },
  computed: {
    count() {
      return this.total === null ? this.items.length : this.total;
    },
  },
};
</script>

<style scoped>
.category-nav-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
}

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}

.panel-header .title {
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.panel-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  opacity: 0.8;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
}

.panel-content::-webkit-scrollbar {
  display: none;
}

/* Ensure the sidebar categories component fills the available space */
:deep(.sidebar-categories) {
  width: 100%;
  padding-left: 0;
  padding-right: 0;
  border-right: none;
  height: auto;
}

/* Adjust category item styling for the panel context */
:deep(.category-item) {
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 2px;
}

:deep(.category-item:hover) {
  background-color: rgba(var(--primary-rgb), 0.1);
}

:deep(.category-item.active) {
  background-color: rgba(var(--primary-rgb), 0.15);
  border-left: 3px solid var(--color-primary);
  padding-left: 9px;
}

:deep(.main-category) {
  font-weight: 600;
  background: rgba(127, 129, 147, 0.08);
}

:deep(.main-active) {
  background: rgba(var(--primary-rgb), 0.18) !important;
}

:deep(.all-items) {
  font-weight: 600;
  background: rgba(127, 129, 147, 0.08);
  margin-bottom: 8px;
}

:deep(.subcategory) {
  padding-left: 28px;
  font-size: 0.9em;
}

:deep(.cat-count) {
  color: var(--color-primary);
  font-weight: normal;
  font-size: 0.85em;
}
</style>
