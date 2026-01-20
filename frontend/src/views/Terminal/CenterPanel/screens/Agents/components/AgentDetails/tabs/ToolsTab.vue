<template>
  <div class="tab-pane tools">
    <h3 class="section-title"><i class="fas fa-tools"></i> Agent Tools</h3>
    <div v-if="selectedAgent.assignedTools && selectedAgent.assignedTools.length" class="tools-list">
      <div class="tools-grid">
        <div v-for="tool in selectedAgent.assignedTools" :key="tool" class="tool-card">
          <div class="tool-header">
            <i class="fas fa-tools"></i>
            <span>{{ tool }}</span>
          </div>
          <div class="tool-actions">
            <button class="tool-button execute" @click="emit('execute-tool', tool)"><i class="fas fa-play"></i> Execute</button>
            <button class="tool-button details" @click="emit('view-tool-details', tool)"><i class="fas fa-info-circle"></i> Details</button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty-state">
      <i class="fas fa-tools"></i>
      <p>No tools assigned to this agent.</p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  selectedAgent: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['execute-tool', 'view-tool-details']);
</script>

<style scoped>
/* Scoped styles from AgentDetails.vue for the Tools tab */
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

h3.section-title {
  /* color: var(--color-light-green); */
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
}

.section-title i {
  color: var(--color-green);
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  width: 100%;
}

.tool-card {
  background: rgba(25, 239, 131, 0.1);
  border-radius: 4px;
  padding: 12px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--color-light-green);
}

.tool-actions {
  display: flex;
  gap: 8px;
}

.tool-button {
  flex: 1;
  padding: 6px;
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  background: none;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 0.9em;
}

.tool-button:hover {
  background: rgba(25, 239, 131, 0.15);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: calc(100% - 64px);
  color: var(--color-grey);
  gap: 12px;
}

.empty-state i {
  font-size: 2em;
  opacity: 0.5;
}
</style>
