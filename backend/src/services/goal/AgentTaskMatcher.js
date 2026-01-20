/**
 * AgentTaskMatcher - Intelligent agent selection for task execution
 *
 * This module handles matching tasks to the most appropriate agents based on:
 * - Tool requirements overlap
 * - Agent specialization/category
 * - Agent performance history
 * - Resource availability
 */

import AgentModel from '../../models/AgentModel.js';

class AgentTaskMatcher {
  /**
   * Select the best agent for a given task
   * @param {Object} task - The task to assign
   * @param {string} userId - The user ID
   * @returns {Object} Selected agent
   */
  static async selectAgentForTask(task, userId) {
    try {
      console.log(`[AgentTaskMatcher] Selecting agent for task: ${task.title}`);

      // Get all available agents for this user
      const agents = await AgentModel.findAllByUserId(userId);

      // Parse required tools from task and normalize to underscores
      let requiredTools = Array.isArray(task.required_tools) ? task.required_tools : JSON.parse(task.required_tools || '[]');
      // Normalize tool names: convert hyphens to underscores for matching
      requiredTools = requiredTools.map((tool) => tool.replace(/-/g, '_'));

      console.log(`[AgentTaskMatcher] Task requires tools (normalized): ${requiredTools.join(', ')}`);

      // If user has agents, try to find the best match that has ALL required tools
      if (agents.length > 0) {
        // First, find agents that have ALL required tools
        const fullyCapableAgents = agents.filter((agent) => {
          const agentTools = Array.isArray(agent.assignedTools) ? agent.assignedTools : JSON.parse(agent.tools || '[]');
          // Normalize agent tools as well
          const normalizedAgentTools = agentTools.map((tool) => tool.replace(/-/g, '_'));
          return requiredTools.length === 0 || requiredTools.every((tool) => normalizedAgentTools.includes(tool));
        });

        if (fullyCapableAgents.length > 0) {
          // Score the fully capable agents and pick the best one
          const scoredAgents = fullyCapableAgents.map((agent) => {
            const score = this.scoreAgent(agent, requiredTools, task);
            return { agent, score };
          });

          // Sort by score (highest first)
          scoredAgents.sort((a, b) => b.score - a.score);

          console.log('[AgentTaskMatcher] Fully capable agents found:');
          scoredAgents.forEach(({ agent, score }) => {
            console.log(`  - ${agent.name}: ${score.toFixed(2)}`);
          });

          // Return the best fully capable agent
          const selected = scoredAgents[0];
          console.log(`[AgentTaskMatcher] Selected fully capable agent: ${selected.agent.name} (score: ${selected.score.toFixed(2)})`);
          return selected.agent;
        } else {
          console.log('[AgentTaskMatcher] No existing agent has all required tools, using built-in Task Executor');
        }
      } else {
        console.log('[AgentTaskMatcher] No user agents found, using built-in Task Executor');
      }

      // No suitable user agent found, return built-in task executor agent
      return await this.getBuiltInTaskExecutor(userId);
    } catch (error) {
      console.error('[AgentTaskMatcher] Error selecting agent:', error);
      // Return built-in agent as fallback
      return await this.getBuiltInTaskExecutor(userId);
    }
  }

  /**
   * Score an agent's suitability for a task
   * @param {Object} agent - The agent to score
   * @param {Array} requiredTools - Tools required by the task
   * @param {Object} task - The task object
   * @returns {number} Score (0-100)
   */
  static scoreAgent(agent, requiredTools, task) {
    let score = 0;

    // Parse agent's assigned tools
    const agentTools = Array.isArray(agent.assignedTools) ? agent.assignedTools : JSON.parse(agent.tools || '[]');

    // 1. Tool overlap score (0-40 points)
    if (requiredTools.length > 0) {
      const toolOverlap = requiredTools.filter((tool) => agentTools.includes(tool)).length;
      const toolScore = (toolOverlap / requiredTools.length) * 40;
      score += toolScore;
    } else {
      // If no specific tools required, give base score
      score += 20;
    }

    // 2. Agent has tools assigned (0-20 points)
    if (agentTools.length > 0) {
      score += 20;
    }

    // 3. Agent status (0-15 points)
    if (agent.status === 'active') {
      score += 15;
    } else if (agent.status === 'idle') {
      score += 10;
    }

    // 4. Success rate (0-15 points)
    if (agent.success_rate) {
      score += (agent.success_rate / 100) * 15;
    } else {
      // Default score for agents without history
      score += 10;
    }

    // 5. Resource availability (0-10 points)
    if (agent.creditLimit && agent.creditsUsed) {
      const availableCredits = agent.creditLimit - agent.creditsUsed;
      const creditRatio = availableCredits / agent.creditLimit;
      score += creditRatio * 10;
    } else {
      score += 10; // Default if no credit tracking
    }

    return score;
  }

