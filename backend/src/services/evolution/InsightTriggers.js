import InsightEngine from './InsightEngine.js';
import { broadcastToUser } from '../../utils/realtimeSync.js';

/**
 * InsightTriggers — Fire-and-forget hooks at execution endpoints.
 * Each trigger extracts insights and optionally auto-applies them.
 */
class InsightTriggers {
  /**
   * Called after an agent chat completes (from OrchestratorService finally block).
   * Fire-and-forget — never affects chat execution.
   */
  static async onChatCompleted(executionId, userId, context = {}) {
    try {
      const { agentId, conversationId, provider, model } = context;

      console.log(`[InsightTriggers] Chat completed: ${executionId} for agent ${agentId || 'orchestrator'}`);

      const insightIds = await InsightEngine.extract('agent_chat', executionId, userId, {
        agentId,
        conversationId,
        provider,
        model,
      });

      if (insightIds.length > 0) {
        // Auto-apply high-confidence memory insights (only for specific agents)
        if (agentId && agentId !== 'agent-chat') {
          await this._autoApplyMemoryInsights(userId, agentId);
        }

        // Broadcast to frontend
        broadcastToUser(userId, 'evolution:insights_extracted', {
          sourceType: 'agent_chat',
          sourceId: executionId,
          agentId: agentId || 'orchestrator',
          count: insightIds.length,
        });
      }
    } catch (error) {
      console.error(`[InsightTriggers] onChatCompleted failed (non-critical):`, error.message);
    }
  }

  /**
   * Called after a goal completes.
   * Routes through InsightEngine then delegates to SkillForge for skill evolution.
   */
  static async onGoalCompleted(goalId, userId, provider = null, model = null) {
    try {
      console.log(`[InsightTriggers] Goal completed: ${goalId}`);

      // Extract insights from goal traces
      const insightIds = await InsightEngine.extract('goal', goalId, userId, { goalId, provider, model });

      // Also trigger existing SkillForge pipeline
      const SkillForgeOrchestrator = (await import('../goal/SkillForgeOrchestrator.js')).default;
      const forgeResult = await SkillForgeOrchestrator.onGoalCompleted(goalId, userId, provider, model);

      if (insightIds.length > 0) {
        broadcastToUser(userId, 'evolution:insights_extracted', {
          sourceType: 'goal',
          sourceId: goalId,
          count: insightIds.length,
          forgeResult: forgeResult?.status,
        });
      }

      return { insightIds, forgeResult };
    } catch (error) {
      console.error(`[InsightTriggers] onGoalCompleted failed (non-critical):`, error.message);
      return null;
    }
  }

  /**
   * Called after a workflow execution completes.
   */
  static async onWorkflowExecutionCompleted(executionId, userId, context = {}) {
    try {
      console.log(`[InsightTriggers] Workflow execution completed: ${executionId}`);

      const insightIds = await InsightEngine.extract('workflow', executionId, userId, context);

      if (insightIds.length > 0) {
        broadcastToUser(userId, 'evolution:insights_extracted', {
          sourceType: 'workflow',
          sourceId: executionId,
          count: insightIds.length,
        });
      }

      return insightIds;
    } catch (error) {
      console.error(`[InsightTriggers] onWorkflowExecutionCompleted failed (non-critical):`, error.message);
      return [];
    }
  }

  /**
   * Periodic rollup of tool usage patterns.
   */
  static async onPeriodicRollup(userId) {
    try {
      console.log(`[InsightTriggers] Running periodic tool usage rollup for user ${userId}`);

      const insightIds = await InsightEngine.extract('tool_call', 'aggregate', userId, {});

      if (insightIds.length > 0) {
        broadcastToUser(userId, 'evolution:insights_extracted', {
          sourceType: 'tool_call',
          sourceId: 'aggregate',
          count: insightIds.length,
        });
      }

      return insightIds;
    } catch (error) {
      console.error(`[InsightTriggers] onPeriodicRollup failed (non-critical):`, error.message);
      return [];
    }
  }

  /**
   * Auto-apply memory insights that are high confidence.
   * Memory insights are always auto-applied since they're just stored facts.
   */
  static async _autoApplyMemoryInsights(userId, agentId) {
    try {
      const InsightModel = (await import('../../models/InsightModel.js')).default;
      const pendingMemory = await InsightModel.findByUserId(userId, {
        targetType: 'agent',
        targetId: agentId,
        category: 'memory',
        status: 'pending',
      });

      for (const insight of pendingMemory) {
        // Memory insights auto-apply — they just store facts
        await InsightModel.updateStatus(insight.id, 'applied', { autoApplied: true, type: 'memory_stored' });
      }
    } catch (error) {
      console.error('[InsightTriggers] Auto-apply memory failed:', error.message);
    }
  }
}

export default InsightTriggers;
