<template>
  <div class="goals-toolbar">
    <div class="search-input">
      <i class="fas fa-search"></i>
      <input
        ref="searchRef"
        :value="searchQuery"
        placeholder="Search goals..."
        aria-label="Search goals"
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
        :aria-pressed="activeFilters.includes(filter.value)"
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
        v-tooltip="'Clear filters'"
      >
        <i class="fas fa-times"></i>
      </button>
    </div>

    <CustomSelect
      class="sort-select"
      :model-value="sortBy"
      :options="[
        { label: 'Newest first', value: 'created_desc' },
        { label: 'Oldest first', value: 'created_asc' },
        { label: 'Most progress', value: 'progress_desc' },
        { label: 'Least progress', value: 'progress_asc' },
        { label: 'Priority', value: 'priority' },
      ]"
      @update:model-value="$emit('update:sortBy', $event)"
    />
    <BaseButton type="button" class="new-goal-button" @click="$emit('create-goal')">
      <i class="fas fa-plus" aria-hidden="true"></i> New goal
    </BaseButton>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import { GOAL_COLUMNS, getGoalStage, needsGoalReview } from '../goalBoard.js';

export default {
  name: 'GoalsToolbar',
  components: { CustomSelect, BaseButton },
  props: {
    searchQuery: { type: String, default: '' },
    activeFilters: { type: Array, default: () => [] },
    sortBy: { type: String, default: 'created_desc' },
    goals: { type: Array, default: () => [] },
  },
  emits: ['update:searchQuery', 'update:activeFilters', 'update:sortBy', 'create-goal'],
  setup(props, { emit }) {
    const searchRef = ref(null);

    const statusFilters = computed(() => {
      const counts = props.goals.reduce((counts, goal) => {
        const stage = getGoalStage(goal);
        counts[stage] = (counts[stage] || 0) + 1;
        return counts;
      }, {});
      return [
        { label: 'Needs my review', value: 'attention', count: props.goals.filter(needsGoalReview).length },
        ...GOAL_COLUMNS.map((column) => ({ label: column.title, value: column.id, count: counts[column.id] || 0 })),
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
.chip-dot.attention { background: var(--color-primary); }
.chip-dot.plan { background: var(--color-violet); }
.chip-dot.build { background: var(--color-green); }
.chip-dot.review { background: var(--color-orange); }
.chip-dot.done { background: var(--color-green); }

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

.new-goal-button {
  width: auto;
  min-height: 36px;
  padding: 8px 12px;
  font-size: 0.85em;
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
