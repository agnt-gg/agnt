<template>
  <div class="tab-pane resources">
    <h3 class="section-title"><i class="fas fa-database"></i> Agent Resources</h3>
    <div class="resources-grid">
      <div class="resource-item">
        <span class="resource-label">Memory</span>
        <span class="resource-value">0 MB</span>
      </div>
      <div class="resource-item">
        <span class="resource-label">CPU Usage</span>
        <span class="resource-value">0%</span>
      </div>
      <div class="resource-item">
        <span class="resource-label">Storage</span>
        <span class="resource-value">0 MB</span>
      </div>
    </div>
  </div>
</template>

<script setup>
// This component is currently static.
// It can be updated later to accept props for dynamic resource data.
</script>

<style scoped>
/* Styles copied from AgentDetails.vue */
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
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
}

.section-title i {
  color: var(--color-green);
}

.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  width: 100%;
}

.resource-item {
  background: rgba(var(--green-rgb), 0.1);
  padding: 12px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resource-label {
  color: var(--color-grey);
  font-size: 0.9em;
}

.resource-value {
  color: var(--color-light-green);
  font-size: 1.1em;
}
</style>
