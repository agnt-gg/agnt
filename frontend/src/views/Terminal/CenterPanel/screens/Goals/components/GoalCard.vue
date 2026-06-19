<template>
  <div
    class="goal-card"
    :class="[goal.status, agingClass, { selected: isSelected }]"
    @click="$emit('click', goal)"
  >
    <div class="card-body">
      <div class="card-meta-row">
        <span class="goal-id">G-{{ goal.id.slice(0, 8) }}</span>
        <span class="priority-badge" :class="priority">
          <span class="priority-dot" :class="priority"></span>
          {{ priority.toUpperCase() }}
        </span>
      </div>

      <div class="goal-title">{{ goal.title }}</div>

      <div class="status-chip" :class="goal.status">
        <i :class="getStatusIcon(goal.status)"></i>
        {{ formatStatus(goal.status) }}
      </div>

      <div v-if="liveIteration && goal.status === 'executing'" class="iteration-indicator">
        <i class="fas fa-sync fa-spin"></i>
        <span>Iter {{ liveIteration.iteration }}/{{ goal.max_iterations || '∞' }}</span>
        <span class="iteration-phase">• {{ liveIteration.phase }}</span>
        <span v-if="liveIteration.score != null" class="iteration-score">
          {{ Math.round(liveIteration.score) }}%
        </span>
      </div>

      <div
        v-if="runningTaskTitle && goal.status === 'executing'"
        class="running-task"
        :title="runningTaskTitle"
      >
        <i class="fas fa-play-circle"></i>
        <span class="running-task-label">{{ runningTaskTitle }}</span>
        <span v-if="runningTaskCount > 1" class="running-task-more">
          +{{ runningTaskCount - 1 }}
        </span>
      </div>

      <div class="progress-section">
        <div class="progress-meta">
          <span class="progress-label">Progress</span>
          <span class="progress-pct">{{ Math.round(displayProgress) }}%</span>
        </div>
        <div class="progress-track">
          <div
            class="progress-fill"
            :class="goal.status"
            :style="{ width: `${displayProgress}%` }"
          ></div>
        </div>
      </div>

      <div class="card-footer">
        <span class="task-count">
          <i class="fas fa-tasks"></i>
          {{ displayCompleted }}/{{ displayTotal }}
          <span v-if="displayRunning > 0" class="task-running-pill">
            <i class="fas fa-circle-notch fa-spin"></i>{{ displayRunning }}
          </span>
        </span>
        <span v-if="showAge && goal.created_at" class="age-badge" :title="formatDate(goal.created_at)">
          <i class="far fa-clock"></i>
          {{ timeAgo(goal.created_at) }}
        </span>
        <div class="card-actions">
          <Tooltip v-if="goal.status === 'executing'" text="Pause" width="auto">
            <button @click.stop="$emit('pause', goal)" class="action-btn pause-btn">
              <i class="fas fa-pause"></i>
            </button>
          </Tooltip>
          <Tooltip v-if="goal.status === 'paused'" text="Resume" width="auto">
            <button @click.stop="$emit('resume', goal)" class="action-btn resume-btn">
              <i class="fas fa-play"></i>
            </button>
          </Tooltip>
          <Tooltip :text="scheduleCount > 0 ? `Schedule (${scheduleCount} active)` : 'Schedule'" width="auto">
            <button @click.stop="$emit('schedule', goal)" class="action-btn schedule-btn" :class="{ 'has-schedule': scheduleCount > 0 }">
              <i class="fas fa-clock"></i>
            </button>
          </Tooltip>
          <Tooltip text="Delete" width="auto">
            <button @click.stop="$emit('delete', goal)" class="action-btn delete-btn">
              <i class="fas fa-trash"></i>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const AGING_THRESHOLDS = {
  warning: 24 * 60 * 60 * 1000,
  danger: 72 * 60 * 60 * 1000,
  stale: 7 * 24 * 60 * 60 * 1000,
};

const TERMINAL_STATUSES = ['completed', 'validated', 'failed', 'error', 'stopped'];

