<template>
  <div class="goal-progress-widget" :class="statusClass">
    <div class="gpw-header">
      <div class="gpw-title-row">
        <span class="gpw-icon">{{ statusIcon }}</span>
        <span class="gpw-title">{{ goalTitle }}</span>
        <span class="gpw-status-badge" :class="statusClass">{{ statusLabel }}</span>
      </div>
      <div class="gpw-subtitle" v-if="goalId">Goal {{ goalId.substring(0, 8) }}</div>
    </div>

    <div class="gpw-body">
      <!-- Task progress bar -->
      <div class="gpw-progress-section">
        <div class="gpw-progress-bar-container">
          <div class="gpw-progress-bar" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <div class="gpw-progress-stats">
          <span class="gpw-task-count">{{ completedTaskCount }}/{{ totalTaskCount }} tasks</span>
          <span class="gpw-phase" v-if="currentPhase">{{ currentPhase }}</span>
        </div>
      </div>

      <!-- Task list -->
      <div class="gpw-task-list" v-if="taskEntries.length > 0">
        <div v-for="task in taskEntries" :key="task.id" class="gpw-task-item" :class="task.status">
          <span class="gpw-task-indicator">
            <span v-if="task.status === 'completed'" class="gpw-check">&#10003;</span>
            <span v-else-if="task.status === 'running'" class="gpw-spinner"></span>
            <span v-else-if="task.status === 'failed'" class="gpw-x">&#10005;</span>
            <span v-else class="gpw-dot"></span>
          </span>
          <span class="gpw-task-title">{{ task.title }}</span>
          <span class="gpw-task-agent" v-if="task.agentName">{{ task.agentName }}</span>
        </div>
      </div>

      <!-- Score display (shows after evaluation) -->
      <div class="gpw-scores" v-if="hasScores">
        <div class="gpw-score-item">
          <span class="gpw-score-label">Score</span>
          <span class="gpw-score-value" :class="scoreClass(currentScore)">{{ currentScore }}%</span>
        </div>
        <div class="gpw-score-item" v-if="bestScore > 0 && bestScore !== currentScore">
          <span class="gpw-score-label">Best</span>
          <span class="gpw-score-value gpw-best">{{ bestScore }}%</span>
        </div>
      </div>

      <!-- Iteration info (compact, secondary) -->
      <div class="gpw-iteration-info" v-if="liveData && liveData.iteration > 1">
        <span class="gpw-iteration-label"
          >Iteration {{ liveData.iteration }}<span v-if="maxIterations">/{{ maxIterations }}</span></span
        >
      </div>
    </div>

    <!-- Completed / Error state -->
    <div class="gpw-footer" v-if="isTerminal">
      <div v-if="isCompleted" class="gpw-completed">Completed — {{ finalScore }}% score</div>
      <div v-else-if="isError" class="gpw-error">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<script>
