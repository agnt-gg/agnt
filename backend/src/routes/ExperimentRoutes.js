import express from 'express';
import ExperimentService from '../services/ExperimentService.js';
import EvalDatasetService from '../services/EvalDatasetService.js';
import ExperimentModel from '../models/ExperimentModel.js';
import GoldenStandardModel from '../models/GoldenStandardModel.js';
import { authenticateToken } from './Middleware.js';

const ExperimentRoutes = express.Router();

// ==================== DATASETS (before :id routes) ====================

ExperimentRoutes.post('/datasets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, skillId, category, source, items, splitConfig } = req.body;

    let datasetId;
    if (source === 'manual') {
      datasetId = await EvalDatasetService.importManual(userId, name, items);
    } else {
      datasetId = await EvalDatasetService.generateSynthetic(skillId, userId);
    }

    res.status(201).json({ success: true, datasetId });
  } catch (error) {
    console.error('[Experiment Route] Create dataset error:', error);
    res.status(500).json({ error: 'Failed to create eval dataset' });
  }
});

ExperimentRoutes.get('/datasets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const datasets = await EvalDatasetService.listDatasets(userId, {
      skillId: req.query.skillId,
      category: req.query.category,
    });
    res.json({ success: true, datasets });
  } catch (error) {
    console.error('[Experiment Route] List datasets error:', error);
    res.status(500).json({ error: 'Failed to list eval datasets' });
  }
});

ExperimentRoutes.post('/datasets/generate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { skillId, source, category, provider, model } = req.body;

    let datasetId;
    if (source === 'historical') {
      datasetId = await EvalDatasetService.generateFromHistory(skillId, userId, { provider, model });
    } else if (source === 'golden') {
      datasetId = await EvalDatasetService.generateFromGoldenStandards(category, userId);
    } else {
      datasetId = await EvalDatasetService.generateSynthetic(skillId, userId, { provider, model });
    }

    res.json({ success: true, datasetId });
  } catch (error) {
    console.error('[Experiment Route] Generate dataset error:', error);
    res.status(500).json({ error: 'Failed to generate eval dataset' });
  }
});

ExperimentRoutes.get('/datasets/:id', authenticateToken, async (req, res) => {
  try {
    const dataset = await EvalDatasetService.getDatasetById(req.params.id);
    if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

    const splits = EvalDatasetService.getDatasetSplit(dataset);
    res.json({ success: true, dataset, splits });
  } catch (error) {
    console.error('[Experiment Route] Get dataset error:', error);
    res.status(500).json({ error: 'Failed to get eval dataset' });
  }
});

ExperimentRoutes.delete('/datasets/:id', authenticateToken, async (req, res) => {
  try {
    await EvalDatasetService.deleteDataset(req.params.id, req.user.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Experiment Route] Delete dataset error:', error);
    res.status(500).json({ error: 'Failed to delete eval dataset' });
  }
});

// ==================== BENCHMARKS (before :id routes) ====================

ExperimentRoutes.get('/benchmarks', authenticateToken, async (req, res) => {
  try {
    const benchmarks = await GoldenStandardModel.findAll();
    res.json({ success: true, benchmarks: benchmarks || [] });
  } catch (error) {
    console.error('[Experiment Route] Benchmarks error:', error);
    res.status(500).json({ error: 'Failed to fetch benchmarks' });
  }
});

// ==================== EXPERIMENTS ====================

ExperimentRoutes.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, hypothesis, type, sourceGoalId, benchmarkId, skillId, evalDatasetId, config } = req.body;
    if (!name) return res.status(400).json({ error: 'Experiment name is required' });

    const experiment = await ExperimentService.createExperiment(userId, { name, hypothesis, type, sourceGoalId, benchmarkId, skillId, evalDatasetId, config });
    res.status(201).json({ success: true, experiment });
  } catch (error) {
    console.error('[Experiment Route] Create error:', error);
    res.status(500).json({ error: 'Failed to create experiment' });
  }
});

ExperimentRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, limit } = req.query;
    const experiments = await ExperimentService.listExperiments(userId, { status, limit: parseInt(limit) || 50 });
    res.json({ success: true, experiments });
  } catch (error) {
    console.error('[Experiment Route] List error:', error);
    res.status(500).json({ error: 'Failed to list experiments' });
  }
});

ExperimentRoutes.get('/:id', authenticateToken, async (req, res) => {
  try {
    const experiment = await ExperimentService.getExperimentWithResults(req.params.id);
    if (!experiment) return res.status(404).json({ error: 'Experiment not found' });
    res.json({ success: true, experiment });
  } catch (error) {
    console.error('[Experiment Route] Get error:', error);
    res.status(500).json({ error: 'Failed to get experiment' });
  }
});

ExperimentRoutes.post('/:id/run', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { provider, model } = req.body || {};
    // Fire-and-forget: start the experiment but respond immediately
    ExperimentService.runExperiment(req.params.id, userId, { provider, model }).catch((err) => {
      console.error('[Experiment Route] Run error:', err);
    });
    res.json({ success: true, message: 'Experiment execution started' });
  } catch (error) {
    console.error('[Experiment Route] Run start error:', error);
    res.status(500).json({ error: 'Failed to start experiment' });
  }
});

ExperimentRoutes.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await ExperimentService.deleteExperiment(req.params.id, req.user.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Experiment Route] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete experiment' });
  }
});

ExperimentRoutes.get('/:id/runs', authenticateToken, async (req, res) => {
  try {
    const runs = await ExperimentModel.findRunsByExperiment(req.params.id);
    res.json({ success: true, runs });
  } catch (error) {
    console.error('[Experiment Route] Get runs error:', error);
    res.status(500).json({ error: 'Failed to get experiment runs' });
  }
});

export default ExperimentRoutes;
