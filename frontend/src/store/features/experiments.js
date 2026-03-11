import { API_CONFIG } from '@/tt.config.js';

export default {
  namespaced: true,

  state: {
    experiments: [],
    evalDatasets: [],
    selectedExperimentId: null,
    selectedDatasetId: null,
    isLoading: false,
    isLoadingDatasets: false,
    error: null,
    isFetchingExperiments: false,
    isFetchingDatasets: false,
    lastFetched: null,
    lastFetchedDatasets: null,
  },

  mutations: {
    SET_EXPERIMENTS(state, experiments) {
      state.experiments = experiments || [];
      state.lastFetched = Date.now();
    },
    ADD_EXPERIMENT(state, experiment) {
      state.experiments.unshift(experiment);
    },
    UPDATE_EXPERIMENT(state, updatedExperiment) {
      const index = state.experiments.findIndex((e) => e.id === updatedExperiment.id);
      if (index !== -1) {
        state.experiments.splice(index, 1, { ...state.experiments[index], ...updatedExperiment });
      }
    },
    DELETE_EXPERIMENT(state, experimentId) {
      state.experiments = state.experiments.filter((e) => e.id !== experimentId);
    },
    SET_EVAL_DATASETS(state, datasets) {
      state.evalDatasets = datasets || [];
      state.lastFetchedDatasets = Date.now();
    },
    ADD_EVAL_DATASET(state, dataset) {
      state.evalDatasets.unshift(dataset);
    },
    UPDATE_EVAL_DATASET(state, updatedDataset) {
      const index = state.evalDatasets.findIndex((d) => d.id === updatedDataset.id);
      if (index !== -1) {
        state.evalDatasets.splice(index, 1, { ...state.evalDatasets[index], ...updatedDataset });
      }
    },
    DELETE_EVAL_DATASET(state, datasetId) {
      state.evalDatasets = state.evalDatasets.filter((d) => d.id !== datasetId);
    },
    SET_SELECTED_EXPERIMENT(state, experimentId) {
      state.selectedExperimentId = experimentId;
    },
    SET_SELECTED_DATASET(state, datasetId) {
      state.selectedDatasetId = datasetId;
    },
    SET_LOADING(state, isLoading) {
      state.isLoading = isLoading;
    },
    SET_LOADING_DATASETS(state, isLoading) {
      state.isLoadingDatasets = isLoading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    SET_FETCHING_EXPERIMENTS(state, isFetching) {
      state.isFetchingExperiments = isFetching;
    },
    SET_FETCHING_DATASETS(state, isFetching) {
      state.isFetchingDatasets = isFetching;
    },
    UPDATE_EXPERIMENT_RUN(state, { experimentId, runId, variant, metrics }) {
      const experiment = state.experiments.find((e) => e.id === experimentId);
      if (experiment) {
        if (!experiment.runs) experiment.runs = [];
        const runIndex = experiment.runs.findIndex((r) => r.id === runId);
        if (runIndex !== -1) {
          experiment.runs.splice(runIndex, 1, { ...experiment.runs[runIndex], metrics, variant });
        } else {
          experiment.runs.push({ id: runId, variant, metrics });
        }
      }
    },
    UPDATE_EXPERIMENT_PROGRESS(state, { experimentId, progress }) {
      const experiment = state.experiments.find((e) => e.id === experimentId);
      if (experiment) experiment.progress = progress;
    },
    UPDATE_EXPERIMENT_RESULT(state, { experimentId, result }) {
      const experiment = state.experiments.find((e) => e.id === experimentId);
      if (experiment) experiment.result = result;
    },
  },

  actions: {
    async fetchExperiments({ commit, state }, { force = false } = {}) {
      if (state.isFetchingExperiments) return;
      const now = Date.now();
      if (!force && state.experiments.length > 0 && state.lastFetched && now - state.lastFetched < 5 * 60 * 1000) return;
      commit('SET_FETCHING_EXPERIMENTS', true);
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        commit('SET_EXPERIMENTS', data.experiments || []);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
        commit('SET_FETCHING_EXPERIMENTS', false);
      }
    },

    async fetchExperiment({ commit }, experimentId) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/${experimentId}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (data.experiment) commit('UPDATE_EXPERIMENT', data.experiment);
        return data.experiment;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async createExperiment({ commit }, experimentData) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(experimentData),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (data.experiment) commit('ADD_EXPERIMENT', data.experiment);
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async runExperiment({ commit, rootState }, experimentId) {
      try {
        const token = localStorage.getItem('token');
        const provider = rootState.aiProvider?.selectedProvider;
        const model = rootState.aiProvider?.selectedModel;
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/${experimentId}/run`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ provider, model }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        commit('UPDATE_EXPERIMENT', { id: experimentId, status: 'running' });
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async deleteExperiment({ commit }, experimentId) {
      commit('DELETE_EXPERIMENT', experimentId);
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/${experimentId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async fetchEvalDatasets({ commit, state }, { force = false } = {}) {
      if (state.isFetchingDatasets) return;
      const now = Date.now();
      if (!force && state.evalDatasets.length > 0 && state.lastFetchedDatasets && now - state.lastFetchedDatasets < 5 * 60 * 1000) return;
      commit('SET_FETCHING_DATASETS', true);
      commit('SET_LOADING_DATASETS', true);
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/datasets`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        commit('SET_EVAL_DATASETS', data.datasets || []);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING_DATASETS', false);
        commit('SET_FETCHING_DATASETS', false);
      }
    },

    async generateEvalDataset({ commit, dispatch, rootState }, { skillId, source, category }) {
      commit('SET_LOADING_DATASETS', true);
      try {
        const token = localStorage.getItem('token');
        const provider = rootState.aiProvider?.selectedProvider;
        const model = rootState.aiProvider?.selectedModel;
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/datasets/generate`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ skillId, source, category, provider, model }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        await dispatch('fetchEvalDatasets', { force: true });
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING_DATASETS', false);
      }
    },

    async deleteEvalDataset({ commit }, datasetId) {
      commit('DELETE_EVAL_DATASET', datasetId);
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/experiments/datasets/${datasetId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },
  },

  getters: {
    allExperiments: (state) => state.experiments,
    experimentsByStatus: (state) => (status) => state.experiments.filter((e) => e.status === status),
    getExperimentById: (state) => (id) => state.experiments.find((e) => e.id === id),
    runningExperiments: (state) => state.experiments.filter((e) => e.status === 'running'),
    completedExperiments: (state) => state.experiments.filter((e) => e.status === 'completed'),
    selectedExperiment: (state) => state.experiments.find((e) => e.id === state.selectedExperimentId),
    allEvalDatasets: (state) => state.evalDatasets,
    getDatasetById: (state) => (id) => state.evalDatasets.find((d) => d.id === id),
    datasetsBySource: (state) => (source) => state.evalDatasets.filter((d) => d.source === source),
    datasetsBySkill: (state) => (skillId) => state.evalDatasets.filter((d) => d.skill_id === skillId),
    selectedDataset: (state) => state.evalDatasets.find((d) => d.id === state.selectedDatasetId),
    isLoading: (state) => state.isLoading,
    isLoadingDatasets: (state) => state.isLoadingDatasets,
    error: (state) => state.error,
    experimentStats: (state) => {
      const total = state.experiments.length;
      const running = state.experiments.filter((e) => e.status === 'running').length;
      const completed = state.experiments.filter((e) => e.status === 'completed').length;
      const kept = state.experiments.filter((e) => e.result?.decision === 'keep').length;
      const avgDelta = completed > 0
        ? state.experiments.filter((e) => e.result?.delta != null).reduce((sum, e) => sum + (e.result?.delta || 0), 0) / Math.max(1, state.experiments.filter((e) => e.result?.delta != null).length)
        : 0;
      const successRate = completed > 0 ? Math.round((kept / completed) * 100) : 0;
      return { total, running, completed, kept, avgDelta: Math.round(avgDelta * 100) / 100, successRate };
    },
  },
};
