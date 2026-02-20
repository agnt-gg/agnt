<template>
  <div class="ui-panel dashboard-panel">
    <!-- Active Missions -->
    <div class="missions-section">
      <ActiveMissions :activeMissions="activeMissions" :selectedMissionId="missionId" @mission-selected="handleMissionSelected" />
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import ActiveMissions from '@/views/Terminal/CenterPanel/screens/Dashboard/components/ActiveMissions.vue';

export default defineComponent({
  name: 'DashboardPanel',
  components: {
    ActiveMissions,
  },
  props: {
    missionId: {
      type: [String, Number],
      default: null,
    },
    showChart: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const currentLeaderboardTab = ref('Daily');

    // Active Missions
    const activeMissions = computed(() => store.getters['missions/allActiveMissions'] || []);

    const handleMissionSelected = (missionId) => {
      emit('panel-action', 'mission-selected', missionId);
    };

    // Boost System
    const boostTimeRemaining = ref('2h 15m');
    const availableBoosts = ref([
      { id: 1, multiplier: '2x', duration: '1 hour', price: 100 },
      { id: 2, multiplier: '5x', duration: '30 min', price: 200 },
      { id: 3, multiplier: '10x', duration: '15 min', price: 300 },
    ]);

    // Login Streak
    const loginStreak = computed(() => store.getters['userStats/loginStreak'] || 0);

    // Leaderboard Data
    const leaderboardData = computed(() => store.getters['userStats/leaderboardData'] || []);

    const purchaseBoost = async (boost) => {
      try {
        const success = await store.dispatch('userStats/purchaseBoost', boost);
        if (success) {
          emit('panel-action', 'boost-purchased', boost);
        }
      } catch (error) {
        console.error('Failed to purchase boost:', error);
      }
    };

    // Set up periodic refresh for leaderboard with page visibility check
    let refreshInterval;
    let lastFetchTime = 0;

    const fetchDataIfNeeded = async () => {
      const now = Date.now();
      // Only fetch if page is visible and data is older than 30 seconds
      if (!document.hidden && now - lastFetchTime > 30000) {
        await store.dispatch('userStats/fetchLeaderboard', currentLeaderboardTab.value);
        lastFetchTime = now;
      }
    };

    onMounted(async () => {
      // Initial fetch
      await store.dispatch('userStats/fetchLeaderboard', currentLeaderboardTab.value);
      lastFetchTime = Date.now();

      // Set up interval with visibility check and longer interval
      refreshInterval = setInterval(fetchDataIfNeeded, 60000); // Every 60 seconds instead of 30
    });

    onUnmounted(() => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
    });

    return {
      activeMissions,
      handleMissionSelected,
      boostTimeRemaining,
      availableBoosts,
      purchaseBoost,
      loginStreak,
      leaderboardData,
      currentLeaderboardTab,
    };
  },
});
</script>

<style scoped>
.ui-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  height: 100%;
  position: relative;
  padding-right: 4px;
  z-index: 3;
  /* overflow-y: auto; */
  scrollbar-color: var(--color-duller-navy) transparent;
  scrollbar-width: thin;
}

.goal-input-section {
  background: rgba(var(--green-rgb), 0.2);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 8px;
  padding: 16px;
}

.section-title {
  color: var(--color-light-green);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
}

.section-title i {
  color: var(--color-green);
}

.goal-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.goal-input {
  width: 100%;
  min-height: 120px;
  padding: 16px;
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--color-light-green);
  font-family: inherit;
  font-size: 0.95em;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.goal-input:focus {
  outline: none;
  border-color: var(--color-green);
  box-shadow: 0 0 0 2px rgba(var(--green-rgb), 0.2);
}

.goal-input::placeholder {
  color: var(--color-grey);
  opacity: 0.7;
}

.goal-input-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-start;
}

.action-button {
  padding: 8px 16px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 4px;
  color: var(--color-light-green);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  font-size: 0.9em;
}

.action-button:hover {
  background: rgba(var(--green-rgb), 0.2);
}

.action-button.primary {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
}

.action-button.primary:hover {
  background: rgba(var(--green-rgb), 0.8);
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-button:disabled:hover {
  background: rgba(var(--green-rgb), 0.1);
}

.boost-section {
  /* background: rgba(var(--green-rgb), 0.05); */
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  padding: 16px;
  border-radius: 4px;
}

.boost-timer {
  color: var(--color-yellow);
  font-size: 0.9em;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.boost-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 8px;
}

.boost-card {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.boost-card:hover {
  background: rgba(var(--green-rgb), 0.2);
  transform: translateY(-2px);
}

.boost-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.boost-multiplier {
  color: var(--color-green);
  font-weight: bold;
  font-size: 1.2em;
}

.boost-duration {
  color: var(--color-grey-light);
  font-size: 0.9em;
}

.boost-price {
  margin-top: 8px;
  color: var(--color-yellow);
  font-weight: bold;
}

.bonus-tracker {
  /* background: rgba(var(--green-rgb), 0.05); */
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  padding: 16px;
  border-radius: 4px;
}

h4 {
  margin: 0 0 16px 0;
  color: var(--color-green);
  font-size: 1em;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
  padding-bottom: 8px;
}

.streak-display {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.streak-count {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-yellow);
}

.streak-progress {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

.day-marker {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  font-size: 0.8em;
}

.day-marker.active {
  background: var(--color-green);
  color: var(--color-dark-navy);
}

.leaderboard-section {
  /* background: rgba(var(--green-rgb), 0.05); */
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  padding: 16px;
  border-radius: 4px;
}

.leaderboard-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.leaderboard-tabs button {
  background: transparent;
  border: 1px solid var(--color-green);
  color: var(--color-green);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
}

.leaderboard-tabs button.active {
  background: var(--color-green);
  color: var(--color-dark-navy);
}

.leaderboard-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.leaderboard-item {
  display: flex;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
}

.leaderboard-item:last-child {
  border-bottom: none;
}

.leaderboard-item .rank {
  width: 32px;
  color: var(--color-grey-light);
}

.leaderboard-item .name {
  flex: 1;
  color: var(--color-white);
}

.leaderboard-item .score {
  color: var(--color-green);
  font-weight: bold;
}

.missions-section {
  background: rgb(0 0 0 / 10%);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 4px;
  padding: 0;
  /* margin-bottom: 16px; */
}

.missions-section :deep(.activity-feed) {
  border: none;
  margin: 0;
  background: transparent;
}
</style>
