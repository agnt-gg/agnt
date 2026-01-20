// Basic Missions Module

// Example Mission Interface:
// { id: string, title: string, description: string, status: 'New' | 'Active' | 'Completed' | 'Failed', objectives: Array<any>, rewards: any }

import axios from 'axios'; // Import axios
import { API_CONFIG } from '@/tt.config.js'; // Import API config

const state = () => ({
  availableMissions: [
    {
      id: 'mission-1',
      title: 'Data Analysis Task',
      description: 'Analyze large datasets for patterns and anomalies',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Process raw data', completed: true },
        { id: 'obj2', label: 'Identify patterns', completed: false }
      ],
      rewards: { xp: 100, tokens: 50 }
    },
    {
      id: 'mission-2',
      title: 'System Optimization',
      description: 'Optimize system performance and resource usage',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Analyze current performance', completed: false },
        { id: 'obj2', label: 'Implement optimizations', completed: false }
      ],
      rewards: { xp: 150, tokens: 75 }
    },
    {
      id: 'mission-3',
      title: 'Code Review',
      description: 'Review and improve code quality across modules',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Review code base', completed: true },
        { id: 'obj2', label: 'Suggest improvements', completed: true }
      ],
      rewards: { xp: 120, tokens: 60 }
    },
    {
      id: 'mission-4',
      title: 'Resource Management',
      description: 'Monitor and manage system resources efficiently',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Monitor resources', completed: false },
        { id: 'obj2', label: 'Optimize allocation', completed: false }
      ],
      rewards: { xp: 200, tokens: 100 }
    },
    {
      id: 'mission-5',
      title: 'Security Audit',
      description: 'Perform comprehensive security analysis',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Scan for vulnerabilities', completed: true },
        { id: 'obj2', label: 'Generate report', completed: false }
      ],
      rewards: { xp: 250, tokens: 125 }
    },
    {
      id: 'mission-6',
      title: 'Market Intelligence Gathering',
      description: 'Analyze competitor products and identify market opportunities',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Gather competitive intelligence', completed: false },
        { id: 'obj2', label: 'Identify potential market gaps', completed: false }
      ],
      rewards: { xp: 180, tokens: 90 }
    },
    {
      id: 'mission-7',
      title: 'Support Queue Optimization',
      description: 'Streamline customer support workflows and improve response metrics',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Analyze current response times', completed: false },
        { id: 'obj2', label: 'Implement triage system', completed: false }
      ],
      rewards: { xp: 130, tokens: 65 }
    },
    {
      id: 'mission-8',
      title: 'CI/CD Pipeline Setup',
      description: 'Establish automated testing and deployment workflows',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Configure test automation', completed: false },
        { id: 'obj2', label: 'Set up deployment pipeline', completed: false }
      ],
      rewards: { xp: 220, tokens: 110 }
    },
    {
      id: 'mission-9',
      title: 'Content Ecosystem Development',
      description: 'Create and distribute content to drive user engagement',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Develop content calendar', completed: false },
        { id: 'obj2', label: 'Analyze engagement metrics', completed: false }
      ],
      rewards: { xp: 140, tokens: 70 }
    },
    {
      id: 'mission-10',
      title: 'Revenue Projection Model',
      description: 'Build predictive models for business financial planning',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Collect historical data', completed: false },
        { id: 'obj2', label: 'Develop projection algorithms', completed: false }
      ],
      rewards: { xp: 230, tokens: 115 }
    },
    {
      id: 'mission-11',
      title: 'Third-party Service Integration',
      description: 'Connect systems with external service providers via APIs',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Document API requirements', completed: false },
        { id: 'obj2', label: 'Implement secure connections', completed: false }
      ],
      rewards: { xp: 190, tokens: 95 }
    },
    {
      id: 'mission-12',
      title: 'Usability Testing Program',
      description: 'Evaluate and improve product usability through user testing',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Design test scenarios', completed: false },
        { id: 'obj2', label: 'Analyze user behavior patterns', completed: false }
      ],
      rewards: { xp: 160, tokens: 80 }
    },
    {
      id: 'mission-13',
      title: 'Regulatory Compliance Implementation',
      description: 'Ensure systems meet industry regulatory requirements',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Audit current compliance status', completed: false },
        { id: 'obj2', label: 'Implement required controls', completed: false }
      ],
      rewards: { xp: 270, tokens: 135 }
    },
    {
      id: 'mission-14',
      title: 'Data Privacy Policy Development',
      description: 'Create and implement a comprehensive data privacy policy',
      status: 'Active',
      objectives: [
        { id: 'obj1', label: 'Identify data types and processing activities', completed: false },
        { id: 'obj2', label: 'Develop policy framework', completed: false }
      ],
      rewards: { xp: 240, tokens: 120 }
    }
  ],
  activeMissions: [],
  completedMissions: [],
  failedMissions: [], // Backend doesn't provide this yet
  missionsFetched: false,
  isLoading: false,
  error: null,
});

