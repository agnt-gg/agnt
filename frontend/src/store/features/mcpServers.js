import { API_CONFIG } from '@/tt.config.js';

const state = () => ({
  servers: [],
  loading: false,
  error: null,
  npmPackages: [],
  npmLoading: false,
  popularServers: [],
});

const getters = {
  allServers: (state) => state.servers,
  serversByType: (state) => (type) => state.servers.filter((s) => s.transport.type === type),
  serverCount: (state) => state.servers.length,
  httpServers: (state) => state.servers.filter((s) => s.transport.type === 'http'),
  stdioServers: (state) => state.servers.filter((s) => s.transport.type === 'stdio'),
};

const mutations = {
  SET_SERVERS(state, servers) {
    state.servers = servers;
  },
  ADD_SERVER(state, server) {
    state.servers.push(server);
  },
  UPDATE_SERVER(state, updated) {
    const idx = state.servers.findIndex((s) => s.name === updated.name);
    if (idx !== -1) {
      state.servers[idx] = updated;
    }
  },
  DELETE_SERVER(state, name) {
    state.servers = state.servers.filter((s) => s.name !== name);
  },
  SET_LOADING(state, loading) {
    state.loading = loading;
  },
  SET_ERROR(state, error) {
    state.error = error;
  },
  SET_NPM_PACKAGES(state, packages) {
    state.npmPackages = packages;
  },
  SET_NPM_LOADING(state, loading) {
    state.npmLoading = loading;
  },
  SET_POPULAR_SERVERS(state, servers) {
    state.popularServers = servers;
  },
};

const actions = {
  async fetchServers({ commit }) {
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/mcp/servers`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('SET_SERVERS', data.servers);
      } else {
        throw new Error(data.error || 'Failed to fetch servers');
      }
    } catch (error) {
      console.error('Error fetching MCP servers:', error);
      commit('SET_ERROR', error.message);
    } finally {
      commit('SET_LOADING', false);
    }
  },

  async addServer({ commit, dispatch }, server) {
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/mcp/servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(server),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('ADD_SERVER', data.server);
        return { success: true, message: data.message };
      } else {
        throw new Error(data.error || 'Failed to add server');
      }
    } catch (error) {
      console.error('Error adding MCP server:', error);
      commit('SET_ERROR', error.message);
      return { success: false, error: error.message };
    } finally {
      commit('SET_LOADING', false);
    }
  },

  async updateServer({ commit }, { oldName, server }) {
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/mcp/servers/${encodeURIComponent(oldName)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(server),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('UPDATE_SERVER', data.server);
        return { success: true, message: data.message };
      } else {
        throw new Error(data.error || 'Failed to update server');
      }
    } catch (error) {
      console.error('Error updating MCP server:', error);
      commit('SET_ERROR', error.message);
      return { success: false, error: error.message };
    } finally {
      commit('SET_LOADING', false);
    }
  },

  async deleteServer({ commit }, name) {
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/mcp/servers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('DELETE_SERVER', name);
        return { success: true, message: data.message };
      } else {
        throw new Error(data.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      commit('SET_ERROR', error.message);
      return { success: false, error: error.message };
    } finally {
      commit('SET_LOADING', false);
    }
  },

  async testConnection({ commit }, name) {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/mcp/servers/${encodeURIComponent(name)}/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error testing MCP server connection:', error);
      return { success: false, error: error.message };
    }
  },

  async getServerCapabilities({ commit }, name) {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/mcp/servers/${encodeURIComponent(name)}/capabilities`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching server capabilities:', error);
      return { success: false, error: error.message };
    }
  },

  async searchNPMPackages({ commit }, query = '') {
    commit('SET_NPM_LOADING', true);
    try {
      const token = localStorage.getItem('token');
      const searchQuery = query || 'mcp-server';
      const response = await fetch(`${API_CONFIG.BASE_URL}/npm/search?query=${encodeURIComponent(searchQuery)}&limit=50`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('SET_NPM_PACKAGES', data.packages);
        return { success: true, packages: data.packages };
      } else {
        throw new Error(data.error || 'Failed to search NPM packages');
      }
    } catch (error) {
      console.error('Error searching NPM packages:', error);
      return { success: false, error: error.message };
    } finally {
      commit('SET_NPM_LOADING', false);
    }
  },

  async fetchPopularServers({ commit }) {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/npm/popular`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('SET_POPULAR_SERVERS', data.packages);
        return { success: true, packages: data.packages };
      } else {
        throw new Error(data.error || 'Failed to fetch popular servers');
      }
    } catch (error) {
      console.error('Error fetching popular servers:', error);
      return { success: false, error: error.message };
    }
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
};
