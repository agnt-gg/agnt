<!-- BaseCardGrid.vue -->
<template>
  <div class="base-card-grid" :class="{ 'with-search': showSearch }">
    <!-- Search Bar -->
    <div v-if="showSearch" class="search-bar">
      <input type="text" v-model="searchQuery" :placeholder="searchPlaceholder" class="search-input" @input="handleSearch" />
      <select v-model="sortOrder" class="sort-select">
        <option v-for="option in sortOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Cards Grid -->
    <div class="card-scroll-area">
      <div class="card-container">
        <!-- Empty State -->
        <div v-if="sortedItems.length === 0" class="no-results">
          <slot name="no-results">
            {{ noResultsText }}
          </slot>
        </div>

        <!-- Cards -->
        <Card
          v-for="(item, index) in sortedItems"
          :key="item.id || index"
          :item="item"
          :columns="columns"
          :selectedId="selectedId"
          :titleKey="titleKey"
          :index="index"
          @card-click="handleCardClick"
        >
          <template #title="slotProps">
            <slot name="title" v-bind="slotProps" />
          </template>
          <template v-for="column in columns" #[column.key]="slotProps">
            <slot :name="column.key" v-bind="slotProps" />
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, inject } from 'vue';
import Card from './components/Card.vue';

export default {
  name: 'BaseCardGrid',
  props: {
    // Core data
    items: {
      type: Array,
      required: true,
    },
    columns: {
      type: Array,
      required: true,
      // Each column should have: { key, label, width? }
    },
    selectedId: {
      type: [String, Number],
      default: null,
    },
    // Search functionality
    showSearch: {
      type: Boolean,
      default: false,
    },
    searchPlaceholder: {
      type: String,
      default: 'Search...',
    },
    searchKeys: {
      type: Array,
      default: () => [],
    },
    // Title configuration (which column to use as card title)
    titleKey: {
      type: String,
      default: 'title',
    },
    // Customization
    noResultsText: {
      type: String,
      default: 'No results found',
    },
  },
  emits: ['row-click', 'search'],
  components: { Card },
  setup(props, { emit }) {
    const searchQuery = ref('');
    const playSound = inject('playSound', () => {});

    // Sorting state and options
    const sortOrder = ref('az');
    const sortOptions = [
      { value: 'az', label: 'A-Z' },
      { value: 'za', label: 'Z-A' },
    ];

    // Filter items based on search query
    const displayItems = computed(() => {
      if (!searchQuery.value || !props.searchKeys.length) {
        return props.items;
      }

      const query = searchQuery.value.toLowerCase();
      return props.items.filter((item) => {
        return props.searchKeys.some((key) => {
          const value = item[key];
          if (!value) return false;
          return String(value).toLowerCase().includes(query);
        });
      });
    });

    // Sorted items based on sortOrder and titleKey
    const sortedItems = computed(() => {
      const arr = [...displayItems.value];
      arr.sort((a, b) => {
        const aLabel = String(a[props.titleKey] || '').toLowerCase();
        const bLabel = String(b[props.titleKey] || '').toLowerCase();
        if (sortOrder.value === 'az') return aLabel.localeCompare(bLabel);
        else return bLabel.localeCompare(aLabel);
      });
      return arr;
    });

    // Filter columns to exclude the title, status, and icon for card content
    const displayColumns = computed(() => {
      return props.columns.filter((col) => col.key !== props.titleKey && col.key !== 'status' && col.key !== 'icon');
    });

    // Get the status column if it exists
    const getStatusColumn = computed(() => {
      return props.columns.find((col) => col.key === 'status');
    });

    // Handle card click
    const handleCardClick = (item) => {
      playSound('typewriterKeyPress');
      emit('row-click', item);
    };

    // Handle search
    const handleSearch = () => {
      emit('search', searchQuery.value);
    };

    // Get title value
    const getTitleValue = (item) => {
      return getColumnValue(item, { key: props.titleKey });
    };

    // Get column value with support for nested properties
    const getColumnValue = (item, column) => {
      if (!column) return '';

      if (column.formatter) {
        return column.formatter(item[column.key], item);
      }

      // Handle nested properties using dot notation
      const keys = column.key.split('.');
      let value = item;
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined) break;
      }
      return value ?? '';
    };

    return {
      searchQuery,
      displayItems,
      sortedItems,
      sortOrder,
      sortOptions,
      displayColumns,
      getStatusColumn,
      handleCardClick,
      handleSearch,
      getColumnValue,
      getTitleValue,
    };
  },
};
</script>

<style scoped>
.base-card-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  height: 100%;
  min-height: 0;
}

/* Scrollable area for cards, fills available height */
.card-scroll-area {
  flex: 1 1 0%;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
  /* padding-right: 4px; */
}

/* Search Bar Styles */
.search-bar {
  width: 100%;
  display: flex;
  width: 100%;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-start;
  align-items: center;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--color-dull-navy);
  border-radius: 8px;
  color: var(--color-dull-white);
  font-size: 0.9em;
}

select option {
  background-color: var(--color-ultra-dark-navy);
}

.search-input:focus {
  outline: none;
  border-color: var(--color-green);
}

/* Card Container */
.card-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
  width: 100%;
  justify-content: center;
  min-height: 0;
}

/* No Results */
.no-results {
  padding: 32px;
  text-align: center;
  color: var(--color-grey);
  font-style: italic;
  grid-column: 1 / -1;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .card-container {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
}

@media (min-width: 1200px) {
  .card-container {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
}

.sort-select {
  width: fit-content;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--color-light-green);
  font-size: var(--font-size-xs);
  transition: background 0.15s, color 0.15s, border 0.15s;
  margin-left: 8px;
  height: 44px;
}
.sort-select:focus {
  outline: none;
  border-color: var(--color-green);
}
</style>
