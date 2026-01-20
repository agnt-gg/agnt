<template>
  <div class="tab-pane overview">
    <h3 class="section-title"><i class="fas fa-chart-bar"></i> Agent Overview</h3>
    <div class="overview-display">
      <div class="overview-header">
        <div class="agent-profile">
          <img
            :src="
              selectedAgent.avatar ||
              'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5RUY4MyIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMiAxMmMyLjIxIDAgNC0xLjc5IDQtNHMtMS43OS00LTQtNC00IDEuNzktNCA0IDEuNzkgNCA0IDR6bTAgMmMtMi42NyAwLTggMS4zNC04IDR2MmgxNnYtMmMwLTIuNjYtNS4zMy00LTgtNHoiLz48L3N2Zz4='
            "
            alt="Agent profile"
            class="agent-overview-avatar"
          />
          <h3 class="agent-name-display">{{ selectedAgent.name }}</h3>
        </div>
      </div>
      <p class="agent-description-display">
        {{ selectedAgent.description || 'No description provided.' }}
      </p>
      <hr class="divider" />
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">Status</span>
          <span class="stat-value">{{ selectedAgent.status }}</span>
        </div>
        <!-- <div class="stat-item">
          <span class="stat-label">Uptime</span>
          <span class="stat-value">{{ formatUptime(selectedAgent.uptime) }}</span>
        </div> -->
      </div>
      <hr class="divider" />
      <div class="quick-actions">
        <button class="action-button" @click="emit('toggle-agent', selectedAgent)">
          <i :class="selectedAgent.status === 'ACTIVE' ? 'fas fa-stop' : 'fas fa-play'"></i>
          {{ selectedAgent.status === 'ACTIVE' ? 'Stop' : 'Start' }}
        </button>
        <button class="action-button"><i class="fas fa-sync"></i> Restart</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  selectedAgent: {
    type: Object,
    required: true,
  },
  formatUptime: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits(['toggle-agent']);
</script>

<style scoped>
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
  margin: 0;
  border-bottom: 1px solid rgba(25, 239, 131, 0.2);
}

.section-title i {
  color: var(--color-green);
}

.overview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.agent-profile {
  display: flex;
  align-items: center;
  gap: 15px;
}

.agent-overview-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(25, 239, 131, 0.1);
  padding: 2px;
  border: 3px solid rgba(25, 239, 131, 0.5);
}

.agent-name-display {
  color: var(--color-white);
  font-size: 1.2em;
  margin: 0;
}

.agent-description-display {
  color: var(--color-white);
  margin-bottom: 15px;
  line-height: 1.5;
}

.divider {
  border: none;
  border-top: 1px dashed rgba(25, 239, 131, 0.2);
  margin: 15px 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
  width: 100%;
}

.stat-item {
  background: rgba(25, 239, 131, 0.1);
  padding: 12px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  color: var(--color-grey);
  font-size: 0.9em;
}

.stat-value {
  color: var(--color-light-green);
  font-size: 1.1em;
}

.quick-actions {
  display: flex;
  gap: 10px;
}

.action-button {
  padding: 8px 16px;
  background: rgba(25, 239, 131, 0.1);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 4px;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.action-button:hover {
  background: rgba(25, 239, 131, 0.2);
}
</style>