const mutations = {
  SET_MISSIONS(state, { active = [], completed = [], available = [] /*, failed = [] */ }) {
    // Overwrite based on what the backend provides
    state.activeMissions = active;
    state.completedMissions = completed;
    state.availableMissions = available;
    // state.failedMissions = failed; // Keep handling for failed missions if needed later

    state.missionsFetched = true;
    state.isLoading = false;
    state.error = null;
  },
  SET_LOADING(state, isLoading) {
    state.isLoading = isLoading;
    if (isLoading) state.error = null;
  },
  SET_ERROR(state, error) {
    state.isLoading = false;
    state.error = error;
  },
  ADD_AVAILABLE_MISSION(state, mission) {
    if (!state.availableMissions.some((q) => q.id === mission.id)) {
      state.availableMissions.push(mission);
    }
  },
  ACTIVATE_MISSION(state, missionId) {
    const missionIndex = state.availableMissions.findIndex((q) => q.id === missionId);
    if (missionIndex > -1) {
      const [mission] = state.availableMissions.splice(missionIndex, 1);
      mission.status = "Active";
      state.activeMissions.push(mission);
    }
  },
  UPDATE_MISSION_STATUS(state, { missionId, status }) {
    const findAndUpdate = (list) => {
      const mission = list.find((q) => q.id === missionId);
      if (mission) mission.status = status;
      return !!mission;
    };
    if (!findAndUpdate(state.activeMissions)) {
      findAndUpdate(state.availableMissions);
    }
    // Potentially move between lists based on new status (e.g., Active -> Completed)
    // Add logic here if needed
  },
  COMPLETE_MISSION(state, missionId) {
    const missionIndex = state.activeMissions.findIndex((q) => q.id === missionId);
    if (missionIndex > -1) {
      const [mission] = state.activeMissions.splice(missionIndex, 1);
      mission.status = "Completed";
      state.completedMissions.push(mission);
    }
  },
  FAIL_MISSION(state, missionId) {
    const missionIndex = state.activeMissions.findIndex((q) => q.id === missionId);
    if (missionIndex > -1) {
      const [mission] = state.activeMissions.splice(missionIndex, 1);
      mission.status = "Failed";
      state.failedMissions.push(mission);
    }
    // Optionally handle failure for available missions too
  },
  // Add more mutations as needed (e.g., update objectives)
};

const actions = {
  async fetchMissions({ commit, state }) {
    // Prevent concurrent fetches or refetching if already loaded
    if (state.isLoading || state.missionsFetched) return; 
    commit('SET_LOADING', true);
    try {
      // Simulate API call - replace with actual API call later
      console.log("[Missions Store] Simulating API call to fetch missions...");
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay

      // Keep all missions in their original state
      const simulatedResponseData = {
        available: state.availableMissions,
        active: [],  // These will be determined by getters
        completed: []
      };
      console.log("[Missions Store] Simulated API response:", simulatedResponseData);

      commit('SET_MISSIONS', simulatedResponseData);
      console.log("[Missions Store] Missions state updated.");

    } catch (error) {
      console.error("Error fetching missions:", error);
      commit('SET_ERROR', error.message || 'Failed to fetch missions');
    } finally {
      commit('SET_LOADING', false);
    }
  },
  acceptMission({ commit }, missionId) {
    // This mutation should handle moving a mission from available to active
    commit("ACTIVATE_MISSION", missionId); 
    // TODO: Potential future API call to accept mission on backend?
  },
  // Add more actions for mission progression, submission, etc.
};

const getters = {
  allAvailableMissions: (state) => state.availableMissions.filter(mission => mission.status !== 'Completed'),
  allActiveMissions: (state) => state.availableMissions.filter(mission => mission.status === 'Active'),
  allCompletedMissions: (state) => state.completedMissions,
  getMissionById: (state) => (id) => {
    return (
      state.availableMissions.find((q) => q.id === id) ||
      state.activeMissions.find((q) => q.id === id) ||
      state.completedMissions.find((q) => q.id === id) ||
      state.failedMissions.find((q) => q.id === id)
    );
  },
  areMissionsLoaded: (state) => state.missionsFetched,
  isLoading: (state) => state.isLoading,
  error: (state) => state.error,
  // New getter for missions with assignments
  getMissionsWithAssignments: (state, getters, rootState, rootGetters) => {
    return state.availableMissions.filter(mission => {
      const agentIds = rootGetters['missionAssignments/getAgentsByMission'](mission.id);
      return agentIds && agentIds.length > 0;
    });
  },
  // New getter for missions without assignments
  getMissionsWithoutAssignments: (state, getters, rootState, rootGetters) => {
    return state.availableMissions.filter(mission => {
      const agentIds = rootGetters['missionAssignments/getAgentsByMission'](mission.id);
      return (!agentIds || agentIds.length === 0) && mission.status !== 'Completed';
    });
  }
};

export default {
  namespaced: true,
  state,
  mutations,
  actions,
  getters,
};