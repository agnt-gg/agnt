<template>
  <div class="goal-progress-widget" :class="statusClass">
    <div class="gpw-header">
      <div class="gpw-title-row">
        <span class="gpw-icon">{{ statusIcon }}</span>
        <span class="gpw-title">{{ goalTitle }}</span>
        <span class="gpw-status-badge" :class="statusClass">{{ statusLabel }}</span>
      </div>
      <div class="gpw-subtitle" v-if="goalId">
        Goal {{ goalId.substring(0, 8) }}
      </div>
    </div>

    <div class="gpw-body">
      <!-- Progress bar -->
      <div class="gpw-progress-section">
        <div class="gpw-progress-bar-container">
          <div class="gpw-progress-bar" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <div class="gpw-progress-stats">
          <span class="gpw-iteration" v-if="liveData">
            Iteration {{ liveData.iteration }}<span v-if="maxIterations">/{{ maxIterations }}</span>
          </span>
          <span class="gpw-phase" v-if="liveData">
            {{ phaseLabel }}
          </span>
        </div>
      </div>

      <!-- Score display -->
      <div class="gpw-scores" v-if="hasScores">
        <div class="gpw-score-item">
          <span class="gpw-score-label">Current</span>
          <span class="gpw-score-value" :class="scoreClass(currentScore)">{{ currentScore }}%</span>
        </div>
        <div class="gpw-score-item" v-if="bestScore > 0">
          <span class="gpw-score-label">Best</span>
          <span class="gpw-score-value gpw-best">{{ bestScore }}%</span>
        </div>
      </div>

      <!-- Iteration history sparkline -->
      <div class="gpw-history" v-if="iterationHistory.length > 1">
        <div class="gpw-history-label">Score History</div>
        <div class="gpw-sparkline">
          <div
            v-for="(entry, idx) in iterationHistory"
            :key="idx"
            class="gpw-spark-bar"
            :style="{ height: Math.max(entry.score, 5) + '%' }"
            :class="{ improved: entry.isImprovement, current: idx === iterationHistory.length - 1 }"
            :title="`#${entry.iteration}: ${entry.score}%`"
          ></div>
        </div>
      </div>

      <!-- Task count -->
      <div class="gpw-tasks" v-if="taskCount > 0">
        <span class="gpw-tasks-label">Tasks:</span>
        <span class="gpw-tasks-count">{{ taskCount }}</span>
      </div>
    </div>

    <!-- Completed / Error state -->
    <div class="gpw-footer" v-if="isTerminal">
      <div v-if="isCompleted" class="gpw-completed">
        Passed at iteration {{ completedIteration }} with {{ finalScore }}%
      </div>
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

    // Track iteration history locally (accumulates from WebSocket events)
    const iterationHistory = ref([]);
    const bestScore = ref(0);
    const completedIteration = ref(0);
    const finalScore = ref(0);
    const errorMessage = ref('');

    // Get live iteration data from goals store
    const liveData = computed(() => {
      return store.getters['goals/getLiveIteration']?.(props.goalId) || null;
    });

    // Get goal from store for status
    const goal = computed(() => {
      return store.getters['goals/getGoalById']?.(props.goalId) || null;
    });

    const currentScore = computed(() => {
      return liveData.value?.score || 0;
    });

    const hasScores = computed(() => {
      return currentScore.value > 0 || bestScore.value > 0;
    });

    const progressPercent = computed(() => {
      if (!liveData.value || !props.maxIterations) return 0;
      return Math.round((liveData.value.iteration / props.maxIterations) * 100);
    });

    const phaseLabel = computed(() => {
      const phase = liveData.value?.phase;
      const labels = {
        executing: 'Executing tasks...',
        evaluating: 'Evaluating results...',
        replanning: 'Replanning approach...',
        checkpointing: 'Checkpointing...',
        completed: 'Iteration complete',
      };
      return labels[phase] || phase || '';
    });

    const isCompleted = computed(() => {
      const status = goal.value?.status;
      const loopStatus = goal.value?.loop_status;
      return status === 'validated' || loopStatus === 'completed';
    });

    const isError = computed(() => {
      const loopStatus = goal.value?.loop_status;
      return loopStatus === 'error' || loopStatus === 'stuck' || loopStatus === 'max_iterations';
    });

    const isTerminal = computed(() => isCompleted.value || isError.value);

    const isRunning = computed(() => {
      return liveData.value && !isTerminal.value;
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

    // Watch for live iteration changes and build history
    watch(liveData, (newData, oldData) => {
      if (!newData) return;

      // When a new iteration ends, record it
      if (newData.phase === 'completed' && newData.score !== undefined) {
        const exists = iterationHistory.value.find(h => h.iteration === newData.iteration);
        if (!exists) {
          const isImprovement = newData.score > bestScore.value;
          iterationHistory.value.push({
            iteration: newData.iteration,
            score: Math.round(newData.score),
            isImprovement,
          });
          if (isImprovement) {
            bestScore.value = Math.round(newData.score);
          }
        }
      }

      // Track best score from replanning events
      if (newData.phase === 'replanning' && newData.score !== undefined) {
        const score = Math.round(newData.score);
        if (score > bestScore.value) {
          bestScore.value = score;
        }
      }
    }, { deep: true });

    // Watch for goal completion
    watch(goal, (newGoal) => {
      if (!newGoal) return;
      if (newGoal.status === 'validated' && newGoal.loop_status === 'completed') {
        finalScore.value = bestScore.value;
        completedIteration.value = liveData.value?.iteration || iterationHistory.value.length;
      }
      if (newGoal.loop_status === 'error' || newGoal.loop_status === 'stuck') {
        errorMessage.value = newGoal.loop_status === 'stuck'
          ? 'Stuck: identical replans detected'
          : 'Autonomous loop encountered an error';
      }
      if (newGoal.loop_status === 'max_iterations') {
        errorMessage.value = 'Max iterations reached';
      }
    }, { deep: true });

    // On mount, try to fetch goal if not in store
    onMounted(() => {
      if (!goal.value && props.goalId) {
        store.dispatch('goals/fetchGoals').catch(() => {});
      }
    });

    return {
      liveData,
      goal,
      currentScore,
      hasScores,
      bestScore,
      progressPercent,
      phaseLabel,
      isCompleted,
      isError,
      isTerminal,
      isRunning,
      statusClass,
      statusIcon,
      statusLabel,
      iterationHistory,
      completedIteration,
      finalScore,
      errorMessage,
      scoreClass,
    };
  },
};
</script>

<style scoped>
.goal-progress-widget {
  margin-top: 10px;
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

.gpw-score-good { color: #22c55e; }
.gpw-score-mid { color: #eab308; }
.gpw-score-low { color: #ef4444; }
.gpw-best { color: var(--color-accent, #00ff88); }

/* Sparkline */
.gpw-history {
  margin-top: 4px;
}

.gpw-history-label {
  font-size: 9px;
  color: var(--color-text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.gpw-sparkline {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 32px;
}

.gpw-spark-bar {
  flex: 1;
  min-width: 6px;
  max-width: 16px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px 2px 0 0;
  transition: height 0.3s ease;
}

.gpw-spark-bar.improved {
  background: var(--color-accent, #00ff88);
}

.gpw-spark-bar.current {
  background: var(--color-text-primary, #e0e0e0);
}

/* Tasks */
.gpw-tasks {
  font-size: 10px;
  color: var(--color-text-secondary, #888);
}

.gpw-tasks-count {
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
