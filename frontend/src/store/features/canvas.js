export default {
  namespaced: true,
  state: {
    // Current canvas state
    canvasState: null,
    // Loading state
    isLoading: false,
    // Error state
    error: null,
  },
  mutations: {
    SET_CANVAS_STATE(state, canvasState) {
      state.canvasState = canvasState;
    },
    SET_LOADING(state, isLoading) {
      state.isLoading = isLoading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    CLEAR_CANVAS_STATE(state) {
      state.canvasState = null;
      state.error = null;
    },
  },
  actions: {
    updateCanvasState({ commit }, canvasState) {
      commit('SET_CANVAS_STATE', canvasState);
    },
    clearCanvasState({ commit }) {
      commit('CLEAR_CANVAS_STATE');
    },
    setLoading({ commit }, isLoading) {
      commit('SET_LOADING', isLoading);
    },
    setError({ commit }, error) {
      commit('SET_ERROR', error);
    },
  },
  getters: {
    canvasState: (state) => state.canvasState,
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
    getCanvasStateById: (state) => (id) => {
      if (state.canvasState && state.canvasState.id === id) {
        return state.canvasState;
      }
      return null;
    },
  },
};
