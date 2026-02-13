/**
 * Plugin Builder Store
 *
 * Manages state for AI-powered plugin generation.
 * Uses the global AI provider to generate manifest, code, and package.json.
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
      conversation: state.conversation,
      pluginDescription: state.pluginDescription,
    };
    localStorage.setItem('pluginBuilderState', JSON.stringify(stateToSave));
  } catch (error) {
    console.error('Error saving plugin builder state:', error);
  }
};

const persistedState = loadPersistedState();

export default {
  namespaced: true,
  state: {
    // User input
    pluginDescription: persistedState?.pluginDescription || '',

    // Generation state
    isGenerating: false,
    generationProgress: null, // 'manifest' | 'code' | 'package' | 'complete'
    generationError: null,

    // Generated files
    generatedManifest: persistedState?.generatedManifest || null,
    generatedCode: persistedState?.generatedCode || {}, // { 'tool-name.js': '...' }
    generatedPackageJson: persistedState?.generatedPackageJson || null,

    // Build state
    isBuilding: false,
    buildProgress: null,
    buildResult: null,
    buildError: null,

    // Conversation for iterative refinement (chat-based approach)
    conversation: persistedState?.conversation || [],
    isStreaming: false,

    // Preview/Edit state
    activePreviewFile: null, // Which file is being previewed/edited
    editedFiles: {}, // Track user edits: { 'manifest.json': '...', 'tool.js': '...' }
  },

  mutations: {
    SET_PLUGIN_DESCRIPTION(state, description) {
      state.pluginDescription = description;
      saveState(state);
    },

    SET_GENERATING(state, isGenerating) {
      state.isGenerating = isGenerating;
      if (isGenerating) {
        state.generationError = null;
      }
    },

    SET_GENERATION_PROGRESS(state, progress) {
      state.generationProgress = progress;
    },

    SET_GENERATION_ERROR(state, error) {
      state.generationError = error;
      state.isGenerating = false;
    },

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

    ADD_CONVERSATION_MESSAGE(state, message) {
      state.conversation.push(message);
      saveState(state);
    },

    UPDATE_CONVERSATION_MESSAGE(state, { messageId, content }) {
      const message = state.conversation.find((m) => m.id === messageId);
      if (message) {
        message.content = content;
        saveState(state);
      }
    },

    APPEND_CONVERSATION_MESSAGE(state, { messageId, delta }) {
      const message = state.conversation.find((m) => m.id === messageId);
      if (message) {
        message.content = (message.content || '') + delta;
      }
    },

    CLEAR_CONVERSATION(state) {
      state.conversation = [];
      saveState(state);
    },

    SET_STREAMING(state, isStreaming) {
      state.isStreaming = isStreaming;
    },

    SET_ACTIVE_PREVIEW_FILE(state, fileName) {
      state.activePreviewFile = fileName;
    },

    SET_EDITED_FILE(state, { fileName, content }) {
      state.editedFiles = { ...state.editedFiles, [fileName]: content };
    },

    CLEAR_EDITED_FILES(state) {
      state.editedFiles = {};
    },

    RESET_GENERATION(state) {
      state.generatedManifest = null;
      state.generatedCode = {};
      state.generatedPackageJson = null;
      state.generationProgress = null;
      state.generationError = null;
      state.buildResult = null;
      state.buildError = null;
      state.editedFiles = {};
      state.activePreviewFile = null;
      saveState(state);
    },

    RESET_ALL(state) {
      state.pluginDescription = '';
      state.isGenerating = false;
      state.generationProgress = null;
      state.generationError = null;
      state.generatedManifest = null;
      state.generatedCode = {};
      state.generatedPackageJson = null;
      state.isBuilding = false;
      state.buildProgress = null;
      state.buildResult = null;
      state.buildError = null;
      state.conversation = [];
      state.isStreaming = false;
      state.activePreviewFile = null;
      state.editedFiles = {};
      localStorage.removeItem('pluginBuilderState');
    },
  },

  getters: {
    // Get the effective content for a file (edited version or generated)
    getFileContent: (state) => (fileName) => {
      if (state.editedFiles[fileName] !== undefined) {
        return state.editedFiles[fileName];
      }
      if (fileName === 'manifest.json' && state.generatedManifest) {
        return JSON.stringify(state.generatedManifest, null, 2);
      }
      if (fileName === 'package.json' && state.generatedPackageJson) {
        return JSON.stringify(state.generatedPackageJson, null, 2);
      }
      return state.generatedCode[fileName] || '';
    },

    // Get list of all generated files
    generatedFiles: (state) => {
      const files = [];
      if (state.generatedManifest) {
        files.push({ name: 'manifest.json', type: 'json', icon: 'file-code' });
      }
      Object.keys(state.generatedCode).forEach((fileName) => {
        files.push({ name: fileName, type: 'javascript', icon: 'file-code' });
      });
      if (state.generatedPackageJson) {
        files.push({ name: 'package.json', type: 'json', icon: 'file-code' });
      }
      return files;
    },

    // Check if generation is complete
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
  },

  actions: {
    setPluginDescription({ commit }, description) {
      commit('SET_PLUGIN_DESCRIPTION', description);
    },

    /**
     * Generate a plugin from the description
     * This calls the backend API which uses the global AI provider
     */
    async generatePlugin({ commit, state, rootState }, { description, options = {} } = {}) {
      const pluginDescription = description || state.pluginDescription;
      if (!pluginDescription) {
        commit('SET_GENERATION_ERROR', 'Please provide a plugin description');
        return { success: false, error: 'No description provided' };
      }

      commit('SET_GENERATING', true);
      commit('RESET_GENERATION');

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        // Get the selected AI provider and model from the store
        const provider = rootState.aiProvider.selectedProvider;
        const model = rootState.aiProvider.selectedModel;

        const { API_CONFIG } = await import('@/tt.config.js');

        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/generate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: pluginDescription,
            provider: provider?.toLowerCase(),
            model,
            options,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Generation failed: ${response.statusText}`);
        }

        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('event:')) continue;

            const eventMatch = line.match(/event: (\w+)\ndata: (.+)/s);
            if (!eventMatch) continue;

            const [, eventType, eventData] = eventMatch;
            const data = JSON.parse(eventData);

            switch (eventType) {
              case 'progress':
                commit('SET_GENERATION_PROGRESS', data.step);
                break;
              case 'manifest':
                commit('SET_GENERATED_MANIFEST', data);
                break;
              case 'code':
                commit('SET_GENERATED_CODE', { fileName: data.file, code: data.code });
                break;
              case 'package':
                commit('SET_GENERATED_PACKAGE_JSON', data);
                break;
              case 'error':
                throw new Error(data.error || 'Generation failed');
              case 'complete':
                commit('SET_GENERATION_PROGRESS', 'complete');
                break;
            }
          }
        }

        commit('SET_GENERATING', false);
        return { success: true };
      } catch (error) {
        console.error('Plugin generation error:', error);
        commit('SET_GENERATION_ERROR', error.message);
        return { success: false, error: error.message };
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
        if (state.editedFiles['manifest.json']) {
          manifest = JSON.parse(state.editedFiles['manifest.json']);
        }

        const toolCode = {};
        for (const fileName of Object.keys(state.generatedCode)) {
          toolCode[fileName] = getters.getFileContent(fileName);
        }

        let packageJson = state.generatedPackageJson;
        if (state.editedFiles['package.json']) {
          packageJson = JSON.parse(state.editedFiles['package.json']);
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

        commit('SET_BUILD_PROGRESS', 'complete');
        commit('SET_BUILD_RESULT', result);

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
     * Reset all state
     */
    resetAll({ commit }) {
      commit('RESET_ALL');
    },

    /**
     * Add a message to the conversation (for chat-based refinement)
     */
    addConversationMessage({ commit }, message) {
      commit('ADD_CONVERSATION_MESSAGE', message);
    },

    /**
     * Clear the conversation
     */
    clearConversation({ commit }) {
      commit('CLEAR_CONVERSATION');
    },

    /**
     * Load an installed plugin for editing
     */
    async loadPluginForEditing({ commit, dispatch }, pluginName) {
      commit('RESET_ALL'); // Start fresh

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
        if (files['manifest.json']) {
          const manifest = JSON.parse(files['manifest.json']);
          commit('SET_GENERATED_MANIFEST', manifest);
          commit('SET_PLUGIN_DESCRIPTION', manifest.description || '');
          delete files['manifest.json'];
        }

        // Parse package.json
        if (files['package.json']) {
          commit('SET_GENERATED_PACKAGE_JSON', JSON.parse(files['package.json']));
          delete files['package.json'];
        }

        // Rest are code files
        commit('SET_ALL_GENERATED_CODE', files);

        // Set state to "complete" so preview shows up
        commit('SET_GENERATION_PROGRESS', 'complete');

        return { success: true };
      } catch (error) {
        console.error('Error loading plugin:', error);
        commit('SET_GENERATION_ERROR', error.message);
        return { success: false, error: error.message };
      }
    },

    /**
     * Regenerate the entire plugin with AI based on instructions
     * Gathers current effective files and calls the /regenerate SSE endpoint
     */
    async regeneratePlugin({ commit, state, getters, rootState }, { instructions }) {
      if (!instructions) {
        commit('SET_GENERATION_ERROR', 'Please provide instructions');
        return { success: false, error: 'No instructions provided' };
      }

      // Add user message to conversation history immediately so it's visible
      commit('ADD_CONVERSATION_MESSAGE', {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: instructions,
        timestamp: new Date().toISOString(),
      });

      commit('SET_GENERATING', true);
      commit('SET_GENERATION_PROGRESS', null);
      commit('SET_GENERATION_ERROR', null);

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const provider = rootState.aiProvider.selectedProvider;
        const model = rootState.aiProvider.selectedModel;

        // Gather current effective files (edited versions take priority)
        let currentManifest = state.generatedManifest;
        if (state.editedFiles['manifest.json']) {
          currentManifest = JSON.parse(state.editedFiles['manifest.json']);
        }

        const currentCode = {};
        for (const fileName of Object.keys(state.generatedCode)) {
          currentCode[fileName] = getters.getFileContent(fileName);
        }

        let currentPackageJson = state.generatedPackageJson;
        if (state.editedFiles['package.json']) {
          currentPackageJson = JSON.parse(state.editedFiles['package.json']);
        }

        // Build conversation history (just the instruction strings) for LLM context
        const conversationHistory = state.conversation
          .filter((m) => m.role === 'user')
          .slice(0, -1) // Exclude current message (already in `instructions`)
          .map((m) => m.content);

        const { API_CONFIG } = await import('@/tt.config.js');

        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/regenerate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instructions,
            currentManifest,
            currentCode,
            currentPackageJson,
            conversationHistory,
            provider: provider?.toLowerCase(),
            model,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Regeneration failed: ${response.statusText}`);
        }

        // Handle streaming response (same SSE format as generatePlugin)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Don't clear generated code here — it would make isGenerationComplete false
        // and flip the UI back to the description screen. Each SET_GENERATED_CODE
        // call below will overwrite files as they stream in.

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('event:')) continue;

            const eventMatch = line.match(/event: (\w+)\ndata: (.+)/s);
            if (!eventMatch) continue;

            const [, eventType, eventData] = eventMatch;
            const data = JSON.parse(eventData);

            switch (eventType) {
              case 'progress':
                commit('SET_GENERATION_PROGRESS', data.step);
                break;
              case 'manifest':
                commit('SET_GENERATED_MANIFEST', data);
                break;
              case 'code':
                commit('SET_GENERATED_CODE', { fileName: data.file, code: data.code });
                break;
              case 'package':
                commit('SET_GENERATED_PACKAGE_JSON', data);
                break;
              case 'error':
                throw new Error(data.error || 'Regeneration failed');
              case 'complete':
                commit('SET_GENERATION_PROGRESS', 'complete');
                break;
            }
          }
        }

        // Clear user edits since regeneration replaces everything
        commit('CLEAR_EDITED_FILES');
        commit('SET_GENERATING', false);

        // Add success message to conversation
        commit('ADD_CONVERSATION_MESSAGE', {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: 'Plugin regenerated successfully.',
          timestamp: new Date().toISOString(),
        });

        return { success: true };
      } catch (error) {
        console.error('Plugin regeneration error:', error);
        commit('SET_GENERATION_ERROR', error.message);

        // Add error message to conversation
        commit('ADD_CONVERSATION_MESSAGE', {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: `Regeneration failed: ${error.message}`,
          timestamp: new Date().toISOString(),
        });

        return { success: false, error: error.message };
      }
    },

    /**
     * Regenerate a specific file with AI
     */
    async regenerateFile({ commit, state, rootState }, { fileName, instructions }) {
      commit('SET_GENERATING', true);

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const provider = rootState.aiProvider.selectedProvider;
        const model = rootState.aiProvider.selectedModel;

        const { API_CONFIG } = await import('@/tt.config.js');

        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/regenerate-file`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName,
            instructions,
            currentManifest: state.generatedManifest,
            currentCode: state.generatedCode,
            provider: provider?.toLowerCase(),
            model,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Regeneration failed: ${response.statusText}`);
        }

        const result = await response.json();

        if (fileName === 'manifest.json') {
          commit('SET_GENERATED_MANIFEST', result.content);
        } else if (fileName === 'package.json') {
          commit('SET_GENERATED_PACKAGE_JSON', result.content);
        } else {
          commit('SET_GENERATED_CODE', { fileName, code: result.content });
        }

        // Clear any user edits for this file since we regenerated it
        if (state.editedFiles[fileName]) {
          const newEditedFiles = { ...state.editedFiles };
          delete newEditedFiles[fileName];
          commit('CLEAR_EDITED_FILES');
          Object.entries(newEditedFiles).forEach(([name, content]) => {
            commit('SET_EDITED_FILE', { fileName: name, content });
          });
        }

        commit('SET_GENERATING', false);
        return { success: true };
      } catch (error) {
        console.error('File regeneration error:', error);
        commit('SET_GENERATION_ERROR', error.message);
        return { success: false, error: error.message };
      }
    },
  },
};
