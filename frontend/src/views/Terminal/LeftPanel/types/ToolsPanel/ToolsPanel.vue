<template>
  <div class="tools-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Tools</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-tools"></i>
          {{ totalTools }}
        </span>
      </div>
    </div>

    <!-- Categories Sidebar -->
    <div class="panel-content">
      <SidebarCategories
        :categories="toolCategories"
        :items="allAvailableTools"
        :selected-category="selectedCategory"
        :selected-main-category="selectedMainCategory"
        title="Categories"
        :show-all-option="true"
        all-option-label="All Tools"
        all-option-icon="fas fa-tools"
        :main-categories="mainToolCategories"
        item-category-key="category"
        @category-selected="onCategorySelected"
        @all-selected="onAllSelected"
      />
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import SidebarCategories from '@/views/Terminal/_components/SidebarCategories.vue';
// NOTE: Static toolLibrary import removed - tools are passed via props from parent component

export default {
  name: 'ToolsPanel',
  components: {
    SidebarCategories,
  },
  props: {
    allAvailableTools: {
      type: Array,
      default: () => [],
    },
    activeTab: {
      type: String,
      default: 'all',
    },
    selectedTool: {
      type: Object,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    // Local state for category selection
    const selectedCategory = ref(null);
    const selectedMainCategory = ref(null);

    // Define main tool categories based on actual tool categories from store and tools
    const mainToolCategories = computed(() => {
      // Get unique categories from all available tools
      const categories = new Set();

      props.allAvailableTools.forEach((tool) => {
        if (tool.category) {
          categories.add(tool.category);
        }
      });

      // Convert to array and sort
      const sortedCategories = Array.from(categories).sort();

      // Map to the expected format - keep original code for filtering, capitalize label for display
      return sortedCategories.map((category) => ({
        code: category, // Keep original category name for filtering
        label: category, // Keep original for now, capitalization will be handled in display
      }));
    });

    // Tool categories for sidebar
    const toolCategories = computed(() => {
      return mainToolCategories.value.map((cat) => cat.code);
    });

    const totalTools = computed(() => props.allAvailableTools.length);

    // Category selection handlers
    const onAllSelected = () => {
      selectedMainCategory.value = null;
      selectedCategory.value = null;

      // Emit to parent screen
      emit('panel-action', 'category-filter-changed', {
        selectedCategory: null,
        selectedMainCategory: null,
        type: 'all-selected',
      });
    };

    const onCategorySelected = (payload) => {
      if (payload.isMainCategory) {
        selectedMainCategory.value = payload.mainCategory;
        selectedCategory.value = payload.category;
      } else {
        selectedMainCategory.value = null;
        selectedCategory.value = payload.category;
      }

      // Emit to parent screen
      emit('panel-action', 'category-filter-changed', {
        selectedCategory: selectedCategory.value,
        selectedMainCategory: selectedMainCategory.value,
        type: 'category-selected',
        payload,
      });
    };

    return {
      selectedCategory,
      selectedMainCategory,
      toolCategories,
      mainToolCategories,
      totalTools,
      onAllSelected,
      onCategorySelected,
    };
  },
};
</script>

<style scoped>
.tools-panel {
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
  color: var(--color-green);
  font-family: 'League Spartan', sans-serif;
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
  background-color: rgba(25, 239, 131, 0.1);
}

:deep(.category-item.active) {
  background-color: rgba(25, 239, 131, 0.15);
  border-left: 3px solid var(--color-green);
  padding-left: 9px;
}

:deep(.main-category) {
  font-weight: 600;
  background: rgba(127, 129, 147, 0.08);
}

:deep(.main-active) {
  background: rgba(25, 239, 131, 0.18) !important;
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
  color: var(--color-green);
  font-weight: normal;
  font-size: 0.85em;
}
</style>
