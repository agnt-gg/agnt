import { API_CONFIG } from '@/tt.config.js';

const BUILT_IN_TOOLS = [
  {
    id: 'web_search',
    name: 'Web Search',
    description: 'Performs a web search to find up-to-date information.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'web_scrape',
    name: 'Web Scraper',
    description: 'Scrapes content from a given URL to extract text.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'execute_javascript_code',
    name: 'JavaScript Code Execution',
    description: 'Executes arbitrary JavaScript code in a sandboxed environment.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'execute_shell_command',
    name: 'Shell Command Execution',
    description: 'Executes shell commands in a specified directory.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'file_operations',
    name: 'File System Operations',
    description: 'Allows for reading, writing, and listing files on the local file system.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'agnt_agents',
    name: 'AGNT: Agent Management',
    description: 'Manages AGNT agents, allowing creation, listing, and updating.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'agnt_workflows',
    name: 'AGNT: Workflow Management',
    description: 'Manages AGNT workflows, including creation, listing, and execution.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'agnt_tools',
    name: 'AGNT: Tool Management',
    description: 'Manages custom AGNT tools.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'agnt_goals',
    name: 'AGNT: Goal Management',
    description: 'Manages user goals, allowing creation, execution, and tracking.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'agnt_auth',
    name: 'AGNT: Authentication Management',
    description: 'Manages authentication providers and API keys.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'execute_custom_agnt_tool',
    name: 'Execute Custom AGNT Tool',
    description: 'Executes a specific custom tool by its ID with given parameters.',
    category: 'actions',
    is_builtin: true,
  },
  {
    id: 'send_email',
    name: 'Send Email',
    description: 'Sends emails using a pre-configured SMTP server.',
    category: 'actions',
    is_builtin: true,
  },
];

