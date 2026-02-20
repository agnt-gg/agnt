<!-- BaseTable.vue -->
<template>
  <div class="base-table" :class="{ 'with-search': showSearch }" ref="baseTableRef">
    <!-- Search Bar -->
    <div v-if="showSearch" class="search-bar">
      <input type="text" :value="searchValue" :placeholder="searchPlaceholder" class="search-input" @input="handleSearch" />
      <select v-if="showSortDropdown" v-model="sortOrder" class="sort-select">
        <option v-for="option in sortOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Table -->
    <div class="table-container">
      <!-- Header -->
      <div class="table-header" :style="{ gridTemplateColumns: columnLayout }">
        <div
          v-for="column in columns"
          :key="column.key"
          :class="['col-' + column.key, { sortable: enableColumnSorting }]"
          @click="handleColumnSort(column.key)"
        >
          {{ column.label }}
          <span v-if="enableColumnSorting" class="sort-arrow">{{ getSortArrow(column.key) }}</span>
        </div>
      </div>

      <!-- Body -->
      <div class="table-body" ref="tableBodyRef">
        <div
          v-for="(item, index) in displayItems"
          :key="item.id || index"
          class="table-row"
          :class="{
            selected: selectedId === (item.id || index),
            [item.status?.toLowerCase()]: item.status,
          }"
          :style="{ gridTemplateColumns: columnLayout }"
          @click="handleRowClick(item)"
          @dblclick="handleRowDoubleClick(item)"
        >
          <div v-for="column in columns" :key="column.key" :class="['col-' + column.key]">
            <slot :name="column.key" :item="item">
              {{ getColumnValue(item, column) }}
            </slot>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="displayItems.length === 0" class="table-row no-results">
          <slot name="no-results">
            {{ noResultsText }}
          </slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, inject, onMounted, onUnmounted, nextTick } from 'vue';
import { useCleanup } from '@/composables/useCleanup';

