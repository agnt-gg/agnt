<template>
  <div class="dashboard-section active-tasks">
    <h3 class="section-title">CURRENT TASKS</h3>
    
    <div class="tasks-list">
      <div
        v-for="task in activeTasks"
        :key="task.id"
        class="task-card"
        :class="{ priority: task.priority }"
      >
        <div class="task-header">
          <span class="task-id">{{ task.id }}</span>
          <span class="task-impact">{{ task.impact }} impact</span>
        </div>
        <p class="task-description">{{ task.description }}</p>
        <div class="task-progress">
          <div class="progress-bar" :style="{ width: task.progress + '%' }"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from "vue";
import { useStore } from "vuex";

export default {
  name: "ActiveTasks",
  setup() {
    const store = useStore();

    const activeTasks = computed(() => {
      const activeGoals = store.getters["goals/activeGoals"] || [];
      return activeGoals.map((goal) => ({
        id: goal.id,
        description: goal.title || goal.description || "Unnamed Task",
        impact: goal.priority || "Medium",
        progress: store.getters["goals/getGoalProgress"](goal) || 0,
        priority: goal.priority === "high",
      }));
    });

    return {
      activeTasks,
    };
  },
};
</script>

<style scoped>
.dashboard-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-duller-navy);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: system-ui, -apple-system, sans-serif;
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-card {
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid var(--color-duller-navy);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.3s;
}

.task-card.priority {
  border-color: var(--color-yellow);
  background: rgba(255, 215, 0, 0.03);
}

.task-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.task-id {
  font-size: 0.75em;
  color: var(--color-blue);
  font-family: monospace;
}

.task-impact {
  font-size: 0.85em;
  color: var(--color-green);
  font-weight: 500;
}

.task-description {
  font-size: 0.85em;
  color: var(--color-bright-light-navy);
  margin-bottom: 12px;
  line-height: 1.5;
}

.task-progress {
  height: 3px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--color-green);
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.task-card.priority .progress-bar {
  background: var(--color-yellow);
}
</style>