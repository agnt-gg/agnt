<template>
  <EntityCard
    root-class="experiment-card"
    :title="experiment.name"
    :subtitle="experiment.type || 'ab_test'"
    :description="hypothesis"
    description-style="quote"
    :selected="selected"
    :actions="actions"
    @click="emit('click')"
    @action="emit"
  >
    <template #icon>
      <span class="card-icon"><i class="fas fa-flask"></i></span>
    </template>

    <div v-if="experiment.status === 'running' && experiment.progress" class="card-progress">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressWidth }"></div>
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
  </EntityCard>
</template>

<script setup>
import { computed } from 'vue';
import EntityCard from '@/views/Terminal/_components/cards/EntityCard.vue';

const props = defineProps({
  experiment: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(['click', 'delete', 'run']);

const actions = computed(() => [
  ...(props.experiment.status === 'planned' ? [{ name: 'run', icon: 'fas fa-play', tooltip: 'Run' }] : []),
  { name: 'delete', icon: 'fas fa-trash', tooltip: 'Delete' },
]);

/** The hypothesis is shown quoted and italic, truncated to one or two lines. */
const hypothesis = computed(() => {
  const text = props.experiment.hypothesis;
  if (!text) return '';
  return `"${text.length > 100 ? text.substring(0, 100) + '...' : text}"`;
});

const progressWidth = computed(() => {
  const progress = props.experiment.progress;
  return (progress?.total ? (progress.completed / progress.total) * 100 : 0) + '%';
});
</script>

<style scoped>
/* Frame, header, actions and description live in _components/cards/EntityCard.vue */

.card-icon {
  font-size: 1.5em;
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
  color: var(--color-text-muted);
}
.status-badge.running {
  background: rgba(59, 130, 246, 0.15);
  color: var(--status-blue-text);
}
.status-badge.completed {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}
.status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-red);
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
  color: var(--color-red);
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
  color: var(--color-red);
}
.decision-badge.iterate {
  background: rgba(245, 158, 11, 0.15);
  color: var(--status-amber-text);
}
</style>
