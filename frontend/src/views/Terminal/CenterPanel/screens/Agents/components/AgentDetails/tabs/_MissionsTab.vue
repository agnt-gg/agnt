<template>
  <div class="tab-pane missions">
    <div class="missions-section">
      <!-- Active Missions -->
      <div class="missions-group">
        <h4 class="section-title">
          <i class="fas fa-play"></i> Active Missions
        </h4>
        <div class="missions-list" v-if="agentMissions.active && agentMissions.active.length">
          <div
            v-for="mission in agentMissions.active"
            :key="mission.id"
            class="mission-card"
          >
            <div class="mission-header">
              <span class="mission-title">{{ mission.title }}</span>
              <span class="mission-status">{{ mission.status }}</span>
            </div>
            <div class="mission-description">{{ mission.description }}</div>
            <div class="mission-rewards">
              <span class="reward-item">
                <i class="fas fa-star"></i>
                {{ mission.rewards.xp }} XP
              </span>
              <span class="reward-item">
                <i class="fas fa-coins"></i>
                {{ mission.rewards.tokens }} Tokens
              </span>
            </div>
            <div class="mission-progress" v-if="mission.objectives">
              <div class="progress-bar">
                <div
                  class="progress-fill"
                  :style="{
                    width: `${
                      (mission.objectives.filter((o) => o.completed)
                        .length /
                        mission.objectives.length) *
                      100
                    }%`,
                  }"
                ></div>
              </div>
              <span class="progress-text">
                {{ mission.objectives.filter((o) => o.completed).length }}/{{
                  mission.objectives.length
                }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <i class="fas fa-flag"></i>
          <p>No active missions</p>
        </div>
      </div>

      <!-- Completed Missions -->
      <div class="missions-group">
        <h4 class="section-title">
          <i class="fas fa-check"></i> Completed Missions
        </h4>
        <div class="missions-list" v-if="agentMissions.completed && agentMissions.completed.length">
          <div
            v-for="mission in agentMissions.completed"
            :key="mission.id"
            class="mission-card completed"
          >
            <div class="mission-header">
              <span class="mission-title">{{ mission.title }}</span>
              <span class="mission-status">Completed</span>
            </div>
            <div class="mission-description">{{ mission.description }}</div>
            <div class="mission-rewards">
              <span class="reward-item">
                <i class="fas fa-star"></i>
                {{ mission.rewards.xp }} XP
              </span>
              <span class="reward-item">
                <i class="fas fa-coins"></i>
                {{ mission.rewards.tokens }} Tokens
              </span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <i class="fas fa-check"></i>
          <p>No completed missions</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  agentMissions: {
    type: Object,
    required: true,
  },
});
</script>

<style scoped>
/* Scoped styles from AgentDetails.vue for the Missions tab */
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

h4.section-title {
  color: var(--color-light-green);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
}

.section-title i {
  color: var(--color-green);
}

.missions-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.missions-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.missions-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.mission-card {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mission-card.completed {
  opacity: 0.7;
}

.mission-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mission-title {
  color: var(--color-light-green);
  font-weight: bold;
}

.mission-status {
  color: var(--color-grey);
  font-size: 0.9em;
}

.mission-description {
  color: var(--color-grey);
  font-size: 0.9em;
  line-height: 1.4;
}

.mission-rewards {
  display: flex;
  gap: 12px;
}

.reward-item {
  color: var(--color-light-green);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mission-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
}

.progress-text {
  color: var(--color-grey);
  font-size: 0.9em;
  min-width: 40px;
  text-align: right;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--color-grey);
  gap: 8px;
  background: rgba(var(--green-rgb), 0.05);
  border-radius: 4px;
}

.empty-state i {
  font-size: 1.5em;
  opacity: 0.5;
}

.empty-state p {
  font-size: 0.9em;
}
</style> 