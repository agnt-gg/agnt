import ExperimentModel from '../models/ExperimentModel.js';
import SkillModel from '../models/SkillModel.js';
import GoldenStandardModel from '../models/GoldenStandardModel.js';
import { createLlmClient } from './ai/LlmService.js';
import { createLlmAdapter } from './orchestrator/llmAdapters.js';
import { getProviderConfig } from './ai/providerConfigs.js';
import { resolveAccountAi } from './ai/accountAi.js';

/** A request the caller can fix: the route answers 400 with the message. */
export class DatasetValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatasetValidationError';
    this.status = 400;
  }
}

const DEFAULT_SPLIT = { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 };

/**
 * One manual dataset item, in the field names the runner reads
 * (taskInput / expectedBehavior). The API reference documented
 * input / expectedOutput, so both spellings are accepted (#93).
 */
function normalizeManualItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new DatasetValidationError(`Item ${index} must be an object`);
  }
  const { input, expectedOutput, ...rest } = item;
  const taskInput = item.taskInput ?? input;
  const expectedBehavior = item.expectedBehavior ?? expectedOutput;
  if (typeof taskInput !== 'string' || !taskInput.trim()) {
    throw new DatasetValidationError(`Item ${index} needs a non-empty taskInput (or input)`);
  }
  if (typeof expectedBehavior !== 'string' || !expectedBehavior.trim()) {
    throw new DatasetValidationError(`Item ${index} needs a non-empty expectedBehavior (or expectedOutput)`);
  }
  return { ...rest, taskInput, expectedBehavior };
}

/**
 * Split ratios from a request. Accepts the documented { train, validation,
 * test } and the stored { trainRatio, valRatio, holdoutRatio }; absent means
 * the default. Ratios must be in [0, 1] and sum to 1.
 */
function normalizeSplitConfig(splitConfig) {
  if (splitConfig == null) return DEFAULT_SPLIT;
  if (typeof splitConfig !== 'object' || Array.isArray(splitConfig)) {
    throw new DatasetValidationError('splitConfig must be an object');
  }
  const ratios = {
    trainRatio: splitConfig.trainRatio ?? splitConfig.train ?? 0,
    valRatio: splitConfig.valRatio ?? splitConfig.validation ?? 0,
    holdoutRatio: splitConfig.holdoutRatio ?? splitConfig.test ?? 0,
  };
  for (const [name, value] of Object.entries(ratios)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new DatasetValidationError(`splitConfig ${name} must be a number between 0 and 1`);
    }
  }
  const total = ratios.trainRatio + ratios.valRatio + ratios.holdoutRatio;
  if (Math.abs(total - 1) > 1e-6) {
    throw new DatasetValidationError(`splitConfig ratios must sum to 1 (got ${Number(total.toFixed(6))})`);
  }
  return ratios;
}

class EvalDatasetService {
  /**
   * Generate a synthetic evaluation dataset from a skill's instructions using LLM.
   */
  static async generateSynthetic(skillId, userId, { provider: reqProvider, model: reqModel } = {}) {
    try {
      const skill = await SkillModel.findById(skillId);
      if (!skill) throw new Error(`Skill not found: ${skillId}`);

      const prompt = `You are an evaluation dataset generator. Given a skill description, generate diverse test cases to evaluate an AI agent using this skill.

Skill Name: ${skill.name}
Skill Category: ${skill.category || 'general'}
Skill Instructions:
${skill.instructions}

Generate 15-20 diverse test cases. Each test case should:
1. Have a clear task input (what the user would ask)
2. Have expected behavior described as a rubric (NOT exact output text)
3. Cover different difficulty levels
4. Test different aspects of the skill

Return ONLY a JSON array:
[
  {
    "taskInput": "the user's request",
    "expectedBehavior": "rubric describing what a good response looks like",
    "difficulty": "easy|medium|hard",
    "category": "subcategory of the skill"
  }
]`;

      // The request's selection, else the account default, else its fallback chain.
      const { provider, model } = await resolveAccountAi(userId, { provider: reqProvider, model: reqModel });
      const _cfg = getProviderConfig(provider);
      const normalizedProvider = _cfg ? _cfg.key : provider.toLowerCase();
      const client = await createLlmClient(normalizedProvider, userId);
      const adapter = await createLlmAdapter(normalizedProvider, client, model);
      const adapterResult = await adapter.call([
        { role: 'system', content: 'You are an evaluation dataset generator. Return valid JSON only.' },
        { role: 'user', content: prompt },
      ], []);

      let result = '';
      if (adapterResult.responseMessage?.content) {
        if (typeof adapterResult.responseMessage.content === 'string') {
          result = adapterResult.responseMessage.content;
        } else if (Array.isArray(adapterResult.responseMessage.content)) {
          result = adapterResult.responseMessage.content.map(block => block.text || '').join('');
        }
      }

      let cleaned = result;
      if (typeof result === 'string') {
        cleaned = result.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      }

      const items = JSON.parse(cleaned);
      if (!Array.isArray(items)) throw new Error('LLM response is not an array');

      const datasetId = await ExperimentModel.createDataset(userId, {
        name: `${skill.name}-synthetic-v1`,
        skillId,
        category: skill.category || 'general',
        source: 'synthetic',
        items,
        splitConfig: { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 },
      });

      console.log(`[EvalDatasetService] Generated synthetic dataset with ${items.length} items for skill ${skill.name}`);
      return datasetId;
    } catch (error) {
      console.error('[EvalDatasetService] Error generating synthetic dataset:', error);
      throw error;
    }
  }

