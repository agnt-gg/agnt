<template>
  <div class="mission-panel">
    <div v-if="selectedMission" class="mission-details">
      <div class="mission-header">
        <h2 class="mission-title">{{ selectedMission.title }}</h2>
        <div class="mission-status" :class="{ 'locked-status': selectedMission.status === 'Locked' }">
          [{{ selectedMission.status }}]
        </div>
      </div>

      <div class="mission-description" :class="{ 'locked-description': selectedMission.status === 'Locked' }">
        {{ selectedMission.description }}
      </div>

      <div class="mission-rewards" :class="{ 'locked-rewards': selectedMission.status === 'Locked' }">
        <h3>Rewards</h3>
        <div class="rewards-container">
          <div class="reward-item">
            <span class="reward-label">XP:</span>
            <span class="reward-value xp">{{ selectedMission.rewards.xp }}</span>
          </div>
          <div class="reward-item">
            <span class="reward-label">Tokens:</span>
            <span class="reward-value tokens">{{ selectedMission.rewards.tokens }}</span>
          </div>
        </div>
      </div>

      <div class="mission-objectives" v-if="selectedMission.objectives?.length">
        <h3>Objectives</h3>
        <div class="objectives-list">
          <div 
            v-for="objective in selectedMission.objectives" 
            :key="objective.id"
            class="objective-item"
            :class="{ 'completed': objective.completed }"
          >
            <span class="objective-status">{{ objective.completed ? '✓' : '○' }}</span>
            <span class="objective-label">{{ objective.label }}</span>
          </div>
        </div>
      </div>

      <!-- Agent Assignment Section -->
      <div class="mission-assignment" v-if="isMissionAssignable">
        <h3>Assign Agents</h3>
        <div class="agent-list">
          <div v-if="!allAgents || allAgents.length === 0" class="no-agents">
            No agents available.
          </div>
          <div 
            v-for="agent in allAgents" 
            :key="agent.id" 
            class="agent-item"
          >
            <span class="agent-name">
              <i class="fas fa-robot"></i> {{ agent.name }}
            </span>
            <BaseButton 
              v-if="!isAgentAssigned(agent.id)"
              size="small" 
              variant="success"
              @click="assignAgent(agent.id)"
              class="assign-button"
            >
              <i class="fas fa-plus"></i> Assign
            </BaseButton>
            <BaseButton 
              v-else
              size="small" 
              variant="danger"
              @click="unassignAgent(agent.id)"
              class="unassign-button"
            >
              <i class="fas fa-times"></i> Unassign
            </BaseButton>
          </div>
        </div>
      </div>

      <div class="mission-actions">
        <BaseButton 
          v-if="selectedMission.status === 'New'"
          class="action-button accept icon"
          @click="handleAcceptMission"
        >
          Accept Mission 📋
        </BaseButton>
      </div>
    </div>
    <div v-else class="no-mission-selected">
      Select a mission to view details
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '../../../shared/BaseButton.vue';

