<template>
  <div class="list-with-search">
    <!-- Selected items as chips (always shown) -->
    <div class="selected-chips">
      <template v-if="selectedItems.length > 0">
        <div v-for="item in selectedItems" :key="item[idKey]" class="chip">
          <span>{{ item[labelKey] || item[idKey] }}</span>
          <button class="chip-remove" @click="toggle(item[idKey])">×</button>
        </div>
      </template>
      <template v-else>
        <span class="chips-placeholder">{{ chipsPlaceholder }}</span>
      </template>
    </div>

    <div class="list-with-search-controls">
      <!-- Search bar on its own row -->
      <div class="search-row">
        <BaseInput v-model="search" :placeholder="placeholder || 'Search...'" class="list-search" />
        <BaseSelect v-model="sortOrder" :options="sortOptions" class="list-sort" maxHeight="200px" />
      </div>

      <!-- Select all / Remove all button on its own row -->
      <div class="select-all-row">
        <button class="select-all-btn" :class="{ remove: allSelected }" type="button" @click="toggleAll">
          <span v-if="allSelected">Remove all {{ allLabel }} from Agent</span>
          <span v-else>Make all {{ allLabel }} available to Agent</span>
        </button>
      </div>
    </div>
    <div class="list-items">
      <div v-if="sortedItems.length === 0" class="empty-state">No items found</div>
      <div v-else v-for="item in sortedItems" :key="item[idKey]" class="list-option">
        <input
          type="checkbox"
          :id="'list-' + item[idKey]"
          :value="item[idKey]"
          :checked="modelValue.includes(item[idKey])"
          @change="toggle(item[idKey])"
        />
        <label :for="'list-' + item[idKey]">{{ item[labelKey] || item[idKey] }}</label>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import BaseInput from './BaseInput.vue';
import BaseSelect from './BaseSelect.vue';

export default {
  name: 'ListWithSearch',
  components: { BaseInput, BaseSelect },
  props: {
    items: { type: Array, required: true },
    modelValue: { type: Array, required: true },
    labelKey: { type: String, default: 'name' },
    idKey: { type: String, default: 'id' },
    placeholder: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const search = ref('');
    const sortOrder = ref('az');
    const sortOptions = [
      { value: 'az', label: 'A-Z' },
      { value: 'za', label: 'Z-A' },
    ];

    const filteredItems = computed(() => {
      if (!search.value.trim()) return props.items;
      const q = search.value.toLowerCase();
      return props.items.filter((item) =>
        String(item[props.labelKey] || item[props.idKey] || '')
          .toLowerCase()
          .includes(q)
      );
    });

    const selectedItems = computed(() => {
      return props.items.filter((item) => props.modelValue.includes(item[props.idKey]));
    });

    const sortedItems = computed(() => {
      const arr = [...filteredItems.value];
      arr.sort((a, b) => {
        const aLabel = String(a[props.labelKey] || a[props.idKey] || '').toLowerCase();
        const bLabel = String(b[props.labelKey] || b[props.idKey] || '').toLowerCase();
        if (sortOrder.value === 'az') return aLabel.localeCompare(bLabel);
        else return bLabel.localeCompare(aLabel);
      });
      return arr;
    });
    const toggle = (id) => {
      const next = props.modelValue.includes(id) ? props.modelValue.filter((i) => i !== id) : [...props.modelValue, id];
      emit('update:modelValue', next);
    };

    // Dynamic label for select all button
    const allLabel = computed(() => {
      if (props.placeholder && props.placeholder.toLowerCase().includes('tool')) return 'Tools';
      if (props.placeholder && props.placeholder.toLowerCase().includes('workflow')) return 'Workflows';
      if (props.labelKey && props.labelKey.toLowerCase().includes('tool')) return 'Tools';
      if (props.labelKey && props.labelKey.toLowerCase().includes('workflow')) return 'Workflows';
      return 'Items';
    });

    // Dynamic placeholder for chips area
    const chipsPlaceholder = computed(() => {
      if (allLabel.value === 'Tools') return 'Select tools for your agent to use';
      if (allLabel.value === 'Workflows') return 'Select workflows for your agent to use';
      return 'Select items for your agent to use';
    });

    // All selected state
    const allSelected = computed(() => {
      if (!props.items.length) return false;
      return props.items.every((item) => props.modelValue.includes(item[props.idKey]));
    });

    // Toggle all function
    const toggleAll = () => {
      if (allSelected.value) {
        emit('update:modelValue', []);
      } else {
        const allIds = props.items.map((item) => item[props.idKey]);
        emit('update:modelValue', allIds);
      }
    };

    return {
      search,
      sortOrder,
      sortOptions,
      sortedItems,
      selectedItems,
      toggle,
      allLabel,
      allSelected,
      toggleAll,
      chipsPlaceholder,
    };
  },
};
</script>

