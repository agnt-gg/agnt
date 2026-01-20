<template>
  <BaseDashboardCard title="ACTIVE WORKFLOWS" footer-text="Real-time workflow status">
    <div class="pipeline-stages">
      <div v-if="activeWorkflows.length === 0" class="no-workflows">
        <div class="empty-state">
          <i class="fas fa-cogs"></i>
          <p>No active workflows</p>
          <button class="create-link" @click="navigateToWorkflowForge"><i class="fas fa-plus"></i> Create Workflow</button>
        </div>
      </div>
      <div v-else class="workflows-list">
        <div v-for="workflow in activeWorkflows" :key="workflow.id" class="workflow-item">
          <div class="workflow-status" :class="workflow.status">
            <i :class="getStatusIcon(workflow.status)"></i>
          </div>
          <div class="workflow-name">{{ workflow.name || workflow.title || workflow.id }}</div>
          <div class="workflow-status-text" :class="workflow.status">{{ workflow.status.toUpperCase() }}</div>
        </div>
      </div>
    </div>
  </BaseDashboardCard>
</template>

<script>
import { computed, inject } from 'vue';
import { useStore } from 'vuex';
import BaseDashboardCard from './BaseDashboardCard.vue';

export default {
  name: 'WorkflowPipelines',
  components: {
    BaseDashboardCard,
  },
  props: {
    pipelineData: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['navigate'],
  setup(props, { emit }) {
    const store = useStore();

    const activeWorkflows = computed(() => {
      const allWorkflows = store.getters['workflows/allWorkflows'] || [];
      return allWorkflows.filter((w) => w.status === 'running' || w.status === 'listening' || w.status === 'error');
    });

    const getStatusIcon = (status) => {
      const icons = {
        running: 'fas fa-play',
        listening: 'fas fa-headphones',
        error: 'fas fa-exclamation-triangle',
        completed: 'fas fa-check',
        stopped: 'fas fa-stop',
        queued: 'fas fa-clock',
      };
      return icons[status] || 'fas fa-cog';
    };

    const navigateToWorkflowForge = () => {
      emit('navigate', 'WorkflowForgeScreen');
    };

    return {
      activeWorkflows,
      getStatusIcon,
      navigateToWorkflowForge,
    };
  },
};
</script>

<style scoped>
.pipeline-stages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 306px;
  overflow-y: auto;
}

.no-workflows {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  text-align: center;
  color: var(--color-text-muted);
  /* opacity: 0.7; */
}

.empty-state i {
  font-size: 2em;
  margin-bottom: 4px;
  display: block;
}

.empty-state p {
  margin: 0 0 12px 0;
  font-size: 0.9em;
}

.create-link {
  background: var(--color-primary);
  color: var(--color-white);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.2s ease;
}

.create-link:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
}

.create-link i {
  /* margin-right: 4px; */
  font-size: 0.9em;
}

.workflows-list {
  display: flex;
  flex-direction: column;
  gap: 2.75px;
}

.workflow-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-radius: 4px;
  transition: all 0.2s ease;
  /* cursor: pointer; */
}

/* .workflow-item:hover {
  background: var(--color-darker-1);
} */

.workflow-status {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}

.workflow-status.running {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.workflow-status.listening {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.workflow-status.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.workflow-status i {
  font-size: 0.7em;
}

.workflow-name {
  flex: 1;
  color: var(--color-text);
  font-size: 0.8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-status-text {
  font-size: 0.75em;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.workflow-status-text.running {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.workflow-status-text.listening {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.workflow-status-text.error {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}
</style>