export default {
  name: 'BaseTable',
  props: {
    items: {
      type: Array,
      required: true,
    },
    columns: {
      type: Array,
      required: true,
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
    searchValue: {
      type: String,
      default: '',
    },
    // Sorting functionality
    showSortDropdown: {
      type: Boolean,
      default: true,
    },
    enableColumnSorting: {
      type: Boolean,
      default: false,
    },
    defaultSortColumn: {
      type: String,
      default: '',
    },
    defaultSortDirection: {
      type: String,
      default: 'asc',
      validator: (value) => ['asc', 'desc'].includes(value),
    },
    // Customization
    noResultsText: {
      type: String,
      default: 'No results found',
    },
    // Title key for sorting (defaults to first column if not specified)
    titleKey: {
      type: String,
      default: '',
    },
  },
  emits: ['row-click', 'row-double-click', 'search'],
  setup(props, { emit }) {
    const cleanup = useCleanup();
    const playSound = inject('playSound', () => {});
    const tableBodyRef = ref(null);
    const baseTableRef = ref(null);
    let scrollObserver = null;

    // Sorting state and options (matching BaseCardGrid)
    const sortOrder = ref('az');
    const sortOptions = [
      { value: 'az', label: 'A-Z' },
      { value: 'za', label: 'Z-A' },
    ];

    // Column-based sorting state
    const currentSortColumn = ref('');
    const currentSortDirection = ref('asc'); // 'asc' or 'desc'

    // Initialize default sorting when column sorting is enabled
    if (props.enableColumnSorting && props.columns.length > 0) {
      if (props.defaultSortColumn) {
        // Use provided default sort column
        const defaultColumn = props.columns.find((col) => col.key === props.defaultSortColumn);
        if (defaultColumn) {
          currentSortColumn.value = props.defaultSortColumn;
          currentSortDirection.value = props.defaultSortDirection;
        }
      } else {
        // Fallback to 'status' column if no default is specified
        const statusColumn = props.columns.find((col) => col.key === 'status');
        if (statusColumn) {
          currentSortColumn.value = 'status';
          currentSortDirection.value = 'asc';
        }
      }
    }

    // Get the effective title key for sorting
    const effectiveTitleKey = computed(() => {
      return props.titleKey || (props.columns.length > 0 ? props.columns[0].key : 'title');
    });

    // Handle column header click for sorting
    const handleColumnSort = (columnKey) => {
      if (!props.enableColumnSorting) return;

      if (currentSortColumn.value === columnKey) {
        // Toggle direction if same column
        currentSortDirection.value = currentSortDirection.value === 'asc' ? 'desc' : 'asc';
      } else {
        // New column, default to ascending
        currentSortColumn.value = columnKey;
        currentSortDirection.value = 'asc';
      }
    };

    // Get sort arrow for column
    const getSortArrow = (columnKey) => {
      if (!props.enableColumnSorting || currentSortColumn.value !== columnKey) {
        return '';
      }
      return currentSortDirection.value === 'asc' ? '↑' : '↓';
    };

    // Compute the grid template columns based on column definitions
    const columnLayout = computed(() => {
      return props.columns.map((col) => col.width || '1fr').join(' ');
    });

    // Sorted items based on sortOrder and effectiveTitleKey (matching BaseCardGrid)
    // Note: We don't filter here - the parent component handles filtering
    // We only handle sorting
    const sortedItems = computed(() => {
      const arr = [...props.items];

      if (props.enableColumnSorting && currentSortColumn.value) {
        // Use column-based sorting
        arr.sort((a, b) => {
          const aValue = getColumnValue(a, { key: currentSortColumn.value });
          const bValue = getColumnValue(b, { key: currentSortColumn.value });

          // Special handling for date/time columns (like startTime)
          if (currentSortColumn.value.includes('Time') || currentSortColumn.value.includes('Date')) {
            const aTime = aValue ? new Date(aValue).getTime() : 0;
            const bTime = bValue ? new Date(bValue).getTime() : 0;
            const comparison = aTime - bTime;
            return currentSortDirection.value === 'asc' ? comparison : -comparison;
          }

          // Check if both values are numbers
          const aNum = typeof aValue === 'number' ? aValue : parseFloat(aValue);
          const bNum = typeof bValue === 'number' ? bValue : parseFloat(bValue);

          if (!isNaN(aNum) && !isNaN(bNum)) {
            // Numeric comparison
            const comparison = aNum - bNum;
            return currentSortDirection.value === 'asc' ? comparison : -comparison;
          }

          // Default string comparison for other columns
          const aStr = String(aValue || '').toLowerCase();
          const bStr = String(bValue || '').toLowerCase();

          const comparison = aStr.localeCompare(bStr);
          return currentSortDirection.value === 'asc' ? comparison : -comparison;
        });
      } else {
        // Use dropdown-based sorting (original behavior)
        arr.sort((a, b) => {
          const aLabel = String(a[effectiveTitleKey.value] || '').toLowerCase();
          const bLabel = String(b[effectiveTitleKey.value] || '').toLowerCase();
          if (sortOrder.value === 'az') return aLabel.localeCompare(bLabel);
          else return bLabel.localeCompare(aLabel);
        });
      }
      return arr;
    });

    // Keep displayItems for backward compatibility
    const displayItems = computed(() => sortedItems.value);

    // Handle row click
    const handleRowClick = (item) => {
      // playSound('typewriterKeyPress');
      emit('row-click', item);
    };

    // Handle row double-click
    const handleRowDoubleClick = (item) => {
      emit('row-double-click', item);
    };

    // Handle search
    const handleSearch = (event) => {
      const value = event.target ? event.target.value : event;
      emit('search', value);
    };

    // Get column value with support for nested properties
    const getColumnValue = (item, column) => {
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

    // Check for scrollbars and update body attribute
    const checkForScrollbars = () => {
      if (tableBodyRef.value) {
        // More reliable way to detect scrollbars
        const hasVerticalScroll = tableBodyRef.value.scrollHeight > tableBodyRef.value.clientHeight;

        // Create a test element to measure scrollbar width (more reliable cross-browser)
        const scrollDiv = document.createElement('div');
        scrollDiv.style.width = '100px';
        scrollDiv.style.height = '100px';
        scrollDiv.style.overflow = 'scroll';
        scrollDiv.style.position = 'absolute';
        scrollDiv.style.top = '-9999px';
        document.body.appendChild(scrollDiv);
        const scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
        document.body.removeChild(scrollDiv);

        // Determine if scrollbar is present based on scrollbar width
        const hasScroll = hasVerticalScroll && scrollbarWidth > 0;

        // Apply to both body and component
        document.body.setAttribute('data-has-scroll', hasScroll.toString());
        if (baseTableRef.value) {
          baseTableRef.value.setAttribute('data-has-scroll', hasScroll.toString());
        }

        // Debug info
        // console.log('Scroll detection:', {
        //   scrollbarWidth,
        //   scrollHeight: tableBodyRef.value.scrollHeight,
        //   clientHeight: tableBodyRef.value.clientHeight,
        //   hasScroll
        // });
      }
    };

    // Watch for displayItems changes to update scrollbar check
    watch(displayItems, () => {
      nextTick(() => {
        checkForScrollbars();
      });
    });

    onMounted(() => {
      document.body.setAttribute('data-type', 'terminal-table');

      // Initial check for scrollbars
      nextTick(() => {
        checkForScrollbars();

        // Set up ResizeObserver for more reliable detection
        if (typeof ResizeObserver !== 'undefined' && tableBodyRef.value) {
          const resizeObserver = new ResizeObserver(() => {
            checkForScrollbars();
          });

          resizeObserver.observe(tableBodyRef.value);

          // Store observer for cleanup
          scrollObserver = resizeObserver;
        }
      });

      // Set up interval to check periodically (handles dynamic content changes)
      cleanup.setInterval(checkForScrollbars, 500);

      // Add resize listener
      cleanup.addEventListener(window, 'resize', checkForScrollbars);

      // Apply a manual fix immediately when component mounts
      cleanup.setTimeout(() => {
        const tableContainer = document.querySelector('.table-container');
        if (tableContainer && tableContainer.scrollHeight > tableContainer.clientHeight) {
          document.body.setAttribute('data-has-scroll', 'true');
          if (baseTableRef.value) {
            baseTableRef.value.setAttribute('data-has-scroll', 'true');
          }
        }
      }, 100);
    });

    onUnmounted(() => {
      document.body.removeAttribute('data-type');
      document.body.removeAttribute('data-has-scroll');

      // Disconnect observer if exists
      if (scrollObserver) {
        scrollObserver.disconnect();
      }
    });

    return {
      columnLayout,
      displayItems,
      handleRowClick,
      handleRowDoubleClick,
      handleSearch,
      getColumnValue,
      tableBodyRef,
      baseTableRef,
      sortOrder,
      sortOptions,
      handleColumnSort,
      getSortArrow,
      enableColumnSorting: computed(() => props.enableColumnSorting),
    };
  },
};
</script>

<style scoped>
.base-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
  min-height: 0; /* Important for flex child scrolling */
}

.table-container {
  width: calc(100% - 2px);
  border: 1px solid rgba(18, 224, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
  flex: 1;
  min-height: 0; /* Important for flex child scrolling */
  display: flex;
  flex-direction: column;
}

.table-header {
  display: grid;
  background: rgba(var(--green-rgb), 0.1);
  padding: 10px 8px;
  font-weight: 400;
  color: var(--color-text);
  border-bottom: 1px solid rgba(var(--green-rgb), 0.4);
}

.table-body {
  scrollbar-width: thin;
  /* scrollbar-color: var(--color-green) transparent; */
  background: rgb(0 0 0 / 10%);
  overflow-y: auto;
  flex: 1;
  min-height: 0; /* Important for flex child scrolling */
}

.table-body::-webkit-scrollbar {
  width: 6px;
}

.table-body::-webkit-scrollbar-track {
  background: rgba(var(--green-rgb), 0.05);
}

.table-body::-webkit-scrollbar-thumb {
  background-color: var(--color-green);
  border-radius: 3px;
}

.table-row {
  display: grid;
  padding: 10px 8px;
  border-top: 1px solid rgba(18, 224, 255, 0.1);
  cursor: pointer;
  transition: background-color 0.2s;
  color: var(--color-text);
}

.table-row.listening .col-status {
  color: var(--color-green);
}

.table-row:first-child {
  border-top: none;
}

.table-row.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-left: 3px solid var(--color-green);
  padding-left: 5px;
}

.table-row:not(.selected):hover {
  background: rgba(var(--green-rgb), 0.08);
}

[class^='col-'] {
  padding: 0 8px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-results {
  padding: 15px 10px;
  color: var(--color-grey);
  text-align: center;
  font-style: italic;
  grid-column: 1 / -1;
  cursor: default;
}

/* Search Bar Styles */
.search-bar {
  width: 100%;
  margin-bottom: 8px;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 8px;
  color: var(--color-light-green);
  font-size: 0.9em;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-green);
}

.sort-select {
  width: 80px;
  padding: 7px 12px;
  border-radius: 4px;
  border: 1px solid rgba(var(--green-rgb), 0.25);
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-light-green);
  font-size: 0.95em;
  transition: background 0.15s, color 0.15s, border 0.15s;
  margin-left: 8px;
  height: 44px;
}