import { computed, ref, watch, onMounted } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'GoalProgressWidget',
  props: {
    goalId: {
      type: String,
      required: true,
    },
    goalTitle: {
      type: String,
      default: 'Autonomous Goal',
    },
    taskCount: {
      type: Number,
      default: 0,
    },
    maxIterations: {
      type: Number,
      default: 20,
    },
  },
  setup(props) {
    const store = useStore();

    const bestScore = ref(0);
    const errorMessage = ref('');

    // Get live iteration data from goals store
    const liveData = computed(() => {
      return store.getters['goals/getLiveIteration']?.(props.goalId) || null;
    });

    // Get goal from store for status
    const goal = computed(() => {
      return store.getters['goals/getGoalById']?.(props.goalId) || null;
    });

    // Get task progress from store (updated in real-time via WebSocket)
    const taskProgress = computed(() => {
      return store.getters['goals/getGoalTaskProgress']?.(props.goalId) || null;
    });

    // Task-based progress
    const totalTaskCount = computed(() => {
      return taskProgress.value?.total || props.taskCount || 0;
    });

    const completedTaskCount = computed(() => {
      return taskProgress.value?.completed || 0;
    });

    const progressPercent = computed(() => {
      if (totalTaskCount.value === 0) return 0;
      return Math.round((completedTaskCount.value / totalTaskCount.value) * 100);
    });

    // Task entries for the live task list
    const taskEntries = computed(() => {
      if (!taskProgress.value?.tasks) return [];
      return Object.entries(taskProgress.value.tasks).map(([id, t]) => ({
        id,
        title: t.title,
        status: t.status,
        agentName: t.agentName,
      }));
    });

    // Current phase label based on task state
    const currentPhase = computed(() => {
      const tp = taskProgress.value;
      if (tp && tp.running > 0) return `${tp.running} running...`;
      if (tp && tp.failed > 0 && tp.completed < tp.total) return `${tp.failed} failed`;

      // Fall back to iteration phase for evaluation/replanning
      const phase = liveData.value?.phase;
      if (phase === 'evaluating') return 'Evaluating...';
      if (phase === 'replanning') return 'Replanning...';
      return '';
    });

    // Score from evaluation stored on the goal object (survives navigation)
    const evaluationScore = computed(() => {
      return goal.value?.evaluation?.scores?.overall || 0;
    });

    const currentScore = computed(() => {
      return liveData.value?.score || evaluationScore.value || 0;
    });

    // Final score: best available from any source
    const finalScore = computed(() => {
      return Math.max(bestScore.value, currentScore.value, evaluationScore.value);
    });

    const hasScores = computed(() => {
      return finalScore.value > 0;
    });

    const isCompleted = computed(() => {
      const status = goal.value?.status;
      const loopStatus = goal.value?.loop_status;
      return status === 'validated' || status === 'completed' || loopStatus === 'completed';
    });

    const isError = computed(() => {
      const loopStatus = goal.value?.loop_status;
      return loopStatus === 'error' || loopStatus === 'stuck' || loopStatus === 'max_iterations';
    });

    const isTerminal = computed(() => isCompleted.value || isError.value);

    const isRunning = computed(() => {
      if (isTerminal.value) return false;
      // Running if: tasks are running, or we have live iteration data, or goal status says executing
      return taskProgress.value?.running > 0 || !!liveData.value || goal.value?.status === 'executing';
    });

    const statusClass = computed(() => {
      if (isCompleted.value) return 'completed';
      if (isError.value) return 'error';
      if (isRunning.value) return 'running';
      return 'pending';
    });

    const statusIcon = computed(() => {
      if (isCompleted.value) return '\u2705';
      if (isError.value) return '\u274C';
      if (isRunning.value) return '\u26A1';
      return '\u23F3';
    });

    const statusLabel = computed(() => {
      if (isCompleted.value) return 'PASSED';
      if (isError.value) return goal.value?.loop_status?.toUpperCase() || 'ERROR';
      if (isRunning.value) return 'RUNNING';
      return 'STARTING';
    });

    const scoreClass = (score) => {
      if (score >= 70) return 'gpw-score-good';
      if (score >= 40) return 'gpw-score-mid';
      return 'gpw-score-low';
    };

    // On mount, fetch current task status from API so the widget
    // renders correctly even when navigating back to a chat mid-goal
    onMounted(() => {
      if (props.goalId) {
        store.dispatch('goals/fetchGoalTaskProgress', props.goalId).catch(() => {});
      }
      if (props.taskCount > 0 && props.goalId) {
        store.commit('goals/INIT_GOAL_TASK_COUNT', { goalId: props.goalId, total: props.taskCount });
      }
      if (!goal.value && props.goalId) {
        store.dispatch('goals/fetchGoals').catch(() => {});
      }
    });

    // Track scores from live iteration data
    watch(
      liveData,
      (newData) => {
        if (!newData) return;
        if (newData.score !== undefined) {
          const score = Math.round(newData.score);
          if (score > bestScore.value) {
            bestScore.value = score;
          }
        }
      },
      { deep: true },
    );

    // Watch for goal error states
    watch(
      goal,
      (newGoal) => {
        if (!newGoal) return;
        if (newGoal.loop_status === 'error' || newGoal.loop_status === 'stuck') {
          errorMessage.value = newGoal.loop_status === 'stuck' ? 'Stuck: identical replans detected' : 'Autonomous loop encountered an error';
        }
        if (newGoal.loop_status === 'max_iterations') {
          errorMessage.value = 'Max iterations reached';
        }
      },
      { deep: true },
    );

    return {
      liveData,
      goal,
      taskProgress,
      totalTaskCount,
      completedTaskCount,
      progressPercent,
      taskEntries,
      currentPhase,
      currentScore,
      hasScores,
      bestScore,
      finalScore,
      errorMessage,
      isCompleted,
      isError,
      isTerminal,
      isRunning,
      statusClass,
      statusIcon,
      statusLabel,
      scoreClass,
    };
  },
};
</script>