export default {
  name: "MissionsPanel",
  components: { BaseButton },
  props: {
    selectedMissionId: {
      type: String,
      default: null
    },
    allAgents: { // Should receive agents from parent (Missions.vue)
      type: Array,
      default: () => []
    }
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    // Log received agents prop for debugging
    console.log('[MissionsPanel] Received allAgents prop:', props.allAgents); 

    const selectedMission = computed(() => 
      props.selectedMissionId ? store.getters['missions/getMissionById'](props.selectedMissionId) : null
    );

    // Get agents currently assigned to this specific mission
    const assignedAgentIds = computed(() => {
      if (!selectedMission.value) return [];
      return store.getters['missionAssignments/getAgentsByMission'](selectedMission.value.id);
    });

    // Check if a specific agent is assigned to the current mission
    const isAgentAssigned = (agentId) => {
      return assignedAgentIds.value.includes(agentId);
    };

    // Determine if the mission is in a state where it can be assigned/unassigned
    const isMissionAssignable = computed(() => {
      return selectedMission.value && ['New', 'Active', 'Available'].includes(selectedMission.value.status);
      // Add more conditions if needed (e.g., based on mission type)
    });

    const assignAgent = (agentId) => {
      if (selectedMission.value) {
        console.log(`Assigning mission ${selectedMission.value.id} to agent ${agentId}`);
        store.dispatch('missionAssignments/assignMission', { 
          missionId: selectedMission.value.id, 
          agentId: agentId 
        });
         emit('panel-action', 'agent-assigned', { missionId: selectedMission.value.id, agentId }); // Optional feedback
      }
    };

    const unassignAgent = (agentId) => {
       if (selectedMission.value) {
        console.log(`Unassigning mission ${selectedMission.value.id} from agent ${agentId}`);
        store.dispatch('missionAssignments/unassignMission', { 
          missionId: selectedMission.value.id, 
          agentId: agentId 
        });
        emit('panel-action', 'agent-unassigned', { missionId: selectedMission.value.id, agentId }); // Optional feedback
      }
    };

    const handleAcceptMission = () => {
      if (selectedMission.value) {
        // Move mission from available to active (if needed)
        store.dispatch('missions/acceptMission', selectedMission.value.id);
        emit('panel-action', 'mission-accepted', selectedMission.value.id);
      }
    };

    return {
      selectedMission,
      assignedAgentIds,
      isAgentAssigned,
      isMissionAssignable,
      assignAgent,
      unassignAgent,
      handleAcceptMission
    };
  }
};
</script>

<style scoped>
.mission-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mission-details {
  border-radius: 8px;
  padding: 15px;
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.3);
}

.mission-header {
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

.mission-title {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0 0 5px 0;
}

.mission-status {
  font-size: 0.9em;
  color: var(--color-grey);
  display: flex;
  align-items: center;
  gap: 6px;
}

.mission-description {
  margin-bottom: 18px;
  line-height: 1.4;
  color: var(--color-white);
}

.mission-rewards {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

h3 {
  color: var(--color-grey);
  font-size: 0.9em;
  margin-bottom: -4px;
}

.rewards-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reward-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.reward-label {
  color: var(--color-grey);
}

.reward-value.xp {
  color: var(--color-blue);
  font-weight: bold;
}

.reward-value.tokens {
  color: var(--color-yellow);
  font-weight: bold;
}

.mission-objectives {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.objectives-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.objective-item {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--color-light-green);
}

.objective-status {
  color: var(--color-grey);
  width: 14px;
  text-align: center;
}

.objective-item.completed {
  color: var(--color-grey);
}

.objective-item.completed .objective-status {
  color: var(--color-light-green);
}

.mission-assignment {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  max-height: 200px; /* Limit height if many agents */
  overflow-y: auto;
  padding-right: 5px; /* Space for scrollbar */
    scrollbar-width: thin;
  scrollbar-color: var(--color-green) var(--color-dark-navy);
}
.agent-list::-webkit-scrollbar {
  width: 6px;
}
.agent-list::-webkit-scrollbar-track {
  background: rgba(var(--green-rgb), 0.05);
}
.agent-list::-webkit-scrollbar-thumb {
  background-color: var(--color-green);
  border-radius: 3px;
}

.agent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: rgba(var(--green-rgb), 0.05);
  border-radius: 4px;
}

.agent-name {
  color: var(--color-light-green);
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-name i {
  color: var(--color-grey);
}

.assign-button i, .unassign-button i {
  margin-right: 4px;
  font-size: 0.8em;
}

.no-agents {
  color: var(--color-grey);
  font-style: italic;
}

.mission-actions {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.action-button {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
  padding: 10px 12px;
  border-radius: 4px;
  width: 100%;
  font-size: 1em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: var(--color-green);
}

.action-button:focus {
  outline: none;
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.15);
}

.no-mission-selected {
  color: var(--color-grey);
  text-align: center;
  padding: 30px 15px;
  border: 1px dashed rgba(var(--green-rgb), 0.2);
  border-radius: 4px;
  font-style: italic;
}

.locked-status {
  color: var(--color-red) !important;
}

.locked-description {
  opacity: 0.7;
  font-style: italic;
}

.locked-rewards {
  opacity: 0.7;
}
</style>
