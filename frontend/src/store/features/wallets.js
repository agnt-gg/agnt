import { API_CONFIG } from '@/tt.config.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No authentication token found');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export default {
  namespaced: true,
  state: {
    wallets: [],
    rootWallet: null,
    ledger: {}, // keyed by walletId
    isLoading: false,
    error: null,
  },
  mutations: {
    SET_WALLETS(state, wallets) { state.wallets = wallets || []; },
    SET_ROOT_WALLET(state, wallet) { state.rootWallet = wallet; },
    UPSERT_WALLET(state, wallet) {
      if (!wallet || !wallet.id) return;
      const idx = state.wallets.findIndex(w => w.id === wallet.id);
      if (idx >= 0) state.wallets.splice(idx, 1, wallet);
      else state.wallets.unshift(wallet);
      if (state.rootWallet && state.rootWallet.id === wallet.id) state.rootWallet = wallet;
    },
    SET_LEDGER(state, { walletId, ledger }) {
      state.ledger = { ...state.ledger, [walletId]: ledger || [] };
    },
    SET_LOADING(state, val) { state.isLoading = val; },
    SET_ERROR(state, err) { state.error = err; },
  },
  actions: {
    async fetchWallets({ commit }, filters = {}) {
      commit('SET_LOADING', true);
      try {
        const params = new URLSearchParams();
        if (filters.ownerType) params.append('ownerType', filters.ownerType);
        if (filters.status) params.append('status', filters.status);
        const res = await fetch(`${API_CONFIG.BASE_URL}/wallets?${params}`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_WALLETS', data.wallets);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchRoot({ commit }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/wallets/root`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_ROOT_WALLET', data.wallet);
        return data.wallet;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return null;
      }
    },

    async topUpRoot({ commit, dispatch }, { amount, note }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/wallets/root/topup`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
          body: JSON.stringify({ amount, note }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        commit('SET_ROOT_WALLET', data.wallet);
        dispatch('fetchWallets');
        return data.wallet;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async fetchLedger({ commit }, { walletId, limit = 200 }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/wallets/${walletId}/ledger?limit=${limit}`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_LEDGER', { walletId, ledger: data.ledger });
        return data.ledger;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async releaseWallet({ commit }, id) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/wallets/${id}/release`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        commit('UPSERT_WALLET', data.wallet);
        return data.wallet;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },
  },
  getters: {
    allWallets: (state) => state.wallets,
    rootWallet: (state) => state.rootWallet,
    rootBalance: (state) => state.rootWallet?.balance ?? 0,
    childWallets: (state) => state.wallets.filter(w => w.parent_id),
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
  },
};