  /**
   * Get the built-in task executor agent (not persisted to database)
   * Uses user's default provider/model settings
   * @param {string} userId - User ID to fetch settings from
   * @returns {Promise<Object>} Built-in agent object
   */
  static async getBuiltInTaskExecutor(userId = null) {
    // Default provider/model (fallback if user settings not available)
    let provider = 'OpenAI';
    let model = 'gpt-4o-mini';

    // Try to get user's default provider/model settings
    if (userId) {
      try {
        const UserModel = (await import('../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);

        if (userSettings?.selectedProvider) {
          provider = userSettings.selectedProvider;
        }
        if (userSettings?.selectedModel) {
          model = userSettings.selectedModel;
        }

        console.log(`[AgentTaskMatcher] Built-in agent using user's settings: ${provider}/${model}`);
        console.log(`[AgentTaskMatcher] User settings retrieved:`, JSON.stringify(userSettings, null, 2));
      } catch (error) {
        console.warn(`[AgentTaskMatcher] Could not load user settings, using defaults: ${error.message}`);
      }
    } else {
      console.log(`[AgentTaskMatcher] No userId provided, using default: ${provider}/${model}`);
    }

    return {
      id: 'built-in-task-executor',
      name: 'Task Executor',
      description: 'Built-in general-purpose agent for executing goal tasks. Can use various tools to complete assigned work.',
      status: 'active',
      icon: 'robot',
      category: 'system',
      assignedTools: [
        'web_search',
        'web_scrape',
        'execute_javascript',
        'file_operations',
        'send_email',
        'generate_with_ai_llm',
        'gmail_api',
        'google_calendar',
        'google_drive',
        'slack_api',
        'github_api',
        'notion_api',
      ],
      assignedWorkflows: [],
      provider,
      model,
      creditLimit: 10000, // High limit for system agent
      creditsUsed: 0,
      success_rate: 95,
      isBuiltIn: true, // Flag to identify built-in agents
    };
  }

  /**
   * DEPRECATED: This method should not be used anymore.
   * The system now uses getBuiltInTaskExecutor() which returns a virtual agent
   * that doesn't get saved to the database.
   *
   * If you have an old "Task Executor" agent in your database, you should delete it
   * so the system will use the built-in agent with your current user settings.
   */
  static async createDefaultTaskAgent(userId) {
    console.warn('[AgentTaskMatcher] DEPRECATED: createDefaultTaskAgent should not be called. Use getBuiltInTaskExecutor instead.');
    throw new Error('createDefaultTaskAgent is deprecated. The system should use the built-in agent instead.');
  }

  /**
   * Helper method to clean up old Task Executor agents from the database
   * This removes any "Task Executor" agents that were created by the old system
   * @param {string} userId - The user ID
   * @returns {Promise<number>} Number of agents deleted
   */
  static async cleanupOldTaskExecutors(userId) {
    try {
      const agents = await AgentModel.findAllByUserId(userId);
      const taskExecutors = agents.filter((agent) => agent.name === 'Task Executor' && agent.category === 'general');

      let deletedCount = 0;
      for (const agent of taskExecutors) {
        await AgentModel.delete(agent.id, userId);
        deletedCount++;
        console.log(`[AgentTaskMatcher] Deleted old Task Executor agent: ${agent.id}`);
      }

      if (deletedCount > 0) {
        console.log(`[AgentTaskMatcher] Cleaned up ${deletedCount} old Task Executor agent(s)`);
      }

      return deletedCount;
    } catch (error) {
      console.error('[AgentTaskMatcher] Error cleaning up old Task Executors:', error);
      throw error;
    }
  }
}

export default AgentTaskMatcher;
