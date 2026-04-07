import { API_CONFIG } from '@/tt.config.js';

function buildTree(flatGroups) {
  const map = {};
  const roots = [];

  flatGroups.forEach((g) => {
    map[g.id] = { ...g, children: [] };
  });

  flatGroups.forEach((g) => {
    if (g.parent_id && map[g.parent_id]) {
      map[g.parent_id].children.push(map[g.id]);
    } else {
      roots.push(map[g.id]);
    }
  });

  const sortNodes = (nodes) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

  return roots;
}

export default {
  namespaced: true,
  state: {
    groups: [],
    activeGroupId: null,
    isFetching: false,
    lastFetched: null,
  },
  mutations: {
    SET_GROUPS(state, groups) {
      state.groups = groups;
      state.lastFetched = Date.now();
    },
    SET_FETCHING(state, value) {
      state.isFetching = value;
    },
    SET_ACTIVE_GROUP(state, groupId) {
      state.activeGroupId = groupId;
    },
    ADD_GROUP(state, group) {
      state.groups.push(group);
    },
    UPDATE_GROUP(state, updated) {
      const idx = state.groups.findIndex((g) => g.id === updated.id);
      if (idx !== -1) {
        state.groups.splice(idx, 1, { ...state.groups[idx], ...updated });
      }
    },
    REMOVE_GROUP(state, id) {
      state.groups = state.groups.filter((g) => g.id !== id);
      if (state.activeGroupId === id) {
        state.activeGroupId = null;
      }
    },
  },
  getters: {
    // Flat list sorted A-Z
    groups: (state) => [...state.groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    // Tree structure for nested rendering
    groupTree: (state) => buildTree(state.groups),
    activeGroupId: (state) => state.activeGroupId,
    isFetching: (state) => state.isFetching,
    groupById: (state) => (id) => state.groups.find((g) => g.id === id),
    hasChildren: (state) => (id) => state.groups.some((g) => g.parent_id === id),
  },
  actions: {
    async fetchGroups({ commit, state }, { force = false } = {}) {
      if (!force && state.lastFetched && Date.now() - state.lastFetched < 5 * 60 * 1000) {
        return state.groups;
      }
      if (state.isFetching) return state.groups;

      const token = localStorage.getItem('token');
      if (!token) return [];

      commit('SET_FETCHING', true);
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/groups`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        commit('SET_GROUPS', data.groups);
        return data.groups;
      } catch (error) {
        console.error('Error fetching groups:', error);
        return [];
      } finally {
        commit('SET_FETCHING', false);
      }
    },

    async createGroup({ commit }, { name, description, color, parent_id }) {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No authentication token');

      const response = await fetch(`${API_CONFIG.BASE_URL}/groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, color, parent_id: parent_id || null }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const group = await response.json();
      commit('ADD_GROUP', { ...group, conversation_count: 0 });
      return group;
    },

    async updateGroup({ commit }, { id, name, description, color, parent_id }) {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No authentication token');

      const body = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;
      if (color !== undefined) body.color = color;
      if (parent_id !== undefined) body.parent_id = parent_id;

      const response = await fetch(`${API_CONFIG.BASE_URL}/groups/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const group = await response.json();
      commit('UPDATE_GROUP', group);
      return group;
    },

    async deleteGroup({ commit, dispatch }, { id, mode = 'move' }) {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No authentication token');

      const response = await fetch(`${API_CONFIG.BASE_URL}/groups/${id}?mode=${mode}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      if (mode === 'delete') {
        // Remove this group and all descendants from local state
        const toRemove = new Set([id]);
        const findDescendants = (parentId) => {
          dispatch('_collectDescendants', { parentId, toRemove });
        };
        // Collect descendants locally
        const state = this.state.groups;
        const collectLocal = (pid) => {
          (state.groups || []).forEach((g) => {
            if (g.parent_id === pid && !toRemove.has(g.id)) {
              toRemove.add(g.id);
              collectLocal(g.id);
            }
          });
        };
        collectLocal(id);
        toRemove.forEach((gid) => commit('REMOVE_GROUP', gid));
      } else {
        commit('REMOVE_GROUP', id);
      }

      // Refresh to get accurate state
      dispatch('fetchGroups', { force: true });
    },

    async moveToGroup({ commit }, { outputId, groupId }) {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No authentication token');

      const response = await fetch(`${API_CONFIG.BASE_URL}/groups/move/${outputId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId || null }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    },

    async bulkMoveToGroup({ commit }, { outputIds, groupId }) {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No authentication token');

      const response = await fetch(`${API_CONFIG.BASE_URL}/groups/bulk-move`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_ids: outputIds, group_id: groupId || null }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    },

    setActiveGroup({ commit }, groupId) {
      commit('SET_ACTIVE_GROUP', groupId);
    },
  },
};
