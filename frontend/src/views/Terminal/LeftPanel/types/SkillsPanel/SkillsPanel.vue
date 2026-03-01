<template>
  <div class="skills-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Skills</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-brain"></i>
          {{ totalSkills }}
        </span>
      </div>
    </div>

    <!-- Categories Sidebar -->
    <div class="panel-content">
      <SidebarCategories
        :categories="categories"
        :items="allSkills"
        :selected-category="selectedCategory"
        :selected-main-category="selectedMainCategory"
        title="Categories"
        :show-all-option="true"
        all-option-label="All Skills"
        all-option-icon="fas fa-brain"
        :main-categories="mainSkillCategories"
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

export default {
  name: 'SkillsPanel',
  components: {
    SidebarCategories,
  },
  props: {
    allSkills: {
      type: Array,
      default: () => [],
    },
    selectedSkill: {
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

    // Computed properties for categories
    const categories = computed(() => store.getters['skills/skillCategories'] || []);

    const mainSkillCategories = computed(() => {
      const cats = store.getters['skills/skillCategories'] || [];
      return cats.map((cat) => ({
        code: cat,
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
      }));
    });

    // Read directly from Vuex
    const allSkills = computed(() => store.getters['skills/allSkills'] || []);
    const totalSkills = computed(() => allSkills.value.length);

    // Category selection handlers
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
        selectedCategory.value = payload.category;
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

    return {
      selectedCategory,
      selectedMainCategory,
      categories,
      mainSkillCategories,
      allSkills,
      totalSkills,
      onAllSelected,
      onCategorySelected,
    };
  },
};
</script>

<style scoped>
.skills-panel {
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
