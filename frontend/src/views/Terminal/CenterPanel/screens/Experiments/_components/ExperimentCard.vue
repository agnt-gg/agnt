<template>
  <div class="experiment-card" :class="{ selected }" @click="$emit('click')">
    <div class="card-header">
      <span class="card-icon"><i class="fas fa-flask"></i></span>
      <div class="card-title-block">
        <span class="card-name">{{ experiment.name }}</span>
        <span class="card-category">{{ experiment.type || 'ab_test' }}</span>
      </div>
      <div class="card-actions">
        <Tooltip v-if="experiment.status === 'planned'" text="Run">
          <button class="card-btn run" @click.stop="$emit('run')">
            <i class="fas fa-play"></i>
          </button>
        </Tooltip>
        <Tooltip text="Delete">
          <button class="card-btn delete" @click.stop="$emit('delete')">
            <i class="fas fa-trash"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <p v-if="experiment.hypothesis" class="card-description">
      "{{ experiment.hypothesis?.length > 100 ? experiment.hypothesis.substring(0, 100) + '...' : experiment.hypothesis }}"
    </p>

    <div v-if="experiment.status === 'running' && experiment.progress" class="card-progress">
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: (experiment.progress?.total ? (experiment.progress.completed / experiment.progress.total) * 100 : 0) + '%' }"
        ></div>
      </div>
      <span class="progress-text">{{ experiment.progress?.completed || 0 }}/{{ experiment.progress?.total || 0 }} runs</span>
    </div>

    <div class="card-footer">
      <span class="status-badge" :class="experiment.status">{{ experiment.status }}</span>
      <span
        v-if="experiment.result?.delta != null"
        class="delta-badge"
        :class="experiment.result.delta > 0 ? 'positive' : 'negative'"
      >Delta: {{ experiment.result.delta > 0 ? '+' : '' }}{{ experiment.result.delta?.toFixed(3) }}</span>
      <span
        v-if="experiment.result?.decision"
        class="decision-badge"
        :class="experiment.result.decision"
      >{{ experiment.result.decision }}</span>
    </div>
  </div>
</template>

<script setup>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

defineProps({
  experiment: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
defineEmits(['click', 'delete', 'run']);
</script>

<style scoped>
.experiment-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.experiment-card:hover {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(0, 0, 0, 0.25);
}
.experiment-card.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}

/* Card Header */
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.card-icon {
  font-size: 1.5em;
}
.card-title-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.card-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-category {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Card Actions */
.card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.experiment-card:hover .card-actions {
  opacity: 1;
}
.card-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-grey);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75em;
  transition: all 0.15s;
}
.card-btn:hover {
  color: var(--color-text);
  background: rgba(var(--green-rgb), 0.2);
}
.card-btn.run:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.15);
}
.card-btn.delete:hover {
  color: var(--color-red);
  border-color: rgba(255, 77, 79, 0.3);
  background: rgba(255, 77, 79, 0.1);
}

/* Card Description (hypothesis) */
.card-description {
  font-size: 0.85em;
  color: var(--color-grey);
  margin: 0 0 8px;
  line-height: 1.4;
  font-style: italic;
}

/* Progress Bar */
.card-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--terminal-border-color);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--color-green);
  border-radius: 3px;
  transition: width 0.3s;
}
.progress-text {
  font-size: 0.75em;
  color: var(--color-grey);
  white-space: nowrap;
}

/* Card Footer */
.card-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
}
.status-badge.planned {
  background: rgba(150, 150, 150, 0.15);
  color: #999;
}
.status-badge.running {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}
.status-badge.completed {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}
.status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.delta-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
}
.delta-badge.positive {
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
}
.delta-badge.negative {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.decision-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
}
.decision-badge.keep {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}
.decision-badge.discard {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.decision-badge.iterate {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}
</style>
