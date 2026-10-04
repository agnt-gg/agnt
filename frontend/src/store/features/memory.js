import { API_CONFIG } from '@/tt.config.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No authentication token found');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export default {
  namespaced:true,
  state:{agentMemories:[],error:null},
  mutations:{SET_AGENT_MEMORIES(state,rows){state.agentMemories=rows||[];},SET_ERROR(state,error){state.error=error;}},
  actions:{
    async fetchAllMemories({ commit }) {
      const token=localStorage.getItem('token');
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if(token!==localStorage.getItem('token'))return [];
        commit('SET_AGENT_MEMORIES', data.memories);
        return data.memories;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async fetchAgentMemories({ commit }, agentId) {
      const token=localStorage.getItem('token');
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/${agentId}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if(token!==localStorage.getItem('token'))return [];
        commit('SET_AGENT_MEMORIES', data.memories);
        return data.memories;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async addAgentMemory({ dispatch }, { agentId, memoryType, content }) {
      try {
        const effectiveAgentId = agentId || 'orchestrator';
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/${effectiveAgentId}`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ memoryType, content }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        await dispatch('fetchAllMemories');
        return data.id;
      } catch (error) {
        throw error;
      }
    },

    async updateAgentMemory({ dispatch }, { id, content, relevanceScore, memoryType, agentId }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/entry/${id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ content, relevanceScore, memoryType }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await dispatch(agentId?'fetchAgentMemories':'fetchAllMemories',agentId);
      } catch (error) {
        throw error;
      }
    },

    async deleteAgentMemory({ dispatch }, { id, agentId }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/entry/${id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (agentId) dispatch('fetchAgentMemories', agentId);
      } catch (error) {
        throw error;
      }
    },

    async deleteOrphanedMemories() {
      const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/orphaned`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    },
  },
  getters:{agentMemories:state=>state.agentMemories,error:state=>state.error},
};
