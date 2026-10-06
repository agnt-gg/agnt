/**
 * Plugin Builder Store — the Plugin Forge draft.
 *
 * The draft is a plugin being written: manifest.json, one code file per tool,
 * package.json. It lives here (persisted locally) and is edited from two
 * places: by hand in the Forge's Code tab, and by the Forge chat, whose
 * backend tools (orchestrator/pluginTools.js) describe each change as a
 * `plugin-*` frontend event that `applyChatEvent` applies. The chat reads the
 * draft back through `draftFiles` on every turn (usePluginChatContext).
 */

// Load persisted state from localStorage
const loadPersistedState = () => {
  try {
    const persisted = localStorage.getItem('pluginBuilderState');
    return persisted ? JSON.parse(persisted) : null;
  } catch (error) {
    console.error('Error loading persisted plugin builder state:', error);
    return null;
  }
};

// Save state to localStorage
const saveState = (state) => {
  try {
    const stateToSave = {
      generatedManifest: state.generatedManifest,
      generatedCode: state.generatedCode,
      generatedPackageJson: state.generatedPackageJson,
      installedHash: state.installedHash,
      builtPluginNames: state.builtPluginNames,
    };
    localStorage.setItem('pluginBuilderState', JSON.stringify(stateToSave));
  } catch (error) {
    console.error('Error saving plugin builder state:', error);
  }
};

const persistedState = loadPersistedState();

/** The Forge's one chat channel. A draft is one plugin; so is its conversation. */
export const PLUGIN_FORGE_CHANNEL_KEY = 'plugin:plugin-forge';

const MANIFEST = 'manifest.json';
const PACKAGE = 'package.json';

/**
 * Cheap, stable fingerprint of the draft's files (djb2).
 *
 * The Forge has to answer one question on every keystroke: is what I am
 * looking at what is installed? Comparing fingerprints answers it without
 * keeping a second copy of every file in localStorage.
 */
