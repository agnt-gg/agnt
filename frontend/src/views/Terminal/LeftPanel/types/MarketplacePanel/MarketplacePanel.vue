<template>
  <div class="ui-panel marketplace-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Market</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-store"></i>
          {{ marketplaceWorkflows.length }}
        </span>
      </div>
    </div>

    <!-- Marketplace Statistics -->
    <div class="marketplace-stats-section">
      <h4 class="section-title">
        <i class="fas fa-chart-bar"></i>
        Marketplace Stats
      </h4>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ marketplaceWorkflows.length }}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ featuredWorkflows.length }}</div>
          <div class="stat-label">Featured</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ freeCount }}</div>
          <div class="stat-label">Free</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ paidCount }}</div>
          <div class="stat-label">Paid</div>
        </div>
      </div>
    </div>

    <!-- Price Filter -->
    <div class="price-filter-section">
      <h4 class="section-title">
        <i class="fas fa-dollar-sign"></i>
        Price Range
      </h4>
      <div class="filter-list">
        <div
          v-for="option in priceOptions"
          :key="option.value"
          class="filter-item"
          :class="{ active: filters.priceRange === option.value }"
          @click="updateFilter('priceRange', option.value)"
        >
          <i :class="getPriceIcon(option.value)"></i>
          <span>{{ option.label }}</span>
        </div>
      </div>
    </div>

    <!-- Rating Filter -->
    <div class="rating-filter-section">
      <h4 class="section-title">
        <i class="fas fa-star"></i>
        Minimum Rating
      </h4>
      <div class="filter-list">
        <div
          v-for="rating in [0, 4.5, 3]"
          :key="rating"
          class="filter-item"
          :class="{ active: filters.minRating === rating }"
          @click="updateFilter('minRating', rating)"
        >
          <i class="fas fa-star"></i>
          <span>{{ rating > 0 ? `${rating}+` : 'All' }}</span>
        </div>
      </div>
    </div>

    <!-- Sort By -->
    <div class="sort-section">
      <h4 class="section-title">
        <i class="fas fa-sort"></i>
        Sort By
      </h4>
      <CustomSelect :options="sortOptions" placeholder="Sort By" @option-selected="handleSortChange" />
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions-section">
      <h4 class="section-title">
        <i class="fas fa-bolt"></i>
        Quick Actions
      </h4>
      <div class="action-buttons">
        <button @click="clearFilters" class="action-button">
          <i class="fas fa-times"></i>
          Clear Filters
        </button>
        <button @click="refreshMarketplace" class="action-button">
          <i class="fas fa-sync"></i>
          Refresh
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, inject } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';

export default {
  name: 'MarketplacePanel',
  components: {
    CustomSelect,
  },
  props: {
    marketplaceWorkflows: {
      type: Array,
      default: () => [],
    },
    featuredWorkflows: {
      type: Array,
      default: () => [],
    },
    filters: {
      type: Object,
      default: () => ({}),
    },
    selectedWorkflow: {
      type: Object,
      default: null,
    },
    activeTab: {
      type: String,
      default: 'all',
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});

    // Read directly from Vuex so data is available immediately
    const marketplaceWorkflows = computed(() => store.state.marketplace?.marketplaceItems || props.marketplaceWorkflows || []);
    const featuredWorkflows = computed(() => store.state.marketplace?.featuredItems || []);

    const priceOptions = [
      { value: 'all', label: 'All' },
      { value: 'free', label: 'Free' },
      { value: 'paid', label: 'Paid' },
    ];

    const sortOptions = [
      { value: 'popular', label: 'Most Popular' },
      { value: 'recent', label: 'Most Recent' },
      { value: 'rating', label: 'Highest Rated' },
      { value: 'downloads', label: 'Most Downloads' },
      { value: 'price-low', label: 'Price: Low to High' },
      { value: 'price-high', label: 'Price: High to Low' },
    ];

    // Get the current dataset based on active tab
    const currentDataset = computed(() => {
      return marketplaceWorkflows.value;
    });

    const freeCount = computed(() => {
      return currentDataset.value.filter((w) => !w.price || w.price === 0).length;
    });

    const paidCount = computed(() => {
      return currentDataset.value.filter((w) => w.price && w.price > 0).length;
    });

    const updateFilter = (key, value) => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'update-filters', { [key]: value });
    };

    const handleSortChange = (option) => {
      playSound('typewriterKeyPress');
      updateFilter('sortBy', option.value);
    };

    const clearFilters = () => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'update-filters', {
        priceRange: 'all',
        minRating: 0,
        sortBy: 'popular',
        search: '',
      });
    };

    const refreshMarketplace = () => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'refresh-marketplace');
    };

    const getPriceIcon = (value) => {
      const icons = {
        all: 'fas fa-list',
        free: 'fas fa-gift',
        paid: 'fas fa-dollar-sign',
      };
      return icons[value] || 'fas fa-list';
    };

    return {
      marketplaceWorkflows,
      featuredWorkflows,
      priceOptions,
      sortOptions,
      freeCount,
      paidCount,
      updateFilter,
      handleSortChange,
      clearFilters,
      refreshMarketplace,
      getPriceIcon,
    };
  },
};
</script>

<style scoped>
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

.stat-item i {
  width: 14px;
  text-align: center;
}

.ui-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  height: 100%;
  position: relative;
  padding-right: 4px;
  z-index: 3;
  overflow-y: auto;
  scrollbar-color: #19ef831f transparent;
  scrollbar-width: thin;
}

.section-title {
  color: var(--color-text-muted);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
  font-weight: 600;
  opacity: 0.95;
}

.section-title i {
  color: var(--color-green);
}

/* Sections */
.marketplace-stats-section,
.price-filter-section,
.rating-filter-section,
.sort-section,
.quick-actions-section {
  background: rgb(0 0 0 / 10%);
  border: 1px solid var(--terminal-border-color);
  padding: 16px;
  border-radius: 8px;
}

.rating-filter-section .filter-list,
.price-filter-section .filter-list {
  flex-direction: row;
  justify-content: space-between;
  gap: 8px;
}

.rating-filter-section .filter-item,
.price-filter-section .filter-item {
  flex: 1;
  border-color: var(--terminal-border-color);
  justify-content: center;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 12px;
  border-radius: 6px;
  text-align: center;
}

.stat-value {
  font-size: 1.8em;
  font-weight: bold;
  color: var(--color-text);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.8em;
  color: var(--color-secondary);
  text-transform: uppercase;
}

/* Filter Lists */
.filter-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-muted);
  border: 1px solid transparent;
}

.filter-item:hover {
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-text);
}

.filter-item.active {
  background: rgba(25, 239, 131, 0.15);
  border-color: rgba(25, 239, 131, 0.3);
  color: var(--color-green);
}

.filter-item i {
  width: 16px;
  text-align: center;
  font-size: 0.9em;
}

.filter-item span {
  font-size: 0.9em;
}

.rating-filter-section .filter-item span,
.price-filter-section .filter-item span {
  flex: initial;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-button {
  padding: 8px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  font-size: 0.9em;
  justify-content: flex-start;
  width: 100%;
}

.action-button:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.5);
}

.action-button i {
  width: 16px;
  text-align: center;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .stat-card {
    padding: 8px;
  }

  .stat-value {
    font-size: 1.2em;
  }
}
</style>
