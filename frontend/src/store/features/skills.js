import { API_CONFIG } from '@/tt.config.js';

export default {
  namespaced: true,
  state: {
    skills: [],
    isLoading: false,
    error: null,
    categories: ['general', 'support', 'development', 'marketing', 'productivity', 'communication', 'analytics', 'finance', 'design', 'sales'],
  },
  mutations: {
    SET_SKILLS(state, skills) {
      state.skills = skills || [];
    },
    ADD_SKILL(state, skill) {
      state.skills.push(skill);
    },
    UPDATE_SKILL(state, updated) {
      const index = state.skills.findIndex((s) => s.id === updated.id);
      if (index !== -1) state.skills.splice(index, 1, updated);
    },
    DELETE_SKILL(state, id) {
      state.skills = state.skills.filter((s) => s.id !== id);
    },
    SET_LOADING(state, val) {
      state.isLoading = val;
    },
    SET_ERROR(state, err) {
      state.error = err;
    },
  },
  actions: {
    async fetchSkills({ commit }) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await fetch(`${API_CONFIG.BASE_URL}/skills/`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        commit('SET_SKILLS', data.skills || []);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async createSkill({ commit }, skillData) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await fetch(`${API_CONFIG.BASE_URL}/skills/`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ skill: skillData }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (data.skill) commit('ADD_SKILL', data.skill);
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async updateSkill({ commit }, { id, skill }) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await fetch(`${API_CONFIG.BASE_URL}/skills/${id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ skill }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (data.skill) commit('UPDATE_SKILL', data.skill);
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async deleteSkill({ commit }, id) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await fetch(`${API_CONFIG.BASE_URL}/skills/${id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        commit('DELETE_SKILL', id);
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async importSkillMd({ commit, dispatch }, content) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await fetch(`${API_CONFIG.BASE_URL}/skills/import`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.skill) commit('ADD_SKILL', data.skill);
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async exportSkillMd(_, skillId) {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await fetch(`${API_CONFIG.BASE_URL}/skills/${skillId}/export`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.text();
      } catch (error) {
        throw error;
      }
    },
  },
  getters: {
    allSkills: (state) => state.skills,
    getSkillById: (state) => (id) => state.skills.find((s) => s.id === id),
    isLoading: (state) => state.isLoading,
    skillCategories: (state) => {
      // Combine hardcoded categories with any categories found in existing skills
      const skillCats = state.skills.map((s) => s.category || 'general').filter(Boolean);
      const allCats = new Set([...state.categories, ...skillCats]);
      return [...allCats].sort();
    },
  },
};