export function fingerprint(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * Fingerprint of a { fileName: content } map, independent of key order. The
 * chat's `plugin-installed` event carries the exact files it installed, so
 * the install state is recorded from what was installed, not from whatever
 * the draft happens to hold when the event lands.
 */
export function hashFiles(files) {
  const sorted = {};
  for (const name of Object.keys(files).sort()) sorted[name] = files[name];
  return fingerprint(JSON.stringify(sorted));
}

/** Clears the Forge conversation when the draft becomes a different plugin. */
function clearForgeConversation(store) {
  if (store?.hasModule?.('chatUnified')) {
    store.dispatch('chatUnified/clearConversation', { channelKey: PLUGIN_FORGE_CHANNEL_KEY });
  }
}

export default {
  namespaced: true,
  state: {
    // Draft files
    generatedManifest: persistedState?.generatedManifest || null,
    generatedCode: persistedState?.generatedCode || {}, // { 'tool-name.js': '...' }
    generatedPackageJson: persistedState?.generatedPackageJson || null,

    // Build state
    isBuilding: false,
    buildProgress: null,
    buildResult: null,
    buildError: null,

    // Preview/Edit state
    activePreviewFile: null, // Which file is being previewed/edited
    editedFiles: {}, // Track user edits: { 'manifest.json': '...', 'tool.js': '...' }

    // Fingerprint of the files last installed from (or loaded into) the Forge.
    // null means this draft has never been installed.
    installedHash: persistedState?.installedHash || null,
    // Plugins built in the Forge on this machine — the "My builds" view.
    builtPluginNames: persistedState?.builtPluginNames || [],
    // Session-only: last Test-tab run per `${plugin}:${toolType}`.
    testResults: {},
  },

  mutations: {
    SET_GENERATED_MANIFEST(state, manifest) {
      state.generatedManifest = manifest;
      saveState(state);
    },

    SET_GENERATED_CODE(state, { fileName, code }) {
      state.generatedCode = { ...state.generatedCode, [fileName]: code };
      saveState(state);
    },

    SET_ALL_GENERATED_CODE(state, codeMap) {
      state.generatedCode = codeMap;
      saveState(state);
    },

    SET_GENERATED_PACKAGE_JSON(state, packageJson) {
      state.generatedPackageJson = packageJson;
      saveState(state);
    },

    /**
     * One file's new content, from the chat. JSON files are stored parsed so
     * the Overview reads them; content that does not parse is kept verbatim
     * as an edit rather than dropped. Either way the file's hand edit is
     * superseded: the chat edited the text the user was looking at.
     */
    APPLY_FILE(state, { file, content }) {
      const edited = { ...state.editedFiles };
      delete edited[file];
      if (file === MANIFEST || file === PACKAGE) {
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch {
          parsed = undefined;
        }
        if (parsed === undefined) edited[file] = content;
        else if (file === MANIFEST) state.generatedManifest = parsed;
        else state.generatedPackageJson = parsed;
      } else {
        state.generatedCode = { ...state.generatedCode, [file]: content };
      }
      state.editedFiles = edited;
      saveState(state);
    },

    REMOVE_FILE(state, file) {
      if (file === PACKAGE) {
        state.generatedPackageJson = null;
      } else {
        const code = { ...state.generatedCode };
        delete code[file];
        state.generatedCode = code;
      }
      const edited = { ...state.editedFiles };
      delete edited[file];
      state.editedFiles = edited;
      if (state.activePreviewFile === file) state.activePreviewFile = null;
      saveState(state);
    },

    SET_BUILDING(state, isBuilding) {
      state.isBuilding = isBuilding;
      if (isBuilding) {
        state.buildError = null;
        state.buildResult = null;
      }
    },

    SET_BUILD_PROGRESS(state, progress) {
      state.buildProgress = progress;
    },

    SET_BUILD_RESULT(state, result) {
      state.buildResult = result;
      state.isBuilding = false;
    },

    SET_BUILD_ERROR(state, error) {
      state.buildError = error;
      state.isBuilding = false;
    },

    SET_ACTIVE_PREVIEW_FILE(state, fileName) {
      state.activePreviewFile = fileName;
    },

    SET_EDITED_FILE(state, { fileName, content }) {
      state.editedFiles = { ...state.editedFiles, [fileName]: content };
    },

    SET_INSTALLED_HASH(state, hash) {
      state.installedHash = hash;
      saveState(state);
    },

    ADD_BUILT_PLUGIN_NAME(state, name) {
      if (!name || state.builtPluginNames.includes(name)) return;
      state.builtPluginNames = [...state.builtPluginNames, name];
      saveState(state);
    },

    SET_TEST_RESULT(state, { pluginName, toolType, result }) {
      state.testResults = { ...state.testResults, [`${pluginName}:${toolType}`]: result };
    },

    RESET_GENERATION(state) {
      state.generatedManifest = null;
      state.generatedCode = {};
      state.generatedPackageJson = null;
      state.buildResult = null;
      state.buildError = null;
      state.editedFiles = {};
      state.activePreviewFile = null;
      saveState(state);
    },

    RESET_ALL(state) {
      state.generatedManifest = null;
      state.generatedCode = {};
      state.generatedPackageJson = null;
      state.isBuilding = false;
      state.buildProgress = null;
      state.buildResult = null;
      state.buildError = null;
      state.activePreviewFile = null;
      state.editedFiles = {};
      state.installedHash = null;
      // builtPluginNames is history, not draft state: it survives Start over.
      saveState(state);
    },
  },

  getters: {
    // Get the effective content for a file (edited version or generated)
    getFileContent: (state) => (fileName) => {
      if (state.editedFiles[fileName] !== undefined) {
        return state.editedFiles[fileName];
      }
      if (fileName === MANIFEST && state.generatedManifest) {
        return JSON.stringify(state.generatedManifest, null, 2);
      }
      if (fileName === PACKAGE && state.generatedPackageJson) {
        return JSON.stringify(state.generatedPackageJson, null, 2);
      }
      return state.generatedCode[fileName] || '';
    },

    // Get list of all generated files
    generatedFiles: (state) => {
      const files = [];
      if (state.generatedManifest) {
        files.push({ name: MANIFEST, type: 'json', icon: 'file-code' });
      }
      Object.keys(state.generatedCode).forEach((fileName) => {
        files.push({ name: fileName, type: 'javascript', icon: 'file-code' });
      });
      if (state.generatedPackageJson) {
        files.push({ name: PACKAGE, type: 'json', icon: 'file-code' });
      }
      return files;
    },

    /** Every file as the user sees it (hand edits included). What the chat reads. */
    draftFiles: (state, getters) => {
      const files = {};
      for (const { name } of getters.generatedFiles) files[name] = getters.getFileContent(name);
      return files;
    },

    // A draft exists: a manifest and at least one code file.
    isGenerationComplete: (state) => {
      return state.generatedManifest !== null && Object.keys(state.generatedCode).length > 0;
    },

    // Check if there are unsaved edits
    hasUnsavedEdits: (state) => {
      return Object.keys(state.editedFiles).length > 0;
    },

    // Get plugin name from manifest
    pluginName: (state) => {
      return state.generatedManifest?.name || 'new-plugin';
    },

    // Get tools from manifest
    pluginTools: (state) => {
      return state.generatedManifest?.tools || [];
    },

    // Fingerprint of the effective files (user edits included), or null.
    draftHash: (state, getters) => {
      if (!getters.isGenerationComplete) return null;
      return hashFiles(getters.draftFiles);
    },

    /** 'none' | 'draft' (never installed) | 'changed' (installed, edited since) | 'installed'. */
    draftInstallState: (state, getters) => {
      if (!getters.isGenerationComplete) return 'none';
      if (!state.installedHash) return 'draft';
      return getters.draftHash === state.installedHash ? 'installed' : 'changed';
    },

    // True when the draft has work that exists nowhere but this browser.
    hasUninstalledWork: (state, getters) => {
      return getters.isGenerationComplete && getters.draftHash !== state.installedHash;
    },

    testResultFor: (state) => (pluginName, toolType) => state.testResults[`${pluginName}:${toolType}`] || null,
  },

  actions: {
    /**
     * Apply one change the Forge chat made. Returns whether the event was a
     * Plugin Forge event at all, so callers can tell "handled" from "not ours".
     */
    applyChatEvent({ commit, dispatch }, { eventType, eventData = {} } = {}) {
      switch (eventType) {
        case 'plugin-files-replaced': {
          const files = eventData.files || {};
          commit('RESET_GENERATION');
          for (const [file, content] of Object.entries(files)) commit('APPLY_FILE', { file, content });
          commit('SET_INSTALLED_HASH', eventData.installed ? hashFiles(files) : null);
          return true;
        }
        case 'plugin-file-updated':
          if (typeof eventData.file === 'string' && typeof eventData.content === 'string') {
            commit('APPLY_FILE', { file: eventData.file, content: eventData.content });
          }
          return true;
        case 'plugin-file-deleted':
          if (typeof eventData.file === 'string') commit('REMOVE_FILE', eventData.file);
          return true;
        case 'plugin-installed':
          commit('SET_INSTALLED_HASH', hashFiles(eventData.files || {}));
          commit('ADD_BUILT_PLUGIN_NAME', eventData.name);
          // New tools exist now; anything listing tools should see them.
          dispatch('tools/fetchTools', { force: true }, { root: true })?.catch?.(() => {});
          return true;
        case 'plugin-test-result':
          if (eventData.pluginName && eventData.toolType) {
            commit('SET_TEST_RESULT', { pluginName: eventData.pluginName, toolType: eventData.toolType, result: eventData.result });
          }
          return true;
        default:
          return false;
      }
    },

    /**
     * Build and install the generated plugin
     */
    async buildAndInstallPlugin({ commit, state, getters, dispatch }) {
      if (!getters.isGenerationComplete) {
        commit('SET_BUILD_ERROR', 'Plugin generation is not complete');
        return { success: false, error: 'Generation not complete' };
      }

      commit('SET_BUILDING', true);
      commit('SET_BUILD_PROGRESS', 'preparing');

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        // Get the effective content (with any user edits)
        let manifest = state.generatedManifest;
        if (state.editedFiles[MANIFEST]) {
          manifest = JSON.parse(state.editedFiles[MANIFEST]);
        }

        const toolCode = {};
        for (const fileName of Object.keys(state.generatedCode)) {
          toolCode[fileName] = getters.getFileContent(fileName);
        }

        let packageJson = state.generatedPackageJson;
        if (state.editedFiles[PACKAGE]) {
          packageJson = JSON.parse(state.editedFiles[PACKAGE]);
        }

        const { API_CONFIG } = await import('@/tt.config.js');

        commit('SET_BUILD_PROGRESS', 'building');

        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/build-generated`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            manifest,
            toolCode,
            packageJson,
            installAfterBuild: true,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Build failed: ${response.statusText}`);
        }

        const result = await response.json();
        if (result && result.success === false) {
          throw new Error(result.error || 'Build failed');
        }

        commit('SET_BUILD_PROGRESS', 'complete');
        commit('SET_BUILD_RESULT', result);
        // What is installed now is exactly what was just sent.
        commit('SET_INSTALLED_HASH', getters.draftHash);
        commit('ADD_BUILT_PLUGIN_NAME', manifest.name);

        // Refresh the tools store to pick up new plugin tools
        await dispatch('tools/fetchTools', { force: true }, { root: true });

        return { success: true, result };
      } catch (error) {
        console.error('Plugin build error:', error);
        commit('SET_BUILD_ERROR', error.message);
        return { success: false, error: error.message };
      }
    },

    /**
     * Update a file with user edits
     */
    updateFile({ commit }, { fileName, content }) {
      commit('SET_EDITED_FILE', { fileName, content });
    },

    /** Remember the last Test-tab run of one tool (session only). */
    recordTestResult({ commit }, { pluginName, toolType, result }) {
      commit('SET_TEST_RESULT', { pluginName, toolType, result });
    },

    /**
     * Set the active preview file
     */
    setActivePreviewFile({ commit }, fileName) {
      commit('SET_ACTIVE_PREVIEW_FILE', fileName);
    },

    /**
     * Reset generation state
     */
    resetGeneration({ commit }) {
      commit('RESET_GENERATION');
    },

    /**
     * Start over: an empty draft and a fresh conversation about it.
     * (`this` is the store: Vuex calls actions with it bound.)
     */
    resetAll({ commit }) {
      commit('RESET_ALL');
      clearForgeConversation(this);
    },

    /**
     * Load an installed plugin for editing
     */
    async loadPluginForEditing({ commit, getters }, pluginName) {
      commit('RESET_ALL'); // Start fresh
      clearForgeConversation(this);

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const { API_CONFIG } = await import('@/tt.config.js');
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed/${pluginName}/source`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json();

        if (!data.success) throw new Error(data.error);

        const files = data.files;

        // Parse manifest
        if (files[MANIFEST]) {
          commit('SET_GENERATED_MANIFEST', JSON.parse(files[MANIFEST]));
          delete files[MANIFEST];
        }

        // Parse package.json
        if (files[PACKAGE]) {
          commit('SET_GENERATED_PACKAGE_JSON', JSON.parse(files[PACKAGE]));
          delete files[PACKAGE];
        }

        // Rest are code files
        commit('SET_ALL_GENERATED_CODE', files);

        // Loaded from the installed copy, so it IS the installed copy.
        commit('SET_INSTALLED_HASH', getters.draftHash);

        return { success: true };
      } catch (error) {
        console.error('Error loading plugin:', error);
        return { success: false, error: error.message };
      }
    },
  },
};
