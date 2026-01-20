import { API_CONFIG } from "@/tt.config.js";

const state = {
  templates: [],
  categories: ['All', 'Business', 'Technical', 'Creative', 'Personal', 'Custom'],
  isLoading: false,
  error: null,
  lastUpdated: null,
};

const getters = {
  allTemplates: (state) => state.templates,
  categories: (state) => state.categories,
  
  templatesByCategory: (state) => (category) => {
    if (category === 'All') return state.templates;
    return state.templates.filter(template => template.category === category);
  },
  
  popularTemplates: (state) => {
    return state.templates
      .filter(template => template.stats?.usageCount > 0)
      .sort((a, b) => (b.stats?.usageCount || 0) - (a.stats?.usageCount || 0))
      .slice(0, 10);
  },
  
  recentTemplates: (state) => {
    return state.templates
      .filter(template => template.createdAt)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);
  },
  
  userTemplates: (state) => (userId) => {
    return state.templates.filter(template => template.createdBy === userId);
  },
  
  getTemplateById: (state) => (id) => {
    return state.templates.find(template => template.id === id);
  },
  
  searchTemplates: (state) => (query) => {
    const searchTerm = query.toLowerCase();
    return state.templates.filter(template => 
      template.title.toLowerCase().includes(searchTerm) ||
      template.description.toLowerCase().includes(searchTerm) ||
      template.tags.some(tag => tag.toLowerCase().includes(searchTerm))
    );
  },
  
  isLoading: (state) => state.isLoading,
  error: (state) => state.error,
  lastUpdated: (state) => state.lastUpdated,
};

const mutations = {
  SET_LOADING(state, loading) {
    state.isLoading = loading;
  },
  
  SET_ERROR(state, error) {
    state.error = error;
  },
  
  SET_TEMPLATES(state, templates) {
    state.templates = templates;
    state.lastUpdated = new Date().toISOString();
  },
  
  ADD_TEMPLATE(state, template) {
    const existingIndex = state.templates.findIndex(t => t.id === template.id);
    if (existingIndex !== -1) {
      state.templates.splice(existingIndex, 1, template);
    } else {
      state.templates.unshift(template);
    }
  },
  
  UPDATE_TEMPLATE(state, updatedTemplate) {
    const index = state.templates.findIndex(t => t.id === updatedTemplate.id);
    if (index !== -1) {
      state.templates.splice(index, 1, { ...state.templates[index], ...updatedTemplate });
    }
  },
  
  REMOVE_TEMPLATE(state, templateId) {
    const index = state.templates.findIndex(t => t.id === templateId);
    if (index !== -1) {
      state.templates.splice(index, 1);
    }
  },
  
  UPDATE_TEMPLATE_STATS(state, { templateId, stats }) {
    const template = state.templates.find(t => t.id === templateId);
    if (template) {
      template.stats = { ...template.stats, ...stats };
    }
  },
  
  ADD_CATEGORY(state, category) {
    if (!state.categories.includes(category)) {
      state.categories.push(category);
    }
  },
};