.sort-select:focus {
  outline: none;
  border-color: var(--color-green);
}

select option {
  background-color: var(--color-ultra-dark-navy);
}

/* Status Colors */
.table-row .col-status {
  font-weight: 500;
}

.table-row.running .col-status,
.table-row.active .col-status {
  color: var(--color-green);
}

.table-row.failed .col-status,
.table-row.error .col-status {
  color: var(--color-red);
}

.table-row.completed .col-status,
.table-row.stopped .col-status {
  color: var(--color-blue);
}

.table-row.queued .col-status,
.table-row.waiting .col-status {
  color: var(--color-yellow);
}

.table-row:last-child {
  border-bottom: 1px solid rgba(18, 224, 255, 0.1);
}

/* Sortable Column Styles */
.table-header .sortable {
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
  position: relative;
}

.table-header .sortable:hover {
  background: rgba(var(--green-rgb), 0.15);
}

.sort-arrow {
  margin-left: 4px;
  font-size: 12px;
  color: var(--color-green);
  opacity: 0.8;
}
</style>

<style>
/* This style is applied conditionally based on data attributes */
body[data-type='terminal-table'][data-has-scroll='true'] .scrollable-content {
  padding-right: 6px !important;
}

/* Add an alternative approach that directly targets the component */
.base-table[data-has-scroll='true'] + .scrollable-content {
  padding-right: 6px !important;
}
</style>
