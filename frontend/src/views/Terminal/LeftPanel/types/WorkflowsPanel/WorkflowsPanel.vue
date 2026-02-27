<template>
  <div class="workflows-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Workflows</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-sitemap"></i>
          {{ totalWorkflows }}
        </span>
      </div>
    </div>

    <!-- Categories Sidebar -->
    <div class="panel-content">
      <SidebarCategories
        :categories="categories"
        :items="allWorkflows"
        :selected-category="selectedCategory"
        :selected-main-category="selectedMainCategory"
        title="Categories"
        :show-all-option="true"
        all-option-label="All Workflows"
        all-option-icon="fas fa-sitemap"
        :main-categories="mainWorkflowCategories"
        item-category-key="category"
        @category-selected="onCategorySelected"
        @all-selected="onAllSelected"
      />
    </div>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import SidebarCategories from '@/views/Terminal/_components/SidebarCategories.vue';

export default {
  name: 'WorkflowsPanel',
  components: {
    SidebarCategories,
  },
  props: {
    allWorkflows: {
      type: Array,
      default: () => [],
    },
    workflowsFilteredByTab: {
      type: Array,
      default: () => [],
    },
    activeTab: {
      type: String,
      default: 'all',
    },
    selectedWorkflowId: {
      type: String,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    // Local state for category selection
    const selectedCategory = ref(null);
    const selectedMainCategory = ref(null);

    // Computed properties for categories
    const categories = computed(() => store.getters['workflows/workflowCategories'] || []);

    const mainWorkflowCategories = computed(() => {
      const categories = store.getters['workflows/workflowCategories'] || [];
      return categories
        .filter((cat) => {
          if (!cat) return false;
          // Include "Uncategorized" as a main category
          if (cat === 'Uncategorized') return true;
          // Include categories that don't have dots in their first part (main categories)
          return !cat.split(' ')[0].includes('.');
        })
        .map((cat) => {
          return {
            code: cat === 'Uncategorized' ? 'Uncategorized' : cat.split(' ')[0],
            label: cat,
          };
        });
    });

    // Read directly from Vuex so data is available immediately (not dependent on center screen props)
    const allWorkflows = computed(() => store.getters['workflows/allWorkflows'] || []);
    const totalWorkflows = computed(() => allWorkflows.value.length);

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

    // Watch for external changes (if needed for synchronization)
    watch(
      () => props.selectedWorkflowId,
      (newId) => {
        // Could be used for additional logic when workflow selection changes
        console.log('WorkflowsPanel: Selected workflow changed to:', newId);
      }
    );

    return {
      selectedCategory,
      selectedMainCategory,
      categories,
      mainWorkflowCategories,
      allWorkflows,
      totalWorkflows,
      onAllSelected,
      onCategorySelected,
    };
  },
};
</script>

<style scoped>
.workflows-panel {
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