const actions = {
  async fetchTemplates({ commit }) {
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);
    
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goal-templates`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch goal templates");

      const data = await response.json();
      commit('SET_TEMPLATES', data.templates || []);
      
    } catch (error) {
      console.error("Error fetching goal templates:", error);
      commit('SET_ERROR', error.message);
      
      // Set default templates if fetch fails
      commit('SET_TEMPLATES', getDefaultTemplates());
    } finally {
      commit('SET_LOADING', false);
    }
  },

  async createTemplate({ commit }, templateData) {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goal-templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(templateData),
      });

      if (!response.ok) throw new Error("Failed to create goal template");

      const data = await response.json();
      commit('ADD_TEMPLATE', data.template);
      
      return data.template;
    } catch (error) {
      console.error("Error creating goal template:", error);
      commit('SET_ERROR', error.message);
      throw error;
    }
  },

  async updateTemplate({ commit }, { templateId, updates }) {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goal-templates/${templateId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error("Failed to update goal template");

      const data = await response.json();
      commit('UPDATE_TEMPLATE', data.template);
      
      return data.template;
    } catch (error) {
      console.error("Error updating goal template:", error);
      commit('SET_ERROR', error.message);
      throw error;
    }
  },

  async deleteTemplate({ commit }, templateId) {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goal-templates/${templateId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to delete goal template");

      commit('REMOVE_TEMPLATE', templateId);
      
    } catch (error) {
      console.error("Error deleting goal template:", error);
      commit('SET_ERROR', error.message);
      throw error;
    }
  },

  async saveGoalAsTemplate({ commit, dispatch }, { goal, templateData }) {
    try {
      const template = {
        title: templateData.title || goal.title,
        description: templateData.description || goal.description,
        category: templateData.category || 'Custom',
        tags: templateData.tags || [],
        template: goal.description,
        icon: templateData.icon || 'fas fa-bookmark',
        isPublic: templateData.isPublic || false,
        sourceGoalId: goal.id,
        taskStructure: goal.tasks?.map(task => ({
          title: task.title,
          description: task.description,
          requiredTools: task.required_tools,
          estimatedDuration: task.estimatedDuration || 30
        })) || [],
        successCriteria: goal.successCriteria,
        stats: {
          usageCount: 0,
          successRate: 0,
          avgCompletionTime: 0
        }
      };

      const createdTemplate = await dispatch('createTemplate', template);
      return createdTemplate;
    } catch (error) {
      console.error("Error saving goal as template:", error);
      throw error;
    }
  },

  async useTemplate({ dispatch }, { template, customizations = {} }) {
    try {
      // Create a goal from the template
      const goalData = {
        text: customizations.description || template.template,
        priority: customizations.priority || 'medium',
        type: 'template',
        templateId: template.id,
        ...customizations
      };

      // Track template usage
      await dispatch('trackTemplateUsage', template.id);

      return goalData;
    } catch (error) {
      console.error("Error using template:", error);
      throw error;
    }
  },

  async trackTemplateUsage({ commit }, templateId) {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const response = await fetch(`${API_CONFIG.BASE_URL}/goal-templates/${templateId}/use`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        commit('UPDATE_TEMPLATE_STATS', {
          templateId,
          stats: data.stats
        });
      }
    } catch (error) {
      console.error("Error tracking template usage:", error);
    }
  },

  async generatePersonalizedTemplates({ commit, rootGetters }) {
    try {
      const token = localStorage.getItem("token");
      if (!token) return [];

      // Get user's goal history for personalization
      const userGoals = rootGetters['goals/allGoals'] || [];
      const completedGoals = userGoals.filter(goal => goal.status === 'completed');

      const response = await fetch(`${API_CONFIG.BASE_URL}/goal-templates/generate-personalized`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userGoals: completedGoals.map(goal => ({
            title: goal.title,
            description: goal.description,
            category: goal.category,
            completionTime: goal.completionTime,
            successRate: goal.successRate
          }))
        }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      
      // Add generated templates to store
      data.templates?.forEach(template => {
        commit('ADD_TEMPLATE', {
          ...template,
          category: 'Personal',
          isPersonalized: true,
          createdAt: new Date().toISOString()
        });
      });

      return data.templates || [];
    } catch (error) {
      console.error("Error generating personalized templates:", error);
      return [];
    }
  },

  async importTemplate({ commit }, templateData) {
    try {
      // Validate template structure
      if (!templateData.title || !templateData.template) {
        throw new Error("Invalid template structure");
      }

      const template = {
        ...templateData,
        id: `imported-${Date.now()}`,
        category: templateData.category || 'Custom',
        isImported: true,
        createdAt: new Date().toISOString(),
        stats: {
          usageCount: 0,
          successRate: 0,
          avgCompletionTime: 0
        }
      };

      commit('ADD_TEMPLATE', template);
      return template;
    } catch (error) {
      console.error("Error importing template:", error);
      throw error;
    }
  },

  async exportTemplate({ state }, templateId) {
    try {
      const template = state.templates.find(t => t.id === templateId);
      if (!template) {
        throw new Error("Template not found");
      }

      // Create exportable template data
      const exportData = {
        title: template.title,
        description: template.description,
        category: template.category,
        tags: template.tags,
        template: template.template,
        icon: template.icon,
        taskStructure: template.taskStructure,
        successCriteria: template.successCriteria,
        exportedAt: new Date().toISOString(),
        version: "1.0"
      };

      return exportData;
    } catch (error) {
      console.error("Error exporting template:", error);
      throw error;
    }
  },

  async duplicateTemplate({ dispatch }, templateId) {
    try {
      const template = await dispatch('getTemplateById', templateId);
      if (!template) {
        throw new Error("Template not found");
      }

      const duplicatedTemplate = {
        ...template,
        id: undefined, // Let the server generate a new ID
        title: `${template.title} (Copy)`,
        isPublic: false,
        createdAt: new Date().toISOString(),
        stats: {
          usageCount: 0,
          successRate: 0,
          avgCompletionTime: 0
        }
      };

      return await dispatch('createTemplate', duplicatedTemplate);
    } catch (error) {
      console.error("Error duplicating template:", error);
      throw error;
    }
  },
};

// Helper function to get default templates
function getDefaultTemplates() {
  return [
    {
      id: 'default-1',
      title: 'Content Creation',
      description: 'Create blog posts, articles, or documentation',
      category: 'Creative',
      tags: ['writing', 'content', 'research'],
      template: 'Write a comprehensive blog post about [TOPIC] including research, examples, and actionable insights for [TARGET_AUDIENCE]',
      icon: 'fas fa-pen',
      isPublic: true,
      isDefault: true,
      taskStructure: [
        {
          title: 'Research Topic',
          description: 'Gather information and research about the topic',
          requiredTools: ['generate-with-ai-llm'],
          estimatedDuration: 45
        },
        {
          title: 'Create Outline',
          description: 'Structure the content with a clear outline',
          requiredTools: ['generate-with-ai-llm'],
          estimatedDuration: 30
        },
        {
          title: 'Write Content',
          description: 'Write the full blog post with examples',
          requiredTools: ['generate-with-ai-llm'],
          estimatedDuration: 90
        },
        {
          title: 'Review and Edit',
          description: 'Review content for quality and accuracy',
          requiredTools: ['content-output'],
          estimatedDuration: 30
        }
      ],
      stats: { usageCount: 45, successRate: 92, avgCompletionTime: 2.5 },
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'default-2',
      title: 'Market Research',
      description: 'Analyze markets, competitors, and trends',
      category: 'Business',
      tags: ['research', 'analysis', 'business'],
      template: 'Conduct thorough market research on [INDUSTRY/PRODUCT] including competitor analysis, market size, trends, and opportunities',
      icon: 'fas fa-chart-line',
      isPublic: true,
      isDefault: true,
      taskStructure: [
        {
          title: 'Market Analysis',
          description: 'Analyze market size, trends, and opportunities',
          requiredTools: ['generate-with-ai-llm'],
          estimatedDuration: 60
        },
        {
          title: 'Competitor Research',
          description: 'Research and analyze key competitors',
          requiredTools: ['generate-with-ai-llm'],
          estimatedDuration: 90
        },
        {
          title: 'Compile Report',
          description: 'Create comprehensive market research report',
          requiredTools: ['generate-with-ai-llm', 'content-output'],
          estimatedDuration: 60
        }
      ],
      stats: { usageCount: 32, successRate: 88, avgCompletionTime: 4.2 },
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'default-3',
      title: 'Technical Documentation',
      description: 'Create technical guides and documentation',
      category: 'Technical',
      tags: ['technical', 'documentation', 'development'],
      template: 'Create comprehensive technical documentation for [SYSTEM/API] including setup guides, examples, and troubleshooting',
      icon: 'fas fa-code',
      isPublic: true,
      isDefault: true,
      taskStructure: [
        {
          title: 'Analyze System',
          description: 'Understand the system architecture and components',
          requiredTools: ['generate-with-ai-llm'],
          estimatedDuration: 60
        },
        {
          title: 'Create Documentation',
          description: 'Write comprehensive technical documentation',
          requiredTools: ['generate-with-ai-llm'],
          estimatedDuration: 120
        },
        {
          title: 'Add Examples',
          description: 'Include code examples and use cases',
          requiredTools: ['execute-javascript', 'content-output'],
          estimatedDuration: 90
        }
      ],
      stats: { usageCount: 28, successRate: 90, avgCompletionTime: 3.8 },
      createdAt: '2024-01-01T00:00:00Z'
    }
  ];
}

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
}; 