export default {
  name: 'GoalCard',
  components: { Tooltip },
  props: {
    goal: { type: Object, required: true },
    isSelected: { type: Boolean, default: false },
    liveIteration: { type: Object, default: null },
    showAge: { type: Boolean, default: true },
  },
  emits: ['click', 'pause', 'resume', 'delete', 'schedule'],
  setup(props) {
    const store = useStore();
    const priority = computed(() => (props.goal.priority || 'medium').toLowerCase());
    const scheduleCount = computed(() => {
      const fn = store.getters['schedules/schedulesForGoal'];
      return fn ? fn(props.goal.id).length : 0;
    });

    const taskProgress = computed(() =>
      store.getters['goals/getGoalTaskProgress'](props.goal.id),
    );

    const displayTotal = computed(() =>
      taskProgress.value?.total ?? props.goal.task_count ?? 0,
    );
    const displayCompleted = computed(() =>
      taskProgress.value?.completed ?? props.goal.completed_tasks ?? 0,
    );
    const displayRunning = computed(() => taskProgress.value?.running ?? 0);

    // Weight running tasks at 0.5 so the bar moves as soon as a task starts
    // instead of snapping from 0% to (1/total)%.
    const displayProgress = computed(() => {
      const total = displayTotal.value;
      if (!total) return Math.round(props.goal.progress || 0);
      const completed = displayCompleted.value;
      const running = displayRunning.value;
      const weighted = (completed + 0.5 * running) / total * 100;
      // Fall back to server-reported progress if it's higher (trust upstream).
      return Math.min(100, Math.max(weighted, props.goal.progress || 0));
    });

    const runningTasks = computed(() => {
      const tasks = taskProgress.value?.tasks;
      if (!tasks) return [];
      return Object.values(tasks).filter((t) => t.status === 'running');
    });

    const runningTaskTitle = computed(() => runningTasks.value[0]?.title || '');
    const runningTaskCount = computed(() => runningTasks.value.length);

    const agingClass = computed(() => {
      if (TERMINAL_STATUSES.includes(props.goal.status)) return '';
      if (!props.goal.created_at) return '';
      const age = Date.now() - new Date(props.goal.created_at).getTime();
      if (age > AGING_THRESHOLDS.stale) return 'aged-stale';
      if (age > AGING_THRESHOLDS.danger) return 'aged-danger';
      if (age > AGING_THRESHOLDS.warning) return 'aged-warning';
      return '';
    });

    const getStatusIcon = (status) => ({
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
    }[status] || 'fas fa-circle');

    const formatStatus = (status) => {
      if (!status) return '';
      return status.replace(/_/g, ' ');
    };

    const timeAgo = (dateString) => {
      if (!dateString) return '';
      const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
      if (seconds < 0) return 'just now';
      if (seconds < 60) return 'just now';
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
      if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
      return `${Math.floor(seconds / 604800)}w ago`;
    };

    const formatDate = (dateString) => {
      if (!dateString) return '';
      try {
        return new Date(dateString).toLocaleString();
      } catch {
        return dateString;
      }
    };

    return {
      priority,
      scheduleCount,
      agingClass,
      displayTotal,
      displayCompleted,
      displayRunning,
      displayProgress,
      runningTaskTitle,
      runningTaskCount,
      getStatusIcon,
      formatStatus,
      timeAgo,
      formatDate,
    };
  },
};
</script>

