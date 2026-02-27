<template>
  <div class="dashboard-section workflow-list-section">
    <h3 class="section-title">ACTIVE WORKFLOWS</h3>

    <div class="workflow-list">
      <div
        v-for="template in workflowTemplates"
        :key="template.id"
        class="workflow-row"
        :class="[template.status.toLowerCase(), { premium: template.premium }]"
        @click="!template.premium && editWorkflow(template)"
      >
        <div class="workflow-info">
          <div class="workflow-name-group">
            <span class="workflow-icon">{{ template.icon }}</span>
            <span class="workflow-name">{{ template.name }}</span>
          </div>
          <span class="workflow-status">{{ template.status }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'ActiveWorkflows',
  emits: ['edit-workflow'],
  setup(props, { emit }) {
    const store = useStore();

    const workflowTemplates = computed(() => {
      const activeWorkflows = store.getters['workflows/activeWorkflows'] || [];
      return activeWorkflows.map((wf) => ({
        id: wf.id,
        icon: '◈',
        name: wf.name || 'Unnamed Workflow',
        status: wf.status || 'N/A',
        premium: false,
      }));
    });

    const editWorkflow = (template) => {
      emit('edit-workflow', { workflowId: template.id });
    };

    return {
      workflowTemplates,
      editWorkflow,
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
  color: var(--color-text-muted);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: var(--font-family-primary);
}

.workflow-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workflow-row {
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid var(--color-duller-navy);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
}

.workflow-row:hover:not(.premium) {
  background: rgba(127, 129, 147, 0.1);
  border-color: var(--color-text-muted);
}

.workflow-row.running {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}

.workflow-row.listening {
  border-color: var(--color-blue);
  background: rgba(var(--blue-rgb), 0.05);
}

.workflow-row.error {
  border-color: var(--color-red);
  background: rgba(var(--red-rgb), 0.05);
}

.workflow-row.running .workflow-status,
.workflow-row.running .workflow-icon {
  color: var(--color-green);
}

.workflow-row.listening .workflow-status,
.workflow-row.listening .workflow-icon {
  color: var(--color-blue);
}

.workflow-row.error .workflow-status,
.workflow-row.error .workflow-icon {
  color: var(--color-red);
}

.workflow-row.premium {
  opacity: 0.5;
  cursor: not-allowed;
}

.workflow-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.workflow-name-group {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  line-height: normal;
}

.workflow-icon {
  font-size: 1.1em;
  color: var(--color-blue);
  line-height: 1;
}

.workflow-name {
  font-size: 0.85em;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workflow-status {
  font-size: 0.8em;
  font-weight: 500;
  color: var(--color-white);
  text-transform: capitalize;
  flex-shrink: 0;
  margin-left: 8px;
}
</style>
