<template>
  <!--
    TWO ROWS, not one wrapping row. Everything used to sit on a single flex
    line with the chips on flex:1, so the chips ate the middle and pushed the
    primary action onto a second line BELOW the search box — the one control
    that should never be hard to find was the one that moved. Identity and
    actions are now a fixed top line, and the controls that narrow the list sit
    together underneath.
  -->
  <div class="goals-toolbar">
    <div v-if="!compact" class="gt-head">
      <div class="gt-identity">
        <span class="gt-title">GOALS</span>
        <span class="gt-count">{{ goals.length }} {{ goals.length === 1 ? 'goal' : 'goals' }}</span>
      </div>
      <div class="gt-actions">
        <CustomSelect
          class="sort-select"
          :model-value="sortBy"
          :options="sortOptions"
          @update:model-value="$emit('update:sortBy', $event)"
        />
        <BaseButton type="button" class="new-goal-button" @click="$emit('create-goal')">
          <i class="fas fa-plus" aria-hidden="true"></i> New goal
        </BaseButton>
      </div>
    </div>

    <div class="gt-filters">
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

      <!-- Compact (inside the mobile sheet) has no head row, so the sort
           control rides here instead of disappearing with it. -->
      <CustomSelect
        v-if="compact"
        class="sort-select"
        :model-value="sortBy"
        :options="sortOptions"
        @update:model-value="$emit('update:sortBy', $event)"
      />
    </div>
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
    /** Inside the mobile sheet, which draws its own heading and create button. */
    compact: { type: Boolean, default: false },
  },
  emits: ['update:searchQuery', 'update:activeFilters', 'update:sortBy', 'create-goal'],
  setup(props, { emit }) {
    const searchRef = ref(null);

    // Hoisted out of the template: an inline array literal is a new object on
    // every render, so CustomSelect saw a changed prop on each keystroke in
    // the search box next to it.
    const sortOptions = [
      { label: 'Newest first', value: 'created_desc' },
      { label: 'Oldest first', value: 'created_asc' },
      { label: 'Most progress', value: 'progress_desc' },
      { label: 'Least progress', value: 'progress_asc' },
      { label: 'Priority', value: 'priority' },
    ];

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
      sortOptions,
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
  flex-direction: column;
  gap: 10px;
  padding: 0 0 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  /* The words in this header collapse on the HEADER's width, not the
     viewport's: with both side panels open the centre column is ~735px at
     1440 wide. Same rule as ScreenToolbar. */
  container-type: inline-size;
  container-name: goals-toolbar;
}

/* Row 1 — what this screen is, and the one thing you came here to do. */
.gt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.gt-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.gt-title {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--text-green);
  font-weight: 600;
  white-space: nowrap;
}

.gt-count {
  font-size: 10px;
  color: var(--color-text-muted);
  padding: 1px 6px;
  background: var(--color-darker-0);
  border-radius: 3px;
  white-space: nowrap;
}

.gt-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Row 2 — the controls that narrow what is on the board. */
.gt-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.search-input {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 0 10px;
  /* Fixed, not fluid. A search box has no reason to grow to the width of the
     window — the chips beside it are what should take the slack. */
  flex: 0 0 240px;
  transition: border-color 0.2s ease;
}

@container goals-toolbar (max-width: 640px) {
  .search-input {
    flex-basis: 170px;
  }
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
  min-width: 0;
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
  color: var(--text-green);
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
  min-height: 0;
  padding: 6px 12px;
  font-size: 0.8em;
  white-space: nowrap;
}

.sort-select {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  padding: 5px 10px;
  font-size: 0.78em;
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
