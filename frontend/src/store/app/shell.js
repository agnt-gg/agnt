/**
 * shell — UI-only state shared by the canvas shell and every screen.
 *
 * Two things live here, both of them the AGNT One rule that "the right panel
 * is about what you clicked" made necessary:
 *
 *   inspect  — a request to show an entity in the right panel. Emitted by
 *              EntityRef chips in chat, by the Jump palette, by toolbar pills,
 *              and by any list card. The screen that owns the right panel
 *              watches `shell/inspect` and swaps its panel body. A `nonce`
 *              makes re-inspecting the same entity observable.
 *   jumpOpen — whether the ⌘K palette is showing. Kept in the store rather
 *              than in CanvasScreen so a screen can open it too (the composer
 *              hint, the empty states) without a prop chain.
 *   screenPanels — which side panels the ACTIVE screen offers. The phone
 *              header owns the Browse / Inspector buttons, but only the
 *              screen knows whether it has those panels; without this the
 *              header either shows dead buttons or each screen draws its own
 *              extra toolbar row.
 *
 * Nothing here is user data; it is deliberately NOT a resettable module.
 */
export default {
  namespaced: true,
  state: () => ({
    inspect: null, // { kind, id, screen?, payload?, nonce }
    jumpOpen: false,
    updateAvailable: null, // { version } when the updater has one waiting
    screenPanels: { screenId: null, left: false, right: false },
  }),
  mutations: {
    SET_INSPECT(state, target) {
      state.inspect = target;
    },
    CLEAR_INSPECT(state) {
      state.inspect = null;
    },
    SET_JUMP_OPEN(state, open) {
      state.jumpOpen = !!open;
    },
    SET_UPDATE_AVAILABLE(state, info) {
      state.updateAvailable = info || null;
    },
    SET_SCREEN_PANELS(state, { screenId = null, left = false, right = false } = {}) {
      state.screenPanels = { screenId, left: !!left, right: !!right };
    },
  },
  actions: {
    /**
     * Ask the current screen to inspect an entity.
     * @param {{kind:string,id?:string,screen?:string,payload?:object}} target
     */
    inspect({ commit }, target) {
      if (!target || !target.kind) return;
      commit('SET_INSPECT', { ...target, nonce: Date.now() + Math.random() });
    },
    clearInspect({ commit }) {
      commit('CLEAR_INSPECT');
    },
    openJump({ commit }) {
      commit('SET_JUMP_OPEN', true);
    },
    closeJump({ commit }) {
      commit('SET_JUMP_OPEN', false);
    },
    toggleJump({ commit, state }) {
      commit('SET_JUMP_OPEN', !state.jumpOpen);
    },
    setUpdateAvailable({ commit }, info) {
      commit('SET_UPDATE_AVAILABLE', info);
    },
  },
  getters: {
    inspect: (state) => state.inspect,
    jumpOpen: (state) => state.jumpOpen,
    updateAvailable: (state) => state.updateAvailable,
    screenPanels: (state) => state.screenPanels,
  },
};
