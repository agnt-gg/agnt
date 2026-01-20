import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

export default {
  namespaced: true,
  state: {
    guildId: null,
    guildName: null,
    guildLevel: 1,
    guildBoosts: [],
    isLoading: false,
    error: null
  },

  mutations: {
    SET_GUILD_INFO(state, { guildId, guildName, guildLevel }) {
      state.guildId = guildId;
      state.guildName = guildName;
      state.guildLevel = guildLevel || 1;
    },
    SET_GUILD_BOOSTS(state, boosts) {
      state.guildBoosts = boosts;
    },
    SET_LOADING(state, isLoading) {
      state.isLoading = isLoading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    }
  },

  actions: {
    async initializePlayer({ commit }) {
      // For testing, set a default guild
      commit('SET_GUILD_INFO', {
        guildId: 'player_guild',
        guildName: 'Player Guild',
        guildLevel: 1
      });
    },

    async getGuildInfo({ state, commit }) {
      try {
        commit('SET_LOADING', true);
        // In a real app, this would be an API call
        // For now, return the current state
        return {
          guildId: state.guildId,
          guildName: state.guildName,
          guildLevel: state.guildLevel
        };
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async addTerritoryBoost({ state, commit }, { type, value }) {
      const newBoosts = [...state.guildBoosts];
      const existingBoostIndex = newBoosts.findIndex(b => b.type === type);
      
      if (existingBoostIndex >= 0) {
        newBoosts[existingBoostIndex].value += value;
      } else {
        newBoosts.push({ type, value });
      }
      
      commit('SET_GUILD_BOOSTS', newBoosts);
    }
  },

  getters: {
    isInGuild: state => !!state.guildId,
    guildInfo: state => ({
      id: state.guildId,
      name: state.guildName,
      level: state.guildLevel
    }),
    totalBoosts: state => {
      return state.guildBoosts.reduce((acc, boost) => {
        acc[boost.type] = (acc[boost.type] || 0) + boost.value;
        return acc;
      }, {});
    }
  }
};