export default {
  namespaced: true,
  state: {
    tools: [],
    // Workflow tools (triggers, actions, utilities, widgets, controls, custom)
    // This is the centralized source for all workflow-related tool data
    workflowTools: null,
    workflowToolsLoading: false,
    workflowToolsLastFetched: null,
    // Request deduplication flags
    isFetchingTools: false,
    isFetchingWorkflowTools: false,
    categories: ['triggers', 'actions', 'utilities', 'widgets', 'controls', 'plugins', 'custom'],
    isLoading: false,
    error: null,
    lastFetched: null,
  },
  mutations: {
    SET_TOOLS(state, tools) {
      state.tools = tools;
    },
    ADD_TOOL(state, tool) {
      state.tools.push(tool);
    },
    UPDATE_TOOL(state, updatedTool) {
      const index = state.tools.findIndex((tool) => tool.id === updatedTool.id);
      if (index !== -1) {
        state.tools.splice(index, 1, updatedTool);
      }
    },
    DELETE_TOOL(state, toolId) {
      state.tools = state.tools.filter((tool) => tool.id !== toolId);
    },
    SET_LOADING(state, isLoading) {
      state.isLoading = isLoading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    SET_LAST_FETCHED(state, timestamp) {
      state.lastFetched = timestamp;
    },
    CLEAR_TOOLS(state) {
      state.tools = [];
      state.isLoading = false;
      state.error = null;
      state.lastFetched = null;
    },
    SET_FETCHING_TOOLS(state, isFetching) {
      state.isFetchingTools = isFetching;
    },
    SET_FETCHING_WORKFLOW_TOOLS(state, isFetching) {
      state.isFetchingWorkflowTools = isFetching;
    },
    // Workflow tools mutations
    SET_WORKFLOW_TOOLS(state, tools) {
      state.workflowTools = tools;
    },
    SET_WORKFLOW_TOOLS_LOADING(state, isLoading) {
      state.workflowToolsLoading = isLoading;
    },
    SET_WORKFLOW_TOOLS_LAST_FETCHED(state, timestamp) {
      state.workflowToolsLastFetched = timestamp;
    },
  },
  actions: {
    async fetchTools({ commit, state }, { force = false } = {}) {
      // Request deduplication - prevent duplicate concurrent calls
      if (state.isFetchingTools) {
        return;
      }

      // Only fetch if tools is empty or lastFetched > 5 min ago, unless force is true
      const now = Date.now();
      if (!force && state.tools.length > 0 && state.lastFetched && now - state.lastFetched < 5 * 60 * 1000) {
        // Use cache, skip fetch
        return;
      }

      commit('SET_FETCHING_TOOLS', true);
      commit('SET_LOADING', true);
      commit('SET_ERROR', null);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        // Fetch both orchestrator tools and custom tools
        const [orchestratorResponse, customToolsResponse] = await Promise.all([
          fetch(`${API_CONFIG.BASE_URL}/tools/orchestrator-tools`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_CONFIG.BASE_URL}/custom-tools/`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (!orchestratorResponse.ok) {
          throw new Error(`HTTP error fetching orchestrator tools! status: ${orchestratorResponse.status}`);
        }
        if (!customToolsResponse.ok) {
          throw new Error(`HTTP error fetching custom tools! status: ${customToolsResponse.status}`);
        }

        const orchestratorData = await orchestratorResponse.json();
        const customToolsData = await customToolsResponse.json();

        const orchestratorTools = orchestratorData.tools || [];
        const customTools = customToolsData.tools || [];

        // Combine orchestrator and custom tools, ensuring no ID conflicts
        const toolMap = new Map();

        // Add orchestrator tools first (these are the full suite from the orchestrator)
        // This includes native tools, registry tools, AND plugin tools
        orchestratorTools.forEach((tool) => {
          // Preserve is_builtin and is_plugin flags from backend
          // Plugin tools have is_builtin: false and is_plugin: true
          toolMap.set(tool.id, {
            ...tool,
            title: tool.title || tool.name,
            is_builtin: tool.is_builtin !== undefined ? tool.is_builtin : true,
            is_plugin: tool.is_plugin || false,
            plugin_name: tool.plugin_name || null,
          });
        });

        // Add custom tools, but don't overwrite if an ID conflicts with an orchestrator tool
        customTools.forEach((tool) => {
          if (!toolMap.has(tool.id)) {
            // Ensure custom tools have is_builtin: false and a consistent 'title'
            toolMap.set(tool.id, { ...tool, title: tool.title || tool.name, is_builtin: false });
          } else {
            console.warn(`Custom tool with ID "${tool.id}" conflicts with an orchestrator tool. The orchestrator tool will be used.`);
          }
        });

        const combinedTools = Array.from(toolMap.values());

        console.log('[DEBUG] Fetched and combined tools:', combinedTools);
        commit('SET_TOOLS', combinedTools);
        commit('SET_LAST_FETCHED', now);
      } catch (error) {
        console.error('Error fetching tools:', error);
        commit('SET_ERROR', error.message);
        // On error, still provide the essential built-in tools to the UI
        commit('SET_TOOLS', BUILT_IN_TOOLS);
      } finally {
        commit('SET_LOADING', false);
        commit('SET_FETCHING_TOOLS', false);
      }
    },
    /**
     * Refresh all tools - force refresh both regular tools and workflow tools
     * Call this after plugin install/uninstall to update all tool lists
     */
    async refreshAllTools({ dispatch }) {
      console.log('[Tools Store] Refreshing all tools after plugin change...');
      await Promise.all([dispatch('fetchTools', { force: true }), dispatch('fetchWorkflowTools', { force: true })]);
      console.log('[Tools Store] All tools refreshed');
    },

    /**
     * Fetch workflow tools from backend (triggers, actions, utilities, widgets, controls, custom)
     * This is the CENTRALIZED source for all workflow-related tool data.
     * All components should use this instead of importing toolLibrary directly.
     */
    async fetchWorkflowTools({ commit, state }, { force = false } = {}) {
      // Request deduplication - prevent duplicate concurrent calls
      if (state.isFetchingWorkflowTools) {
        return state.workflowTools;
      }

      const now = Date.now();
      // Cache for 5 minutes unless force refresh
      if (!force && state.workflowTools && state.workflowToolsLastFetched && now - state.workflowToolsLastFetched < 5 * 60 * 1000) {
        return state.workflowTools;
      }

      commit('SET_FETCHING_WORKFLOW_TOOLS', true);
      commit('SET_WORKFLOW_TOOLS_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/tools/workflow-tools`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const tools = await response.json();
        console.log('🔧 Vuex Store: Fetched workflow tools from backend:', {
          triggers: tools.triggers?.length || 0,
          actions: tools.actions?.length || 0,
          utilities: tools.utilities?.length || 0,
          widgets: tools.widgets?.length || 0,
          controls: tools.controls?.length || 0,
          custom: tools.custom?.length || 0,
        });

        commit('SET_WORKFLOW_TOOLS', tools);
        commit('SET_WORKFLOW_TOOLS_LAST_FETCHED', now);
        return tools;
      } catch (error) {
        console.error('Error fetching workflow tools:', error);
        // Return empty structure on error
        const emptyTools = {
          triggers: [],
          actions: [],
          utilities: [],
          widgets: [],
          controls: [],
          custom: [],
        };
        commit('SET_WORKFLOW_TOOLS', emptyTools);
        return emptyTools;
      } finally {
        commit('SET_WORKFLOW_TOOLS_LOADING', false);
        commit('SET_FETCHING_WORKFLOW_TOOLS', false);
      }
    },
    async createTool({ commit, state }, tool) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-tools/`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(tool),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const newTool = {
          ...data.tool,
          title: data.tool.title || data.tool.name,
          is_builtin: false,
        };

        commit('ADD_TOOL', newTool);
        return newTool;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
  },
  getters: {
    allTools: (state) => state.tools,
    customTools: (state) => state.tools.filter((tool) => !tool.is_builtin && !tool.is_plugin),
    pluginTools: (state) => state.tools.filter((tool) => tool.is_plugin),
    builtinTools: (state) => state.tools.filter((tool) => tool.is_builtin && !tool.is_plugin),
    // Get unique installed plugins from plugin tools (grouped by plugin_name)
    installedPlugins: (state) => {
      const pluginMap = new Map();
      state.tools
        .filter((tool) => tool.is_plugin && tool.plugin_name)
        .forEach((tool) => {
          if (!pluginMap.has(tool.plugin_name)) {
            pluginMap.set(tool.plugin_name, {
              id: tool.plugin_name,
              name: tool.plugin_name,
              displayName: tool.plugin_display_name || tool.plugin_name,
              description: tool.plugin_description || `Plugin: ${tool.plugin_name}`,
              version: tool.plugin_version || '1.0.0',
              icon: tool.plugin_icon || tool.icon || 'puzzle-piece',
              tools: [],
            });
          }
          pluginMap.get(tool.plugin_name).tools.push({
            type: tool.type || tool.id,
            schema: {
              title: tool.title || tool.name,
              description: tool.description,
            },
          });
        });
      return Array.from(pluginMap.values());
    },
    getToolById: (state) => (id) => state.tools.find((tool) => tool.id === id),
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
    toolCategories: (state) => state.categories,
    toolsByCategory: (state) => (category) => state.tools.filter((tool) => tool.category === category),
    // Workflow tools getters - CENTRALIZED source for all workflow tool data
    workflowTools: (state) => state.workflowTools,
    workflowToolsLoading: (state) => state.workflowToolsLoading,
    // Convenience getters for specific workflow tool categories
    workflowTriggers: (state) => state.workflowTools?.triggers || [],
    workflowActions: (state) => state.workflowTools?.actions || [],
    workflowUtilities: (state) => state.workflowTools?.utilities || [],
    workflowWidgets: (state) => state.workflowTools?.widgets || [],
    workflowControls: (state) => state.workflowTools?.controls || [],
    workflowCustomTools: (state) => state.workflowTools?.custom || [],
  },
};
