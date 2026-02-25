<template>
  <div class="dt-root">
    <div class="dt-title" v-if="tableTitle">{{ tableTitle }}</div>
    <div class="dt-table-wrap">
      <table class="dt-table">
        <thead v-if="columns.length > 0">
          <tr>
            <th v-for="col in columns" :key="col">{{ col }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in rows" :key="idx">
            <td v-for="col in columns" :key="col">{{ row[col] ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="rows.length === 0" class="dt-empty">No data</div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'DataTableTemplate',
  props: {
    config: { type: Object, default: () => ({}) },
    definition: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const tableTitle = computed(() => props.config.title || '');

    const columns = computed(() => {
      if (props.config.columns && Array.isArray(props.config.columns)) {
        return props.config.columns;
      }
      // Auto-detect from first row
      const data = props.config.data || [];
      if (data.length > 0 && typeof data[0] === 'object') {
        return Object.keys(data[0]);
      }
      return [];
    });

    const rows = computed(() => {
      return props.config.data || [];
    });

    return { tableTitle, columns, rows };
  },
};
</script>

<style scoped>
.dt-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 6px;
}

.dt-title {
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-green);
  font-weight: 600;
  flex-shrink: 0;
}

.dt-table-wrap {
  flex: 1;
  overflow: auto;
}

.dt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.dt-table th {
  text-align: left;
  padding: 5px 8px;
  color: var(--color-text-muted, #667);
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  font-size: 9px;
  border-bottom: 1px solid var(--terminal-border-color);
  position: sticky;
  top: 0;
  background: var(--color-background);
}

.dt-table td {
  padding: 4px 8px;
  color: var(--color-light-0, #aab);
  border-bottom: 1px solid rgba(255,255,255,0.02);
}

.dt-table tr:hover td {
  background: rgba(255,255,255,0.02);
}

.dt-empty {
  text-align: center;
  padding: 24px;
  color: var(--color-text-muted, #334);
  font-size: 11px;
}
</style>
