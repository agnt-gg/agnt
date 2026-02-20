<template>
  <BaseTable
    v-if="currentLayout === 'table'"
    :items="items"
    :columns="columns"
    :selected-id="selectedId"
    :show-search="true"
    search-placeholder="Search agents..."
    :search-keys="['name', 'status', 'category']"
    :no-results-text="'No agents found.'"
    title-key="name"
    @row-click="(item) => emit('row-click', item)"
    @search="(query) => emit('search', query)"
  >
    <template #avatar="{ item }">
      <div class="avatar-cell">
        <img
          :src="
            item.avatar ||
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5RUY4MyIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMiAxMmMyLjIxIDAgNC0xLjc5IDQtNHMtMS43OS00LTQtNC00IDEuNzktNCA0IDEuNzkgNCA0IDR6bTAgMmMtMi42NyAwLTggMS4zNC04IDR2MmgxNnYtMmMwLTIuNjYtNS4zMy00LTgtNHoiLz48L3N2Zz4='
          "
          alt="Agent avatar"
          class="agent-avatar"
        />
      </div>
    </template>
    <template #category="{ item }">
      <span class="agent-category">{{ item.category }}</span>
    </template>
    <template #status="{ item }">
      <div :class="['col-status', (item.status || '').toLowerCase()]">
        {{ item.status }}
      </div>
    </template>
    <template #tools="{ item }"> {{ item.assignedTools ? item.assignedTools.length : 0 }} tools </template>
    <template #uptime="{ item }">
      {{ formatUptime(item.uptime) }}
    </template>
  </BaseTable>
  <BaseCardGrid
    v-else
    :items="items"
    :columns="columns"
    :selected-id="selectedId"
    :show-search="true"
    title-key="name"
    search-placeholder="Search agents..."
    :search-keys="['name', 'status', 'category']"
    :no-results-text="'No agents found.'"
    @row-click="(item) => emit('row-click', item)"
    @search="(query) => emit('search', query)"
  >
    <template #avatar="{ item }">
      <div class="avatar-cell">
        <img
          :src="
            item.avatar ||
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5RUY4MyIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMiAxMmMyLjIxIDAgNC0xLjc5IDQtNHMtMS43OS00LTQtNC00IDEuNzktNCA0IDEuNzkgNCA0IDR6bTAgMmMtMi42NyAwLTggMS4zNC04IDR2MmgxNnYtMmMwLTIuNjYtNS4zMy00LTgtNHoiLz48L3N2Zz4='
          "
          alt="Agent avatar"
          class="agent-avatar"
        />
      </div>
    </template>
    <template #name="{ item }">
      <div>
        <div class="agent-name">{{ item.name }}</div>
        <div v-if="item.category" class="agent-category">
          {{ item.category }}
        </div>
      </div>
    </template>
    <template #status="{ item }">
      <div :class="['col-status', (item.status || '').toLowerCase()]">
        {{ item.status }}
      </div>
    </template>
    <template #tools="{ item }"> {{ item.assignedTools ? item.assignedTools.length : 0 }} tools </template>
    <template #uptime="{ item }">
      {{ formatUptime(item.uptime) }}
    </template>
  </BaseCardGrid>
</template>

<script setup>
import BaseTable from '../../../../_components/BaseTable.vue';
import BaseCardGrid from '../../../../_components/BaseCardGrid/BaseCardGrid.vue';

defineProps({
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
  currentLayout: {
    type: String,
    default: 'grid',
  },
  formatUptime: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits(['row-click', 'search']);
</script>

<style scoped>
/* Copied from Agents.vue */
.avatar-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(var(--green-rgb), 0.2);
  padding: 2px;
  border: 2px solid rgba(var(--green-rgb), 0.5);
  object-fit: cover;
}

.agent-category {
  color: var(--color-grey);
  font-size: 0.92em;
  font-style: italic;
  margin-top: 2px;
}

.agent-name {
  /* This style wasn't explicitly in Agents.vue but is good for the card view */
  font-weight: bold;
  color: var(--color-light-green);
}

.col-status {
  text-transform: capitalize;
}

/* Ensure card content is well-behaved */
:deep(.card-content) {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  gap: 12px;
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
  padding-right: 4px;
  justify-content: flex-start;
  align-items: flex-start;
  align-content: space-between;
}
</style>
