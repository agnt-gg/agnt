<template>
  <div class="goal-card" :class="goal.status" @click="$emit('click', goal)">
    <div class="card-header">
      <div class="goal-id">G-{{ goal.id.slice(0, 8) }}</div>
      <div class="goal-status" :class="goal.status">
        <i :class="getStatusIcon(goal.status)"></i>
        {{ goal.status }}
      </div>
    </div>

    <div class="goal-title">{{ goal.title }}</div>

    <div class="goal-progress">
      <div class="progress-info">
        <span>Progress</span>
        <span>{{ Math.round(goal.progress || 0) }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${goal.progress || 0}%` }"></div>
      </div>
    </div>

    <div class="goal-footer">
      <div class="task-count">
        <i class="fas fa-tasks"></i>
        {{ goal.completed_tasks || 0 }}/{{ goal.task_count || 0 }} tasks
      </div>

      <div class="actions">
        <Tooltip v-if="goal.status === 'executing'" text="Pause Goal" width="auto">
        <button @click.stop="$emit('pause', goal)" class="action-btn pause-btn">
          <i class="fas fa-pause"></i>
        </button>
        </Tooltip>
        <Tooltip v-if="goal.status === 'paused'" text="Resume Goal" width="auto">
        <button @click.stop="$emit('resume', goal)" class="action-btn resume-btn">
          <i class="fas fa-play"></i>
        </button>
        </Tooltip>
        <Tooltip text="Delete Goal" width="auto">
        <button @click.stop="$emit('delete', goal)" class="action-btn delete-btn">
          <i class="fas fa-trash"></i>
        </button>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'GoalCard',
  components: { Tooltip },
  props: {
    goal: {
      type: Object,
      required: true,
    },
  },
  emits: ['click', 'pause', 'resume', 'delete'],
  setup() {
    const getStatusIcon = (status) => {
      const icons = {
        planning: 'fas fa-lightbulb',
        queued: 'fas fa-clock',
        executing: 'fas fa-cog fa-spin',
        paused: 'fas fa-pause',
        needs_review: 'fas fa-exclamation-triangle',
        validated: 'fas fa-check-double',
        completed: 'fas fa-check',
        failed: 'fas fa-times',
        error: 'fas fa-times',
        stopped: 'fas fa-stop',
      };
      return icons[status] || 'fas fa-circle';
    };

    return {
      getStatusIcon,
    };
  },
};
</script>

<style scoped>
.goal-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.goal-card:hover {
  background: rgba(25, 239, 131, 0.05);
  border-color: rgba(25, 239, 131, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.goal-card.executing {
  border-left: 3px solid var(--color-blue);
}
.goal-card.completed {
  border-left: 3px solid var(--color-green);
}
.goal-card.failed {
  border-left: 3px solid var(--color-red);
}
.goal-card.paused {
  border-left: 3px solid var(--color-yellow);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.goal-id {
  font-size: 0.75em;
  color: var(--color-text-muted);
  font-family: monospace;
}

.goal-status {
  font-size: 0.7em;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.goal-status.executing {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}
.goal-status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}
.goal-status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}
.goal-status.paused {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}
.goal-status.planning {
  background: rgba(127, 129, 147, 0.2);
  color: var(--color-text-muted);
}

.goal-title {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 0.75em;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.progress-bar {
  height: 4px;
  background: var(--color-darker-2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
}

.goal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

.task-count {
  font-size: 0.8em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.action-btn:hover {
  background: var(--color-darker-2);
  color: var(--color-text);
}

.pause-btn:hover {
  color: var(--color-yellow);
}
.resume-btn:hover {
  color: var(--color-green);
}
.delete-btn:hover {
  color: var(--color-red);
}
</style>