<style scoped>
.goal-progress-widget {
  margin: 1px 8px 8px;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--color-bg-secondary, rgba(0, 0, 0, 0.3));
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 12px;
  max-width: 420px;
}

.goal-progress-widget.running {
  border-color: var(--color-accent, #00ff88);
  box-shadow: 0 0 8px rgba(0, 255, 136, 0.1);
}

.goal-progress-widget.completed {
  border-color: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.15);
}

.goal-progress-widget.error {
  border-color: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.1);
}

.gpw-header {
  margin-bottom: 10px;
}

.gpw-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.gpw-icon {
  font-size: 14px;
}

.gpw-title {
  font-weight: 600;
  color: var(--color-text-primary, #e0e0e0);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gpw-status-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.gpw-status-badge.running {
  background: rgba(0, 255, 136, 0.15);
  color: #00ff88;
}

.gpw-status-badge.completed {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.gpw-status-badge.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.gpw-status-badge.pending {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary, #999);
}

.gpw-subtitle {
  font-size: 10px;
  color: var(--color-text-secondary, #888);
  margin-top: 2px;
}

.gpw-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Progress bar */
.gpw-progress-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gpw-progress-bar-container {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.gpw-progress-bar {
  height: 100%;
  background: var(--color-accent, #00ff88);
  border-radius: 2px;
  transition: width 0.5s ease;
}

.goal-progress-widget.completed .gpw-progress-bar {
  background: #22c55e;
}

.goal-progress-widget.error .gpw-progress-bar {
  background: #ef4444;
}

.gpw-progress-stats {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--color-text-secondary, #888);
}

.gpw-phase {
  font-style: italic;
}

/* Task list */
.gpw-task-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gpw-task-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-secondary, #888);
  padding: 2px 0;
}

.gpw-task-item.completed {
  color: var(--color-text-primary, #e0e0e0);
}

.gpw-task-item.running {
  color: var(--color-accent, #00ff88);
}

.gpw-task-item.failed {
  color: #ef4444;
}

.gpw-task-indicator {
  width: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gpw-check {
  color: #22c55e;
  font-size: 12px;
  font-weight: 700;
}

.gpw-x {
  color: #ef4444;
  font-size: 12px;
  font-weight: 700;
}

.gpw-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}

.gpw-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(0, 255, 136, 0.3);
  border-top-color: var(--color-accent, #00ff88);
  border-radius: 50%;
  animation: gpw-spin 0.8s linear infinite;
}

@keyframes gpw-spin {
  to {
    transform: rotate(360deg);
  }
}

.gpw-task-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gpw-task-agent {
  font-size: 9px;
  color: var(--color-text-secondary, #666);
  flex-shrink: 0;
}

/* Scores */
.gpw-scores {
  display: flex;
  gap: 16px;
}

.gpw-score-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gpw-score-label {
  font-size: 9px;
  color: var(--color-text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.gpw-score-value {
  font-size: 18px;
  font-weight: 700;
}

.gpw-score-good {
  color: #22c55e;
}
.gpw-score-mid {
  color: #eab308;
}
.gpw-score-low {
  color: #ef4444;
}
.gpw-best {
  color: var(--color-accent, #00ff88);
}

/* Iteration info (compact secondary) */
.gpw-iteration-info {
  font-size: 9px;
  color: var(--color-text-secondary, #666);
}

.gpw-iteration-label {
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.gpw-task-count {
  font-weight: 600;
  color: var(--color-text-primary, #e0e0e0);
}

/* Footer */
.gpw-footer {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.gpw-completed {
  color: #22c55e;
  font-weight: 600;
  font-size: 11px;
}

.gpw-error {
  color: #ef4444;
  font-size: 11px;
}
</style>