  /**
   * Generate dataset from golden standards related to the skill's category.
   */
  static async generateFromHistory(skillId, userId, { provider, model } = {}) {
    try {
      const skill = await SkillModel.findById(skillId);
      if (!skill) throw new Error(`Skill not found: ${skillId}`);

      let standards = [];
      try {
        standards = await GoldenStandardModel.findByCategory(skill.category || 'general');
      } catch {
        standards = [];
      }
      if (!standards || standards.length === 0) {
        try {
          standards = await GoldenStandardModel.findAll();
        } catch {
          standards = [];
        }
      }

      const items = (standards || []).slice(0, 20).map((std) => {
        let templateData = {};
        try {
          templateData = typeof std.template_data === 'string' ? JSON.parse(std.template_data) : (std.template_data || {});
        } catch { /* ignore */ }

        return {
          taskInput: templateData.goal?.title ? `${templateData.goal.title}: ${templateData.goal.description || ''}` : `${std.title}: ${std.description || ''}`,
          expectedBehavior: templateData.evaluation?.feedback || std.description || 'Complete the task successfully',
          difficulty: 'medium',
          category: std.category || skill.category || 'general',
        };
      });

      // If not enough items, supplement with synthetic
      if (items.length < 5 && skillId) {
        try {
          const syntheticId = await this.generateSynthetic(skillId, userId, { provider, model });
          console.log(`[EvalDatasetService] Supplemented historical dataset with synthetic: ${syntheticId}`);
          return syntheticId;
        } catch {
          // Fall through to store what we have
        }
      }

      const datasetId = await ExperimentModel.createDataset(userId, {
        name: `${skill.name}-historical-v1`,
        skillId,
        category: skill.category || 'general',
        source: 'historical',
        items,
        splitConfig: { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 },
      });

      console.log(`[EvalDatasetService] Generated historical dataset with ${items.length} items`);
      return datasetId;
    } catch (error) {
      console.error('[EvalDatasetService] Error generating historical dataset:', error);
      throw error;
    }
  }

  /**
   * Generate dataset from golden standards for a category.
   */
  static async generateFromGoldenStandards(category, userId) {
    try {
      let standards = [];
      try {
        standards = category ? await GoldenStandardModel.findByCategory(category) : await GoldenStandardModel.findAll();
      } catch {
        standards = [];
      }

      if (!standards || standards.length === 0) {
        throw new Error(`No golden standards found for category: ${category || 'all'}`);
      }

      const items = standards.map((std) => {
        let templateData = {};
        try {
          templateData = typeof std.template_data === 'string' ? JSON.parse(std.template_data) : (std.template_data || {});
        } catch { /* ignore */ }

        return {
          taskInput: templateData.goal?.title ? `${templateData.goal.title}: ${templateData.goal.description || ''}` : `${std.title}: ${std.description || ''}`,
          expectedBehavior: templateData.evaluation?.feedback || std.description || 'Complete the task successfully',
          difficulty: 'medium',
          category: std.category || category || 'general',
        };
      });

      const datasetId = await ExperimentModel.createDataset(userId, {
        name: `golden-${category || 'all'}-v1`,
        skillId: null,
        category: category || 'general',
        source: 'golden',
        items,
        splitConfig: { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 },
      });

      console.log(`[EvalDatasetService] Generated golden dataset with ${items.length} items`);
      return datasetId;
    } catch (error) {
      console.error('[EvalDatasetService] Error generating golden dataset:', error);
      throw error;
    }
  }

  /**
   * Import a manually created dataset.
   */
  static async importManual(userId, name, rawItems, { category = null, splitConfig = null } = {}) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new DatasetValidationError('items must be a non-empty array');
    }
    const items = rawItems.map(normalizeManualItem);
    const split = normalizeSplitConfig(splitConfig);

    try {
      const datasetId = await ExperimentModel.createDataset(userId, {
        name: name || 'manual-dataset',
        skillId: null,
        category: category || 'manual',
        source: 'manual',
        items,
        splitConfig: split,
      });

      console.log(`[EvalDatasetService] Imported manual dataset with ${items.length} items`);
      return datasetId;
    } catch (error) {
      console.error('[EvalDatasetService] Error importing manual dataset:', error);
      throw error;
    }
  }

  /**
   * Split a dataset into train/val/holdout based on splitConfig ratios.
   */
  static getDatasetSplit(dataset) {
    const items = Array.isArray(dataset.items) ? dataset.items : [];
    const config = dataset.split_config || { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 };
    const trainEnd = Math.floor(items.length * config.trainRatio);
    const valEnd = trainEnd + Math.floor(items.length * config.valRatio);

    return {
      train: items.slice(0, trainEnd),
      val: items.slice(trainEnd, valEnd),
      holdout: items.slice(valEnd),
    };
  }

  static async getDatasetById(id) {
    try {
      return await ExperimentModel.findDataset(id);
    } catch (error) {
      console.error('[EvalDatasetService] Error fetching dataset:', error);
      throw error;
    }
  }

  static async listDatasets(userId, { skillId, category } = {}) {
    try {
      return await ExperimentModel.findDatasetsByUserId(userId, { skillId, category });
    } catch (error) {
      console.error('[EvalDatasetService] Error listing datasets:', error);
      throw error;
    }
  }

  static async deleteDataset(id, userId) {
    try {
      return await ExperimentModel.deleteDataset(id, userId);
    } catch (error) {
      console.error('[EvalDatasetService] Error deleting dataset:', error);
      throw error;
    }
  }
}

export default EvalDatasetService;
