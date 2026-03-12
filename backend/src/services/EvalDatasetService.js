import ExperimentModel from '../models/ExperimentModel.js';
import SkillModel from '../models/SkillModel.js';
import GoldenStandardModel from '../models/GoldenStandardModel.js';
import StreamEngine from '../stream/StreamEngine.js';
import UserModel from '../models/UserModel.js';

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

      const streamEngine = new StreamEngine(userId);
      // Use provider/model from request (frontend sends current selection), fall back to DB settings
      let provider = reqProvider;
      let model = reqModel;
      if (!provider || !model) {
        const userSettings = await UserModel.getUserSettings(userId);
        provider = provider || userSettings?.selectedProvider || 'anthropic';
        model = model || userSettings?.selectedModel || 'claude-sonnet-4-20250514';
      }
      const result = await streamEngine.generateCompletion(prompt, provider, model);
      if (streamEngine._lastCompletionUsage) {
        const u = streamEngine._lastCompletionUsage;
        const input = u.prompt_tokens || u.input_tokens || 0;
        const output = u.completion_tokens || u.output_tokens || 0;
        console.log(`[EvalDatasetService] Token Usage: ${input} in / ${output} out = ${input + output} total`);
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
  static async importManual(userId, name, items) {
    try {
      if (!Array.isArray(items)) throw new Error('Items must be an array');
      items.forEach((item, idx) => {
        if (!item.taskInput || !item.expectedBehavior) {
          throw new Error(`Item ${idx} missing taskInput or expectedBehavior`);
        }
      });

      const datasetId = await ExperimentModel.createDataset(userId, {
        name: name || 'manual-dataset',
        skillId: null,
        category: 'manual',
        source: 'manual',
        items,
        splitConfig: { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 },
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
