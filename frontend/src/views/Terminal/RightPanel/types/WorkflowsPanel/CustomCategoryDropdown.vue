<template>
  <div class="custom-dropdown" ref="dropdownRef">
    <div class="dropdown-trigger" @click="toggleDropdown" :class="{ open: isOpen }">
      <span class="selected-value">
        {{ displayValue || 'Select a category' }}
      </span>
      <i class="fas fa-chevron-down dropdown-arrow" :class="{ rotated: isOpen }"></i>
    </div>

    <div v-if="isOpen" class="dropdown-menu">
      <div class="dropdown-search">
        <input type="text" v-model="searchQuery" placeholder="Search categories..." class="search-input" @click.stop />
      </div>

      <div class="dropdown-content">
        <div v-for="mainCategory in filteredCategories" :key="mainCategory.code" class="category-group">
          <div class="main-category" @click="selectCategory(mainCategory.full)" :class="{ selected: modelValue === mainCategory.full }">
            <span class="category-name">{{ mainCategory.name }}</span>
          </div>

          <div v-if="mainCategory.subcategories.length > 0" class="subcategories">
            <div
              v-for="subCategory in mainCategory.subcategories"
              :key="subCategory.full"
              class="sub-category"
              @click="selectCategory(subCategory.full)"
              :class="{ selected: modelValue === subCategory.full }"
            >
              <span class="category-name">{{ subCategory.name }}</span>
            </div>
          </div>
        </div>

        <div v-if="filteredCategories.length === 0" class="no-results">No categories found</div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, ref, onMounted, onUnmounted } from 'vue';

export default {
  name: 'CustomCategoryDropdown',
  props: {
    modelValue: {
      type: String,
      default: '',
    },
    categories: {
      type: Array,
      required: true,
    },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const isOpen = ref(false);
    const searchQuery = ref('');
    const dropdownRef = ref(null);

    // Parse categories into hierarchical structure
    const parsedCategories = computed(() => {
      const mainCategories = [];

      props.categories.forEach((category) => {
        // Each category is now a simple string like "Business & Finance" or "Uncategorized"
        mainCategories.push({
          code: category,
          name: category,
          full: category,
          subcategories: [],
        });
      });

      // Sort alphabetically, with Uncategorized at the top
      return mainCategories.sort((a, b) => {
        if (a.name === 'Uncategorized') return -1;
        if (b.name === 'Uncategorized') return 1;
        return a.name.localeCompare(b.name);
      });
    });

    // Filter categories based on search query
    const filteredCategories = computed(() => {
      if (!searchQuery.value.trim()) {
        return parsedCategories.value;
      }

      const query = searchQuery.value.toLowerCase();
      return parsedCategories.value
        .filter((mainCat) => {
          // Check if main category matches
          const mainMatches = mainCat.name.toLowerCase().includes(query) || mainCat.code.toLowerCase().includes(query);

          // Check if any subcategory matches
          const subMatches = mainCat.subcategories.some((sub) => sub.name.toLowerCase().includes(query) || sub.code.toLowerCase().includes(query));

          return mainMatches || subMatches;
        })
        .map((mainCat) => {
          // If main category matches, return all subcategories
          if (mainCat.name.toLowerCase().includes(query) || mainCat.code.toLowerCase().includes(query)) {
            return mainCat;
          }

          // Otherwise, filter subcategories
          return {
            ...mainCat,
            subcategories: mainCat.subcategories.filter((sub) => sub.name.toLowerCase().includes(query) || sub.code.toLowerCase().includes(query)),
          };
        });
    });

    // Display value for selected category
    const displayValue = computed(() => {
      // Simply return the category name as-is
      return props.modelValue || '';
    });

    const toggleDropdown = () => {
      isOpen.value = !isOpen.value;
      if (isOpen.value) {
        searchQuery.value = '';
      }
    };

    const selectCategory = (category) => {
      emit('update:modelValue', category);
      isOpen.value = false;
      searchQuery.value = '';
    };

    const handleClickOutside = (event) => {
      if (dropdownRef.value && !dropdownRef.value.contains(event.target)) {
        isOpen.value = false;
        searchQuery.value = '';
      }
    };

    onMounted(() => {
      document.addEventListener('click', handleClickOutside);
    });

    onUnmounted(() => {
      document.removeEventListener('click', handleClickOutside);
    });

    return {
      isOpen,
      searchQuery,
      dropdownRef,
      filteredCategories,
      displayValue,
      toggleDropdown,
      selectCategory,
    };
  },
};
</script>

<style scoped>
.custom-dropdown {
  position: relative;
  width: 65%;
}

.dropdown-trigger {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-light-green);
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s ease;
  font-family: inherit;
  font-size: 0.95em;
}

.dropdown-trigger:hover,
.dropdown-trigger.open {
  border-color: var(--color-green);
}

.dropdown-trigger.open {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.selected-value {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-arrow {
  transition: transform 0.2s ease;
  font-size: 0.8em;
  margin-left: 8px;
}

.dropdown-arrow.rotated {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-dark-navy);
  border: 1px solid var(--color-green);
  border-top: none;
  border-radius: 0 0 4px 4px;
  max-height: 300px;
  overflow: hidden;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.dropdown-search {
  padding: 8px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
}

.search-input {
  width: 100%;
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-light-green);
  border-radius: 3px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 0.9em;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-green);
}

.search-input::placeholder {
  color: var(--color-grey);
}

.dropdown-content {
  max-height: 240px;
  overflow-y: auto;
}

.category-group {
  border-bottom: 1px solid rgba(var(--green-rgb), 0.05);
}

.category-group:last-child {
  border-bottom: none;
}

.main-category,
.sub-category {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
  transition: background-color 0.2s ease;
}

.main-category:hover,
.sub-category:hover {
  background: rgba(var(--green-rgb), 0.1);
}

.main-category.selected,
.sub-category.selected {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}

.main-category {
  /* font-weight: 500; */
  border-bottom: 1px solid rgba(var(--green-rgb), 0.05);
}

.sub-category {
  padding-left: 24px;
  font-size: var(--font-size-xs);
  color: var(--color-grey);
}

.sub-category:hover {
  color: var(--color-light-green);
}

.sub-category.selected {
  color: var(--color-green);
}

.category-name {
  flex: 1;
  font-size: var(--font-size-xs);
}

.subcategories {
  background: rgba(0, 0, 0, 0.1);
}

.no-results {
  padding: 16px 12px;
  text-align: center;
  color: var(--color-grey);
  font-style: italic;
}

/* Custom scrollbar for dropdown content */
.dropdown-content::-webkit-scrollbar {
  width: 6px;
}

.dropdown-content::-webkit-scrollbar-track {
  background: rgba(var(--green-rgb), 0.05);
}

.dropdown-content::-webkit-scrollbar-thumb {
  background: rgba(var(--green-rgb), 0.3);
  border-radius: 3px;
}

.dropdown-content::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--green-rgb), 0.5);
}
</style>
