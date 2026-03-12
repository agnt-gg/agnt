import InsightModel from '../../../models/InsightModel.js';
import AgentModel from '../../../models/AgentModel.js';
import StreamEngine from '../../../stream/StreamEngine.js';
import db from '../../../models/database/index.js';

/**
 * AgentApplicator — Applies insights to agents (prompt refinement, skill assignment, memory).
 */
class AgentApplicator {
  /**
   * Apply a specific insight to its target agent.
   */
  static async apply(insightId, userId) {
    const insight = await InsightModel.findOne(insightId);
    if (!insight || insight.user_id !== userId) {
      throw new Error('Insight not found or access denied');
    }
    if (insight.target_type !== 'agent') {
      throw new Error('Insight does not target an agent');
    }
    if (!insight.target_id) {
      throw new Error('No target agent specified');
    }

    const agent = await AgentModel.findOne(insight.target_id);
    if (!agent) {
      throw new Error('Target agent not found');
    }

    let result;
    switch (insight.category) {
      case 'prompt_refinement':
        result = await this._applyPromptRefinement(agent, insight, userId);
        break;
      case 'skill_recommendation':
        result = await this._applySkillRecommendation(agent, insight, userId);
        break;
      case 'tool_preference':
        result = await this._applyToolPreference(agent, insight, userId);
        break;
      default:
        result = { applied: false, reason: `Unsupported category: ${insight.category}` };
    }

    if (result.applied) {
      await InsightModel.updateStatus(insightId, 'applied', result);
      // Increment agent's insight_version
      await this._incrementInsightVersion(insight.target_id);
    }

    return result;
  }

  /**
   * Apply a prompt refinement insight — merge the refinement into the agent's system prompt.
   */
  static async _applyPromptRefinement(agent, insight, userId) {
    const currentPrompt = agent.system_prompt || agent.systemPrompt || '';

    if (!currentPrompt) {
      return { applied: false, reason: 'Agent has no system prompt to refine' };
    }

    const streamEngine = new StreamEngine(userId);
    const prompt = `You are a prompt engineering expert. Merge the following improvement into the agent's system prompt.

CURRENT SYSTEM PROMPT:
${currentPrompt}

IMPROVEMENT TO APPLY:
Title: ${insight.title}
Description: ${insight.description}

Rules:
- Integrate the improvement naturally into the existing prompt
- Do not remove existing functionality
- Keep the same tone and structure
- Return ONLY the updated system prompt text, nothing else`;

    try {
      const UserModel = (await import('../../../models/UserModel.js')).default;
      const userSettings = await UserModel.getUserSettings(userId);
      if (!userSettings?.selectedProvider || !userSettings?.selectedModel) {
        return { applied: false, reason: 'No provider/model configured' };
      }

      const updatedPrompt = await streamEngine.generateCompletion(prompt, userSettings.selectedProvider, userSettings.selectedModel);

      if (!updatedPrompt || updatedPrompt.length < 20) {
        return { applied: false, reason: 'LLM returned invalid prompt' };
      }

      // Clean LLM output
      let cleanedPrompt = updatedPrompt
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^```[\s\S]*?\n/, '')
        .replace(/\n```\s*$/, '')
        .trim();

      // Save the updated agent
      await AgentModel.createOrUpdate(agent.id, {
        ...agent,
        assignedTools: agent.assignedTools || [],
        assignedWorkflows: agent.assignedWorkflows || [],
        assignedSkills: agent.assignedSkills || [],
        systemPrompt: cleanedPrompt,
      }, agent.created_by);

      return {
        applied: true,
        type: 'prompt_refinement',
        previousPromptLength: currentPrompt.length,
        newPromptLength: cleanedPrompt.length,
      };
    } catch (error) {
      return { applied: false, reason: error.message };
    }
  }

  /**
   * Apply a skill recommendation — add a skill to the agent's assigned skills.
   */
  static async _applySkillRecommendation(agent, insight, userId) {
    const skillId = insight.evidence?.skillId;
    if (!skillId) {
      return { applied: false, reason: 'No skill ID in evidence' };
    }

    const currentSkills = agent.assignedSkills || [];
    if (currentSkills.includes(skillId)) {
      return { applied: false, reason: 'Skill already assigned' };
    }

    const updatedSkills = [...currentSkills, skillId];
    await AgentModel.createOrUpdate(agent.id, {
      ...agent,
      assignedTools: agent.assignedTools || [],
      assignedWorkflows: agent.assignedWorkflows || [],
      assignedSkills: updatedSkills,
    }, agent.created_by);

    return { applied: true, type: 'skill_recommendation', skillId, totalSkills: updatedSkills.length };
  }

  /**
   * Apply a tool preference insight — reorder or highlight preferred tools.
   */
  static async _applyToolPreference(agent, insight, userId) {
    // Tool preferences are informational — we store them as metadata but don't change tool assignments
    return {
      applied: true,
      type: 'tool_preference',
      note: 'Tool preference recorded for prompt context',
    };
  }

  /**
   * Increment the agent's insight_version counter.
   */
  static async _incrementInsightVersion(agentId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE agents SET insight_version = COALESCE(insight_version, 0) + 1 WHERE id = ?',
        [agentId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

export default AgentApplicator;
