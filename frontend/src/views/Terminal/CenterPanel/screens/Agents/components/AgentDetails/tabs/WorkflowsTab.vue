<template>
  <div class="tab-pane workflows">
    <h3 class="section-title"><i class="fas fa-sitemap"></i> Agent Workflows</h3>
    <div class="workflows-list">
      <!-- This will eventually list assigned workflows. -->
      <div class="empty-state">
        <i class="fas fa-sitemap"></i>
        <p>No workflows configured</p>
      </div>
    </div>
  </div>
</template>

<script setup>
// Props will be added here later when workflow data is available.
// For now, it's a static component.
</script>

<style scoped>
/* Scoped styles for the Workflows tab */
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.workflows-list {
  flex: 1;
  display: flex;
  flex-direction: column;
}

h3.section-title {
  /* color: var(--color-light-green); */
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
  margin-bottom: 0;
}

.section-title i {
  color: var(--color-green);
}

.empty-state {
  flex: 1; /* Make empty state fill the available space */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-grey);
  gap: 12px;
}

.empty-state i {
  font-size: 2em;
  opacity: 0.5;
}
</style>
