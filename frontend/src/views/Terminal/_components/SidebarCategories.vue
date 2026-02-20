<!-- SidebarCategories.vue -->
<template>
  <aside class="sidebar-categories">
    <div v-if="categories.length" class="category-section">
      <div class="category-section-title">{{ title }}</div>
      <ul class="category-list">
        <template v-for="(entry, idx) in categoriesWithSeparators" :key="entry.cat || 'sep-' + idx">
          <li v-if="entry.separator" class="category-separator"></li>

          <!-- All Items Option -->
          <li
            v-else-if="entry.isAll"
            class="category-item all-items"
            :class="{
              active: !selectedMainCategory && !selectedCategory,
            }"
            @click="selectAllItems"
          >
            <span>
              <i :class="allOptionIcon"></i> {{ allOptionLabel }}
              <span v-if="typeof entry.count === 'number'" class="cat-count">({{ entry.count }})</span>
            </span>
          </li>

          <!-- Main Categories -->
          <li
            v-else-if="entry.isMain"
            :class="[
              'category-item',
              'main-category',
              {
                'main-active': selectedMainCategory === getMainCategoryCodeFromLabel(entry.cat),
              },
            ]"
            @click="selectCategory(entry.cat, { select: true })"
          >
            <span class="accordion-arrow" @click.stop="selectCategory(entry.cat, { select: false })">
              <i :class="openMainCategories[getMainCategoryCodeFromLabel(entry.cat)] ? 'fas fa-chevron-down' : 'fas fa-chevron-right'"></i>
            </span>
            <span>
              {{ capitalizeCategory(entry.cat) }}
              <span v-if="typeof entry.count === 'number'" class="cat-count">({{ entry.count }})</span>
            </span>
          </li>

          <!-- Subcategories -->
          <li
            v-else
            :class="[
              'category-item',
              {
                active: selectedCategory === entry.cat,
                subcategory: entry.parent,
              },
            ]"
            @click="selectCategory(entry.cat)"
          >
            <span
              >{{ capitalizeCategory(entry.cat) }}
              <span v-if="typeof entry.count === 'number'" class="cat-count">({{ entry.count }})</span>
            </span>
          </li>
        </template>
      </ul>
    </div>
  </aside>
</template>

<script>
import { ref, computed, watch, inject } from 'vue';

