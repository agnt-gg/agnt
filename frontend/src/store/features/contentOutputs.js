import { API_CONFIG } from '@/tt.config.js';

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

import { toServerDate } from '@/utils/serverTime.js';
import { unreadIdSet, triageRail } from '@/utils/conversationAttention.js';

export default {
  namespaced: true,
  state: {
    outputs: [],
    totalCount: 0,
    lastFetched: null,
    isFetching: false,
    hasLoadedAll: false,
  },
  mutations: {
    SET_OUTPUTS(state, { outputs, totalCount, append = false }) {
      // Boundary conversion. Server timestamps are naive UTC strings from
      // SQLite's CURRENT_TIMESTAMP; `new Date()` would read them as local time
      // and place every row hours in the future. See utils/serverTime.js.
      const mappedOutputs = outputs.map((output) => ({
        ...output,
        created_at: toServerDate(output.created_at),
        updated_at: toServerDate(output.updated_at),
        last_read_at: toServerDate(output.last_read_at),
        archived_at: toServerDate(output.archived_at),
      }));

      if (append) {
        // Append new outputs, avoiding duplicates
        const existingIds = new Set(state.outputs.map((o) => o.id));
        const newOutputs = mappedOutputs.filter((o) => !existingIds.has(o.id));
        state.outputs = [...state.outputs, ...newOutputs];
      } else {
        state.outputs = mappedOutputs;
      }

      state.totalCount = totalCount;
      state.lastFetched = Date.now();
    },
    SET_HAS_LOADED_ALL(state, value) {
      state.hasLoadedAll = value;
    },
    SET_FETCHING(state, value) {
      state.isFetching = value;
    },
    ADD_OUTPUT(state, output) {
      state.outputs.unshift({
        ...output,
        created_at: toServerDate(output.created_at),
        updated_at: toServerDate(output.updated_at),
        last_read_at: toServerDate(output.last_read_at),
        archived_at: toServerDate(output.archived_at),
      });
    },
    /**
     * Patch a single output in-place (e.g. after a rename) without reordering.
     */
    PATCH_OUTPUT(state, { id, updates }) {
      const idx = state.outputs.findIndex((o) => o.id === id);
      if (idx === -1) return;
      state.outputs[idx] = { ...state.outputs[idx], ...updates };
    },
    REMOVE_OUTPUT(state, outputId) {
      state.outputs = state.outputs.filter((output) => output.id !== outputId);
    },
    INVALIDATE_CACHE(state) {
      state.lastFetched = null;
    },
  },
  getters: {
    outputs: (state) => state.outputs,
    // Derived attention state — see utils/conversationAttention.js for the
    // model. Server columns are the single source of truth; there is no
    // client-side unread bookkeeping to drift out of sync.
    unreadOutputIdSet: (state) => unreadIdSet(state.outputs),
    triageRail: (state) => triageRail(state.outputs),
    visibleOutputs: (state) => state.outputs.filter((o) => !o.archived_at),
    archivedOutputs: (state) => state.outputs.filter((o) => !!o.archived_at),
    totalCount: (state) => state.totalCount,
    isFetching: (state) => state.isFetching,
    hasLoadedAll: (state) => state.hasLoadedAll,
    hasMore: (state) => state.outputs.length < state.totalCount,
    isCacheValid: (state) => {
      if (!state.lastFetched) return false;
      return Date.now() - state.lastFetched < CACHE_DURATION;
    },
  },
  actions: {
    async fetchOutputs({ commit, getters, state }, { force = false, limit = null, offset = 0, loadAll = true } = {}) {
      // If cache is valid and not forcing, return cached data
      // Skip cache when loadAll is requested or when fetching additional pages (offset > 0)
      if (!force && !loadAll && getters.isCacheValid && state.outputs.length > 0 && offset === 0) {
        return state.outputs;
      }

      // If already fetching, don't fetch again
      if (state.isFetching) {
        return state.outputs;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        return [];
      }

      commit('SET_FETCHING', true);

      try {
        // Build URL with pagination params
        const url = new URL(`${API_CONFIG.BASE_URL}/content-outputs`);
        if (!loadAll) {
          url.searchParams.append('limit', limit);
          url.searchParams.append('offset', offset);
        }

        const response = await fetch(url.toString(), {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        commit('SET_OUTPUTS', {
          outputs: data.outputs,
          totalCount: data.totalCount || data.outputs.length,
          append: offset > 0,
        });

        if (loadAll || data.outputs.length >= (data.totalCount || data.outputs.length)) {
          commit('SET_HAS_LOADED_ALL', true);
        }

        return data.outputs;
      } catch (error) {
        console.error('Error fetching outputs:', error);
        return [];
      } finally {
        commit('SET_FETCHING', false);
      }
    },

    async loadMore({ commit, state, dispatch }) {
      if (state.isFetching || state.hasLoadedAll) {
        return;
      }

      const offset = state.outputs.length;
      await dispatch('fetchOutputs', { limit: 20, offset, force: true });
    },

    async loadAll({ commit, state, dispatch }) {
      if (state.isFetching || state.hasLoadedAll) {
        return;
      }

      await dispatch('fetchOutputs', { loadAll: true, force: true });
    },

    async deleteOutput({ commit }, outputId) {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        throw new Error('No authentication token');
      }

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        commit('REMOVE_OUTPUT', outputId);
        return true;
      } catch (error) {
        console.error('Error deleting output:', error);
        throw error;
      }
    },

    /**
     * Shared shape for the two attention PATCHes: optimistic local flip,
     * fire the request, revert the exact fields on failure. The optimistic
     * timestamps use the client clock — close enough for a derived boolean,
     * and the next refetch replaces them with server truth.
     */
    async _patchAttention({ commit, state }, { outputId, path, body, updates }) {
      // The output may not be in local state yet (e.g. a direct
      // /chat?content-id=… open before the sidebar list has fetched). The
      // server PATCH must still go out — only the optimistic flip is skipped.
      const original = state.outputs.find((o) => o.id === outputId);
      const revert = original
        ? Object.fromEntries(Object.keys(updates).map((k) => [k, original[k]]))
        : null;

      if (original) commit('PATCH_OUTPUT', { id: outputId, updates });

      const token = localStorage.getItem('token');
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}/${path}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      } catch (error) {
        if (revert) commit('PATCH_OUTPUT', { id: outputId, updates: revert });
        console.error(`Error patching ${path} on output ${outputId}:`, error);
        throw error;
      }
    },

    markRead({ dispatch, state }, outputId) {
      // Optimistic watermark = the row's own updated_at, NOT the client
      // clock. "Read" means "seen everything up to the last change", and
      // updated_at IS the last change — so this is exact and immune to
      // client/server clock skew (a skewed client clock behind the server's
      // updated_at would otherwise leave a phantom unread dot until the
      // next refetch). The server stamps its own CURRENT_TIMESTAMP as truth.
      const row = state.outputs.find((o) => o.id === outputId);
      return dispatch('_patchAttention', {
        outputId,
        path: 'read',
        body: { read: true },
        updates: { last_read_at: row?.updated_at || new Date() },
      });
    },

    markUnread({ dispatch }, outputId) {
      return dispatch('_patchAttention', {
        outputId,
        path: 'read',
        body: { read: false },
        updates: { last_read_at: null },
      });
    },

    setArchived({ dispatch }, { outputId, archived }) {
      return dispatch('_patchAttention', {
        outputId,
        path: 'archive',
        body: { archived },
        updates: { archived_at: archived ? new Date() : null },
      });
    },

    invalidateCache({ commit }) {
      commit('INVALIDATE_CACHE');
      commit('SET_HAS_LOADED_ALL', false);
    },

    refreshOutputs({ dispatch, commit }) {
      commit('SET_HAS_LOADED_ALL', false);
      return dispatch('fetchOutputs', { force: true, loadAll: true });
    },
  },
};
