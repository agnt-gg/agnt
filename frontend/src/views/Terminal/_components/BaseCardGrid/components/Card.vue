<template>
  <div
    class="card-item"
    :class="{
      selected: selectedId === (item.id || index),
      [item.status?.toLowerCase()]: item.status,
    }"
    @click="handleCardClick(item)"
  >
    <div class="card-status" v-if="getStatusColumn">
      <div :class="['status-indicator', item.status?.toLowerCase()]">[{{ item.status || 'N/A' }}]</div>
    </div>

    <div class="card-header">
      <slot name="title" :item="item">
        {{ getTitleValue(item) }}
      </slot>
    </div>

    <div class="card-content">
      <div v-for="column in displayColumns" :key="column.key" class="card-field">
        <template v-if="column.key === 'avatar'">
          <div class="field-value">
            <slot :name="column.key" :item="item">
              {{ getColumnValue(item, column) }}
            </slot>
          </div>
        </template>
        <template v-else>
          <div class="field-label">{{ column.label }}:</div>
          <div class="field-value">
            <slot :name="column.key" :item="item">
              {{ getColumnValue(item, column) }}
            </slot>
          </div>
        </template>
      </div>
    </div>

    <!-- Tool Icons at the bottom of card -->
    <div class="card-tools" v-if="item.tools && item.tools.length">
      <!-- <div class="tools-label">Tools:</div> -->
      <div class="tools-icons">
        <span v-for="(tool, idx) in item.tools" :key="'tool-' + idx" class="tool-icon">
          <SvgIcon :name="tool" />
        </span>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, inject } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';

export default {
  name: 'Card',
  components: {
    SvgIcon,
  },
  props: {
    item: { type: Object, required: true },
    columns: { type: Array, required: true },
    selectedId: { type: [String, Number], default: null },
    titleKey: { type: String, default: 'title' },
    index: { type: Number, default: 0 },
  },
  emits: ['card-click'],
  setup(props, { emit }) {
    const displayColumns = computed(() => {
      return props.columns.filter((col) => col.key !== props.titleKey && col.key !== 'status' && col.key !== 'icon');
    });

    const getStatusColumn = computed(() => {
      return props.columns.find((col) => col.key === 'status');
    });

    const handleCardClick = (item) => {
      emit('card-click', item);
    };

    const getTitleValue = (item) => {
      return getColumnValue(item, { key: props.titleKey });
    };

    const getColumnValue = (item, column) => {
      if (!column) return '';
      if (column.formatter) {
        return column.formatter(item[column.key], item);
      }
      const keys = column.key.split('.');
      let value = item;
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined) break;
      }
      return value ?? '';
    };

    return {
      displayColumns,
      getStatusColumn,
      handleCardClick,
      getColumnValue,
      getTitleValue,
    };
  },
};
</script>

<style scoped>
.card-item {
  /* background: linear-gradient(
    135deg,
    rgba(18, 224, 255, 0.05) 0%,
    rgba(18, 224, 255, 0.02) 100%
  ); */
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--color-text);
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  position: relative;
  min-height: 259px;
  max-height: 259px;
  overflow: hidden;
}
.card-item:hover {
  background: rgba(var(--green-rgb), 0.08);
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}
.card-item.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-left: 3px solid var(--color-primary);
  padding-left: 11px;
}
.card-status {
  position: absolute;
  top: 10px;
  right: 10px;
}
.status-indicator {
  font-size: 0.8em;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 3px;
  display: inline-block;
}
.card-header {
  font-size: 1.1em;
  font-weight: 500;
  color: var(--color-green);
  border-bottom: 1px solid rgba(18, 224, 255, 0.1);
  padding-bottom: 10px;
  padding-right: 60px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-content {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
  padding-right: 4px;
  justify-content: flex-start;
  align-items: flex-start;
  align-content: space-around;
}
.card-content::-webkit-scrollbar {
  width: 4px;
}
.card-content::-webkit-scrollbar-track {
  background: transparent;
}
.card-content::-webkit-scrollbar-thumb {
  background-color: rgba(var(--green-rgb), 0.3);
  border-radius: 4px;
}
.card-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.field-label {
  font-size: 0.8em;
  color: var(--color-text-muted);
  font-weight: 500;
}
.field-value {
  font-size: 0.9em;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  /* -webkit-line-clamp: 3; */
  -webkit-box-orient: vertical;
  color: var(--color-text);
}
.status-indicator.new,
.status-indicator.available {
  color: var(--color-yellow);
}
.status-indicator.active,
.status-indicator.running {
  color: var(--color-green);
}
.status-indicator.completed {
  color: var(--color-blue);
}
.status-indicator.stopped {
  color: var(--color-text-muted);
}
.status-indicator.failed,
.status-indicator.locked {
  color: var(--color-red);
}
.status-indicator.inactive {
  color: var(--color-text-muted);
}

/* Status-based left border colors */
.card-item.active,
.card-item.running {
  border-left: 3px solid var(--color-green);
  padding-left: 11px;
}
.card-item.listening {
  border-left: 3px solid var(--color-blue);
  padding-left: 11px;
}
.card-item.failed,
.card-item.error,
.card-item.locked {
  border-left: 3px solid var(--color-red);
  padding-left: 11px;
}
.card-item.completed {
  border-left: 3px solid var(--color-blue);
  padding-left: 11px;
}
.card-item.stopped {
  border-left: 3px solid var(--color-text-muted);
  padding-left: 11px;
}
.card-item.inactive {
  border-left: 3px solid var(--color-text-muted);
  padding-left: 11px;
}
.card-item.queued,
.card-item.waiting,
.card-item.new,
.card-item.available {
  border-left: 3px solid var(--color-yellow);
  padding-left: 11px;
}

/* Tool icons styling */
.card-tools {
  margin-top: auto;
  border-top: 1px solid rgba(18, 224, 255, 0.1);
  padding-top: 8px;
}

.tools-label {
  font-size: 0.8em;
  color: var(--color-grey);
  font-weight: 500;
  margin-bottom: 5px;
}

.tools-icons {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}

.tool-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.tool-icon :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
