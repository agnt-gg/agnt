<template>
  <div class="goals-toolbar">
    <div class="search-input">
      <i class="fas fa-search"></i>
      <input
        ref="searchRef"
        :value="searchQuery"
        placeholder="Search goals..."
        @input="onSearchInput"
      />
      <kbd v-if="!searchQuery">/</kbd>
    </div>

    <div class="filter-chips">
      <button
        v-for="filter in statusFilters"
        :key="filter.value"
        class="filter-chip"
        :class="{ active: activeFilters.includes(filter.value) }"
        @click="toggleFilter(filter.value)"
      >
        <span class="chip-dot" :class="filter.value"></span>
        {{ filter.label }}
        <span class="chip-count">{{ filter.count }}</span>
      </button>
      <button
        v-if="activeFilters.length > 0"
        class="filter-chip clear-chip"
        @click="clearFilters"
        title="Clear filters"
      >
        <i class="fas fa-times"></i>
      </button>
    </div>

    <select class="sort-select" :value="sortBy" @change="$emit('update:sortBy', $event.target.value)">
      <option value="created_desc">Newest first</option>
      <option value="created_asc">Oldest first</option>
      <option value="progress_desc">Most progress</option>
      <option value="progress_asc">Least progress</option>
      <option value="priority">Priority</option>
    </select>
  </div>
</template>

<script>
import { ref, computed } from 'vue';

export default {
  name: 'GoalsToolbar',
  props: {
    searchQuery: { type: String, default: '' },
    activeFilters: { type: Array, default: () => [] },
    sortBy: { type: String, default: 'created_desc' },
    goals: { type: Array, default: () => [] },
  },
  emits: ['update:searchQuery', 'update:activeFilters', 'update:sortBy'],
  setup(props, { emit }) {
    const searchRef = ref(null);

    const statusFilters = computed(() => {
      const counts = props.goals.reduce((acc, g) => {
        acc[g.status] = (acc[g.status] || 0) + 1;
        return acc;
      }, {});
      return [
        // Rejected-review goals come back as `queued`; bundle them into Planning
        // since the dedicated Queued column was removed.
        { label: 'Planning', value: 'planning', count: (counts.planning || 0) + (counts.queued || 0) },
        { label: 'Executing', value: 'executing', count: counts.executing || 0 },
        { label: 'Paused', value: 'paused', count: counts.paused || 0 },
        { label: 'Review', value: 'needs_review', count: counts.needs_review || 0 },
        { label: 'Done', value: 'completed', count: (counts.completed || 0) + (counts.validated || 0) },
        { label: 'Failed', value: 'failed', count: (counts.failed || 0) + (counts.error || 0) + (counts.stopped || 0) },
      ];
    });

    const toggleFilter = (value) => {
      const next = props.activeFilters.includes(value)
        ? props.activeFilters.filter((v) => v !== value)
        : [...props.activeFilters, value];
      emit('update:activeFilters', next);
    };

    const clearFilters = () => emit('update:activeFilters', []);

    const onSearchInput = (evt) => emit('update:searchQuery', evt.target.value);

    const focus = () => searchRef.value?.focus();

    return {
      searchRef,
      statusFilters,
      toggleFilter,
      clearFilters,
      onSearchInput,
      focus,
    };
  },
};
</script>

<style scoped>
.goals-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  flex-wrap: wrap;
}

.search-input {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 0 10px;
  min-width: 220px;
  flex: 0 1 280px;
  transition: border-color 0.2s ease;
}

.search-input:focus-within {
  border-color: rgba(var(--green-rgb), 0.4);
}

.search-input i {
  color: var(--color-text-muted);
  font-size: 0.8em;
}

.search-input input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text);
  padding: 7px 8px;
  font-size: 0.85em;
  font-family: inherit;
}

.search-input input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.6;
}

.search-input kbd {
  font-size: 0.7em;
  background: var(--color-darker-2);
  color: var(--color-text-muted);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-family-mono);
}

.filter-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}

.filter-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 14px;
  color: var(--color-text-muted);
  padding: 3px 10px;
  font-size: 0.75em;
  cursor: pointer;
  transition: all 0.18s ease;
  font-family: inherit;
}

.filter-chip:hover {
  border-color: rgba(var(--green-rgb), 0.35);
  color: var(--color-text);
}

.filter-chip.active {
  background: rgba(var(--green-rgb), 0.12);
  border-color: rgba(var(--green-rgb), 0.45);
  color: var(--color-green);
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.chip-dot.planning { background: var(--color-violet); }
.chip-dot.queued { background: var(--color-indigo); }
.chip-dot.executing { background: var(--color-green); }
.chip-dot.paused { background: var(--color-yellow); }
.chip-dot.needs_review { background: var(--color-orange); }
.chip-dot.completed { background: var(--color-green); }
.chip-dot.failed { background: var(--color-red); }

.chip-count {
  background: var(--color-darker-2);
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 0.85em;
}

.filter-chip.active .chip-count {
  background: rgba(var(--green-rgb), 0.2);
}

.clear-chip {
  color: var(--color-red);
  border-color: rgba(var(--red-rgb), 0.3);
}

.sort-select {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  padding: 6px 10px;
  font-size: 0.8em;
  font-family: inherit;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s ease;
}

.sort-select option {
  background: var(--color-popup);
  color: var(--color-text);
}

.sort-select:hover,
.sort-select:focus {
  border-color: rgba(var(--green-rgb), 0.4);
}
</style>
