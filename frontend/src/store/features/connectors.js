const STORAGE_KEY = 'user_secrets';

function loadSecrets() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveSecrets(secrets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(secrets));
}

const state = () => ({
  secrets: loadSecrets(),
  // UI State for Secrets Screen
  selectedPlugin: null,
  activeTab: 'installed',
  refreshTrigger: 0,
});

const getters = {
  allSecrets: (state) => state.secrets,
  secretsByType: (state) => (type) => state.secrets.filter((s) => s.type === type),
  selectedPlugin: (state) => state.selectedPlugin,
  activeTab: (state) => state.activeTab,
  refreshTrigger: (state) => state.refreshTrigger,
};

const mutations = {
  SET_SECRETS(state, secrets) {
    state.secrets = secrets;
    saveSecrets(secrets);
  },
  ADD_SECRET(state, secret) {
    state.secrets.push(secret);
    saveSecrets(state.secrets);
  },
  UPDATE_SECRET(state, updated) {
    const idx = state.secrets.findIndex((s) => s.id === updated.id);
    if (idx !== -1) {
      state.secrets[idx] = { ...state.secrets[idx], ...updated };
      saveSecrets(state.secrets);
    }
  },
  DELETE_SECRET(state, id) {
    state.secrets = state.secrets.filter((s) => s.id !== id);
    saveSecrets(state.secrets);
  },
  SET_SELECTED_PLUGIN(state, plugin) {
    state.selectedPlugin = plugin;
  },
  SET_ACTIVE_TAB(state, tab) {
    state.activeTab = tab;
  },
  INCREMENT_REFRESH_TRIGGER(state) {
    state.refreshTrigger++;
  },
};

const actions = {
  addSecret({ commit }, secret) {
    commit('ADD_SECRET', secret);
  },
  updateSecret({ commit }, secret) {
    commit('UPDATE_SECRET', secret);
  },
  deleteSecret({ commit }, id) {
    commit('DELETE_SECRET', id);
  },
  loadSecrets({ commit }) {
    commit('SET_SECRETS', loadSecrets());
  },
  selectPlugin({ commit }, plugin) {
    commit('SET_SELECTED_PLUGIN', plugin);
  },
  setActiveTab({ commit }, tab) {
    commit('SET_ACTIVE_TAB', tab);
  },
  triggerRefresh({ commit }) {
    commit('INCREMENT_REFRESH_TRIGGER');
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
};
