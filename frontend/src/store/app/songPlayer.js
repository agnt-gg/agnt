export default {
  namespaced: true,
  state: () => ({
    isPlaying: false,
    currentSongIndex: 0,
    songs: [],
    currentTime: 0,
    duration: 0,
    // Add more as needed
  }),
  mutations: {
    setIsPlaying(state, val) { state.isPlaying = val; },
    setCurrentSongIndex(state, idx) { state.currentSongIndex = idx; },
    setSongs(state, songs) { state.songs = songs; },
    setCurrentTime(state, t) { state.currentTime = t; },
    setDuration(state, d) { state.duration = d; },
  },
  actions: {
    play({ commit }) { commit('setIsPlaying', true); },
    pause({ commit }) { commit('setIsPlaying', false); },
    next({ state, commit }) {
      if (state.songs.length) {
        commit('setCurrentSongIndex', (state.currentSongIndex + 1) % state.songs.length);
      }
    },
    prev({ state, commit }) {
      if (state.songs.length) {
        commit('setCurrentSongIndex', (state.currentSongIndex - 1 + state.songs.length) % state.songs.length);
      }
    },
    setSongs({ commit }, songs) { commit('setSongs', songs); },
    setCurrentTime({ commit }, t) { commit('setCurrentTime', t); },
    setDuration({ commit }, d) { commit('setDuration', d); },
    setSongIndex({ commit }, idx) { commit('setCurrentSongIndex', idx); },
  }
};
