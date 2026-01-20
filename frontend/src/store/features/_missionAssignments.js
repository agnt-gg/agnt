// missionAssignments.js - Handles the many-to-many relationship between missions and agents
export default {
  namespaced: true,
  state: {
    // Structure: { missionId: [agentId1, agentId2, ...] }
    assignments: {
      'mission-1': ['agent-1', 'agent-2'],
      'mission-2': ['agent-1'],
      'mission-3': [],
      'mission-4': [],
      'mission-5': []
    }
  },
  mutations: {
    ASSIGN_MISSION(state, { missionId, agentId }) {
      if (!state.assignments[missionId]) {
        state.assignments[missionId] = [];
      }
      if (!state.assignments[missionId].includes(agentId)) {
        state.assignments[missionId].push(agentId);
      }
    },
    UNASSIGN_MISSION(state, { missionId, agentId }) {
      if (state.assignments[missionId]) {
        state.assignments[missionId] = state.assignments[missionId].filter(id => id !== agentId);
        if (state.assignments[missionId].length === 0) {
          delete state.assignments[missionId];
        }
      }
    }
  },
  actions: {
    assignMission({ commit }, { missionId, agentId }) {
      commit('ASSIGN_MISSION', { missionId, agentId });
    },
    unassignMission({ commit }, { missionId, agentId }) {
      commit('UNASSIGN_MISSION', { missionId, agentId });
    }
  },
  getters: {
    getMissionsByAgent: (state) => (agentId) => {
      const missionIds = Object.entries(state.assignments)
        .filter(([_, agents]) => agents.includes(agentId))
        .map(([missionId]) => missionId);
      return missionIds;
    },
    getAgentsByMission: (state) => (missionId) => {
      return state.assignments[missionId] || [];
    }
  }
};