<style scoped>
.list-with-search {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-height: 0;
}
.selected-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  height: 58px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid rgba(var(--green-rgb), 0.1);
  border-radius: 8px 8px 0 0;
  align-content: flex-start;
  flex-direction: row;
  justify-content: flex-start;
  align-items: flex-start;
}

.select-all-row {
  display: flex;
  justify-content: center;
  width: 100%;
}
.select-all-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.25);
  color: var(--color-light-green);
  border-radius: 4px;
  padding: 7px 12px;
  height: 32px;
  font-size: 0.95em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border 0.15s;
}
.select-all-btn:hover {
  background: var(--color-darker-2);
}
.select-all-btn.remove {
  background: rgba(var(--red-rgb), 0.05);
  border: 1px solid rgba(var(--red-rgb), 0.25);
  color: var(--color-red);
  opacity: 0.75;
}
.select-all-btn.remove:hover {
  background: rgba(var(--red-rgb), 0.22);
  opacity: 1;
}

/* Styling for thin scrollbar */
.selected-chips::-webkit-scrollbar {
  width: 4px;
}
.selected-chips::-webkit-scrollbar-track {
  background: var(--color-darker-0);
  border-radius: 4px;
}
.selected-chips::-webkit-scrollbar-thumb {
  background: var(--color-duller-navy);
  border-radius: 4px;
}
.selected-chips::-webkit-scrollbar-thumb:hover {
  background: var(--color-med-navy);
}

.chip {
  display: flex;
  align-items: center;
  background: var(--color-darker-2);
  border-radius: 16px;
  padding: 4px 8px 2px 12px;
  font-size: 0.9em;
  color: var(--color-dull-white);
}
.chip-remove {
  background: none;
  border: none;
  color: var(--color-med-navy);
  font-size: 1.2em;
  line-height: 1;
  padding: 0 0 0 4px;
  cursor: pointer;
  margin-left: 4px;
}
.chip-remove:hover {
  color: var(--color-dull-white);
}
.list-with-search-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.list-search {
  flex: 1;
}

.list-sort {
  width: 80px;
}

.select-all-row {
  display: flex;
  justify-content: center;
  width: 100%;
}
.list-items {
  display: flex;
  flex-direction: column;
  gap: 0px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 0px;
  padding: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.list-option:first-child {
  border-top: none;
}
.list-option {
  display: flex;
  border-top: 1px solid rgba(18, 224, 255, 0.1);
  align-items: center;
  gap: 6px;
  cursor: pointer !important;
}
.list-option label {
  font-size: 0.95em;
  color: var(--color-light-green);
  cursor: pointer !important;
}
.list-option input {
  cursor: pointer !important;
}
.empty-state {
  color: var(--color-grey);
  font-size: 0.9em;
  padding: 4px 0;
}
.chips-placeholder {
  color: var(--color-grey);
  font-size: 0.95em;
  opacity: 0.5;
  padding: 20px;
  width: 100%;
  text-align: center;
}
</style>