export default {
  name: 'SidebarCategories',
  props: {
    categories: {
      type: Array,
      default: () => [],
    },
    items: {
      type: Array,
      default: () => [],
    },
    selectedCategory: {
      type: String,
      default: null,
    },
    selectedMainCategory: {
      type: String,
      default: null,
    },
    title: {
      type: String,
      default: 'Categories',
    },
    showAllOption: {
      type: Boolean,
      default: true,
    },
    allOptionLabel: {
      type: String,
      default: 'All Items',
    },
    allOptionIcon: {
      type: String,
      default: 'fas fa-list',
    },
    mainCategories: {
      type: Array,
      default: () => [
        { code: '000', label: '000 Foundations' },
        { code: '100', label: '100 Data & Knowledge' },
        { code: '200', label: '200 Software Engineering' },
        { code: '300', label: '300 Content & Media' },
        { code: '400', label: '400 Business & Finance' },
        { code: '500', label: '500 Customer & Ops' },
        { code: '600', label: '600 Sales & Marketing' },
        { code: '700', label: '700 Design & UX' },
        { code: '800', label: '800 Productivity' },
        { code: '900', label: '900 Domain Specialists' },
      ],
    },
    itemCategoryKey: {
      type: String,
      default: 'category',
    },
  },
  emits: ['category-selected', 'all-selected'],
  setup(props, { emit }) {
    const playSound = inject('playSound', () => {});
    const openMainCategories = ref({});

    // Helper functions
    const isSubcategory = (cat) => {
      return cat.match(/^\d{3}\.\d/);
    };

    const getMainCategoryCodeFromLabel = (label) => {
      // First try to find by exact label match
      const foundCategory = props.mainCategories.find((cat) => cat.label === label);
      if (foundCategory) {
        return foundCategory.code;
      }

      // Fallback to the old method for backwards compatibility (e.g., "000 Foundations")
      return label.split(' ')[0];
    };

    // Build categories with separators and counts
    const categoriesWithSeparators = computed(() => {
      const allCats = props.categories;
      let result = [];

      // Count items in each main category
      const itemCounts = {};
      let allItemsCount = 0;

      // First, identify which items belong to numbered categories
      const numberedCategoryItems = new Set();

      props.mainCategories.forEach((main) => {
        let count;
        if (main.code === 'Uncategorized') {
          // Count items with empty, null, undefined categories, or categories that don't match any numbered pattern
          count = props.items.filter((item) => {
            const category = item[props.itemCategoryKey];
            if (!category || category.trim() === '') {
              return true; // Empty/null categories are uncategorized
            }
            // Check if this category matches any numbered category pattern
            const matchesNumberedCategory = props.mainCategories.some(
              (mainCat) => mainCat.code !== 'Uncategorized' && category.startsWith(mainCat.code)
            );
            return !matchesNumberedCategory; // If it doesn't match any numbered category, it's uncategorized
          }).length;
        } else {
          // Count items that start with the main category code
          const matchingItems = props.items.filter((item) => item[props.itemCategoryKey] && item[props.itemCategoryKey].startsWith(main.code));
          count = matchingItems.length;
          // Track these items so we don't double-count them in uncategorized
          matchingItems.forEach((item) => numberedCategoryItems.add(item));
        }
        itemCounts[main.code] = count;
        allItemsCount += count;
      });

      // If no items were counted (categories don't match the pattern), use total items count
      if (allItemsCount === 0) {
        allItemsCount = props.items.length;
      }

      // Add "All Items" at the top, with count
      if (props.showAllOption) {
        result.push({
          cat: props.allOptionLabel,
          isAll: true,
          separator: false,
          count: allItemsCount,
        });
      }

      // Render main categories in the order of mainCategories
      props.mainCategories.forEach((main, idx) => {
        if (idx > 0) result.push({ separator: true });

        // Main category entry, with count
        result.push({
          cat: main.label,
          isMain: true,
          separator: false,
          code: main.code,
          count: itemCounts[main.code],
        });

        // Subcategories (only if open), sorted alphabetically for consistency
        const subs = allCats.filter((cat) => isSubcategory(cat) && cat.startsWith(main.code + '.')).sort();

        if (openMainCategories.value[main.code]) {
          subs.forEach((sub) => {
            // Count items in this subcategory
            const subCount = props.items.filter((item) => item[props.itemCategoryKey] && item[props.itemCategoryKey] === sub).length;

            result.push({
              cat: sub,
              isMain: false,
              separator: false,
              parent: main.code,
              count: subCount,
            });
          });
        }
      });

      return result;
    });

    // Selection methods
    const selectAllItems = () => {
      playSound('typewriterKeyPress');
      openMainCategories.value = {};
      emit('all-selected');
    };

    const selectCategory = (cat, options = {}) => {
      playSound('typewriterKeyPress');

      // Check if this is a main category
      if (props.mainCategories.some((m) => m.label === cat)) {
        const code = getMainCategoryCodeFromLabel(cat);
        const currentlyOpen = !!openMainCategories.value[code];

        // Close all other categories
        openMainCategories.value = {};

        // Toggle this category
        if (!currentlyOpen) {
          openMainCategories.value[code] = true;
        }

        // If options.select is true, also select the main category
        if (options && options.select) {
          emit('category-selected', {
            category: cat,
            mainCategory: code,
            isMainCategory: true,
          });
        }
        return;
      }

      // Regular category selection
      emit('category-selected', {
        category: cat,
        mainCategory: null,
        isMainCategory: false,
      });
    };

    // Capitalize category names for display only
    const capitalizeCategory = (categoryName) => {
      if (!categoryName) return '';
      return categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
    };

    // Watch for external changes to reset accordion state
    watch([() => props.selectedCategory, () => props.selectedMainCategory], () => {
      // Keep accordion state when externally controlled
    });

    return {
      openMainCategories,
      categoriesWithSeparators,
      selectAllItems,
      selectCategory,
      getMainCategoryCodeFromLabel,
      capitalizeCategory,
    };
  },
};
</script>

<style scoped>
.sidebar-categories {
  width: 240px;
  /* padding: 8px; */
  padding-left: 0;
  padding-right: 16px;
  background-color: transparent;
  border-right: 1px solid rgba(18, 224, 255, 0.1);
  font-size: smaller;
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100%;
  /* z-index: 2; */
  overflow: auto;
  scrollbar-width: none;
}

.category-section-title {
  margin-bottom: 8px;
  color: var(--color-grey);
  font-weight: bold;
}

.category-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.category-item {
  padding: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  border-radius: 4px;
  color: var(--color-light-primary);
}

.category-item:hover {
  background-color: rgba(var(--green-rgb), 0.1);
}

.category-item.active {
  background-color: rgba(var(--green-rgb), 0.15);
  color: var(--color-text) !important;
}

.category-separator {
  display: none;
  border-top: 1.5px solid var(--color-primary);
  margin: 8px 0 4px 0;
  height: 0;
  list-style: none;
}

.main-category {
  font-weight: bold;
  color: var(--color-text);
  background: rgba(127, 129, 147, 0.08);
}

.main-active {
  background: rgba(var(--green-rgb), 0.18) !important;
  color: var(--color-text) !important;
}

.all-items {
  font-weight: bold;
  color: var(--color-text);
  background: rgba(127, 129, 147, 0.08);
  border-radius: 4px;
  margin-bottom: 4px;
}

li.category-item.all-items i {
  margin-right: 8px;
}

.accordion-arrow {
  display: inline-block;
  width: 18px;
  text-align: center;
  margin-right: 4px;
  cursor: pointer;
  color: var(--color-primary);
}

.subcategory {
  padding-left: 24px;
  font-style: italic;
  color: var(--color-text);
  line-height: normal;
}

.cat-count {
  color: var(--color-primary);
  font-weight: normal;
  margin-left: 4px;
  font-size: 0.95em;
}

/* Scrollbar styling */
.sidebar-categories::-webkit-scrollbar {
  width: 4px;
}

.sidebar-categories::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-categories::-webkit-scrollbar-thumb {
  background: rgba(var(--green-rgb), 0.3);
  border-radius: 2px;
}

.sidebar-categories::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--green-rgb), 0.5);
}
</style>
