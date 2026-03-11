<template>
  <div class="ui-panel experiment-insights-panel">
    <!-- Knowledge Base Section -->
    <div class="panel-section knowledge-section">
      <div class="selected-header">
        <h2>Knowledge Base</h2>
      </div>

      <div class="knowledge-content">
        <p class="description">
          As experiments run, this panel aggregates learnings about which skills improve,
          which dimensions benefit most, and patterns across experiments.
        </p>
      </div>
    </div>

    <!-- Quick Stats Section -->
    <div v-if="stats.total > 0" class="panel-section stats-section">
      <div class="selected-header">
        <h2>Quick Stats</h2>
      </div>

      <div class="stats-content">
        <div class="detail-row">
          <span class="label"><i class="fas fa-flask"></i> Experiments:</span>
          <span class="value">{{ stats.total }}</span>
        </div>
        <div class="detail-row">
          <span class="label"><i class="fas fa-check"></i> Skills Kept:</span>
          <span class="value">{{ stats.kept }}</span>
        </div>
        <div class="detail-row">
          <span class="label"><i class="fas fa-percentage"></i> Success Rate:</span>
          <span class="value">{{ stats.successRate }}%</span>
        </div>
      </div>
    </div>

    <!-- Placeholder when no stats -->
    <div v-else class="panel-section placeholder-section">
      <p>Run experiments to see aggregated insights here.</p>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'ExperimentInsightsPanel',
  components: { ResourcesSection },
  emits: ['panel-action'],
  setup() {
    const store = useStore();

    return {
      stats: computed(() => store.getters['experiments/experimentStats'] || {}),
    };
  },
};
</script>

<style scoped>
.experiment-insights-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  min-height: 0;
}

.panel-section {
  border-radius: 0px;
  padding: 15px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
}

.panel-section h2 {
  color: var(--color-primary);
  font-size: 1.1em;
  margin: 0;
}

.selected-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--primary-rgb), 0.1);
  padding-bottom: 8px;
}

.selected-header h2 {
  margin: 0;
  padding: 0;
  border: none;
}

.knowledge-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.description {
  margin: 0;
  font-size: 0.9em;
  color: var(--color-text);
  line-height: 1.5;
}

.stats-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.detail-row .label {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-row .label i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}

.detail-row .value {
  color: var(--color-primary);
  text-align: right;
}

.placeholder-section {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.placeholder-section p {
  font-style: italic;
  margin: 0 0 16px 0;
  padding: 0;
}
</style>