<style scoped>
.goal-card {
  position: relative;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.goal-card:hover {
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.goal-card.selected {
  border-color: rgba(var(--green-rgb, 25, 239, 131), 0.55);
  box-shadow:
    0 0 0 1px rgba(var(--green-rgb, 25, 239, 131), 0.25),
    0 4px 20px rgba(var(--green-rgb, 25, 239, 131), 0.12);
}

.card-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.goal-id {
  font-size: 0.72em;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
}

.priority-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.priority-badge.urgent { color: var(--color-red); }
.priority-badge.high { color: var(--color-orange); }
.priority-badge.medium { color: var(--color-yellow); }
.priority-badge.low { color: var(--color-blue); }

.priority-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.priority-dot.urgent { background: var(--color-red); }
.priority-dot.high { background: var(--color-orange); }
.priority-dot.medium { background: var(--color-yellow); }
.priority-dot.low { background: var(--color-blue); }

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

.status-chip {
  align-self: flex-start;
  font-size: 0.68em;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
  letter-spacing: 0.3px;
}
.status-chip.executing { background: rgba(var(--green-rgb), 0.18); color: var(--color-green); }
.status-chip.completed,
.status-chip.validated { background: rgba(var(--green-rgb), 0.18); color: var(--color-green); }
.status-chip.failed,
.status-chip.error,
.status-chip.stopped { background: rgba(var(--red-rgb), 0.18); color: var(--color-red); }
.status-chip.paused { background: rgba(var(--yellow-rgb), 0.18); color: var(--color-yellow); }
.status-chip.needs_review { background: rgba(var(--orange-rgb), 0.18); color: var(--color-orange); }
.status-chip.planning { background: rgba(var(--violet-rgb), 0.18); color: var(--color-violet); }
.status-chip.queued { background: rgba(var(--indigo-rgb), 0.18); color: var(--color-indigo); }

.iteration-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--color-blue);
  background: rgba(var(--blue-rgb), 0.08);
  border: 1px solid rgba(var(--blue-rgb), 0.2);
  padding: 4px 8px;
  border-radius: 4px;
  font-family: var(--font-family-mono);
}

.iteration-phase {
  color: var(--color-text-muted);
  font-style: italic;
}

.iteration-score {
  margin-left: auto;
  font-weight: 600;
  color: var(--color-green);
}

.running-task {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.08);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  padding: 4px 8px;
  border-radius: 4px;
  font-family: var(--font-family-mono);
  overflow: hidden;
}

.running-task-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.running-task-more {
  color: var(--color-text-muted);
  font-weight: 600;
  flex-shrink: 0;
}

.task-running-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(var(--blue-rgb), 0.15);
  color: var(--color-blue);
  font-size: 0.85em;
  font-weight: 600;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.72em;
  color: var(--color-text-muted);
}

.progress-track {
  height: 4px;
  background: var(--color-darker-2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
  background: var(--color-green);
}
.progress-fill.executing { background: var(--color-green); }
.progress-fill.paused { background: var(--color-yellow); }
.progress-fill.completed,
.progress-fill.validated { background: var(--color-green); }
.progress-fill.failed,
.progress-fill.error,
.progress-fill.stopped { background: var(--color-red); }
.progress-fill.planning { background: var(--color-violet); }
.progress-fill.queued { background: var(--color-indigo); }
.progress-fill.needs_review { background: var(--color-orange); }

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}

.task-count,
.age-badge {
  font-size: 0.75em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.age-badge {
  margin-left: auto;
}

.card-actions {
  display: flex;
  gap: 2px;
}

.action-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  transition: all 0.2s;
  font-size: 0.85em;
}

.action-btn:hover {
  background: var(--color-darker-2);
  color: var(--color-text);
}

.pause-btn:hover { color: var(--color-yellow); }
.resume-btn:hover { color: var(--color-green); }
.delete-btn:hover { color: var(--color-red); }
.schedule-btn:hover { color: var(--color-primary); }
.schedule-btn.has-schedule { color: var(--color-primary); }
.schedule-btn.has-schedule::after {
  content: ''; position: absolute; width: 5px; height: 5px;
  background: var(--color-primary); border-radius: 50%;
  margin-top: -2px; margin-left: -2px;
}

/* Card aging — a subtle left-edge accent on non-terminal cards that have been idle */
.goal-card.aged-warning::before,
.goal-card.aged-danger::before,
.goal-card.aged-stale::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 0;
  width: 2px;
  background: rgba(var(--yellow-rgb), 0.55);
}
.goal-card.aged-danger::before { background: rgba(var(--red-rgb), 0.5); }
.goal-card.aged-stale::before { background: rgba(var(--red-rgb), 0.75); }
.goal-card.aged-stale { opacity: 0.85; }
</style>
