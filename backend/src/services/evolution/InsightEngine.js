import InsightModel from '../../models/InsightModel.js';
import AgentMemoryModel from '../../models/AgentMemoryModel.js';
import { createLlmClient } from '../ai/LlmService.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { getProviderConfig } from '../ai/providerConfigs.js';

/**
 * InsightEngine — Core extraction engine for the Unified Evolution system.
 * Extracts insights from any execution trace source (agent chat, goal, workflow, tool).
 */
class InsightEngine {
  /**
   * Extract insights from any source type.
   * @param {string} sourceType - 'agent_chat' | 'goal' | 'workflow' | 'tool_call'
   * @param {string} sourceId - The execution/entity ID
   * @param {string} userId - User who owns the data
   * @param {Object} context - Additional context (agentId, conversationId, etc.)
   */
  static async extract(sourceType, sourceId, userId, context = {}) {
    try {
      console.log(`[InsightEngine] Extracting insights from ${sourceType}:${sourceId}`);

      switch (sourceType) {
        case 'agent_chat':
          return await this._extractFromChat(sourceId, userId, context);
        case 'goal':
          return await this._extractFromGoal(sourceId, userId, context);
        case 'workflow':
          return await this._extractFromWorkflow(sourceId, userId, context);
        case 'tool_call':
          return await this._extractFromToolUsage(sourceId, userId, context);
        default:
          console.warn(`[InsightEngine] Unknown source type: ${sourceType}`);
          return [];
      }
    } catch (error) {
      console.error(`[InsightEngine] Extraction failed for ${sourceType}:${sourceId}:`, error.message);
      return [];
    }
  }

  /**
   * Extract insights from an agent chat execution.
   * Produces: memory facts, prompt refinements, tool preferences.
   */
  static async _extractFromChat(executionId, userId, context) {
    const { agentId, conversationId, provider, model } = context;
    const isOrchestratorChat = !agentId || agentId === 'agent-chat';

    // Load execution data (includes tool executions)
    const AgentExecutionModel = (await import('../../models/AgentExecutionModel.js')).default;
    const details = await AgentExecutionModel.getExecutionDetails(executionId);
    if (!details) return [];

    const execution = details;
    const toolExecutions = details.toolExecutions || [];

    // Load conversation log
    let conversationLog = null;
    if (conversationId) {
      try {
        const dbMod = await import('../../models/database/index.js');
        const dbConn = dbMod.default;
        conversationLog = await new Promise((resolve, reject) => {
          dbConn.get('SELECT * FROM conversation_logs WHERE conversation_id = ?', [conversationId], (err, row) => {
            if (err) reject(err); else resolve(row || null);
          });
        });
      } catch { /* ignore */ }
    }

    // Skip truly empty executions (no tool calls, no meaningful response, no conversation)
    const hasToolCalls = toolExecutions.length > 0;
    const hasResponse = execution.finalResponse && execution.finalResponse.length >= 50;
    const hasConversation = conversationLog?.full_history;
    if (!hasToolCalls && !hasResponse && !hasConversation) {
      console.log(`[InsightEngine] Skipping empty chat execution ${executionId}`);
      return [];
    }

    // Build trace for LLM analysis
    const trace = this._buildChatTrace(execution, toolExecutions, conversationLog);

    // Use LLM to extract insights
    const rawInsights = await this._llmExtractChatInsights(trace, userId, provider, model);
    if (!rawInsights || rawInsights.length === 0) return [];

    // Store insights with deduplication
    // For orchestrator chats, target insights generally (no specific agent)
    const defaultTargetType = isOrchestratorChat ? (raw) => raw.targetType || 'agent' : () => 'agent';
    const defaultTargetId = isOrchestratorChat ? (raw) => raw.targetId || null : (raw) => raw.targetId || agentId;

    const stored = [];
    for (const raw of rawInsights) {
      const insightId = await this._storeInsightWithDedup(userId, {
        sourceType: 'agent_chat',
        sourceId: executionId,
        sourceContext: { agent_id: agentId || 'orchestrator', conversation_id: conversationId },
        targetType: defaultTargetType(raw),
        targetId: defaultTargetId(raw),
        category: raw.category,
        title: raw.title,
        description: raw.description,
        evidence: raw.evidence,
        confidence: raw.confidence || 0.5,
      });

      // Store ALL insights as memories — the memory system is the universal learning mechanism
      const memoryType = raw.category === 'memory'
        ? (raw.memoryType || 'fact')
        : this._insightToMemoryType(raw.category, 'agent_chat');
      const memContent = raw.memoryContent || raw.description;
      const memAgentId = isOrchestratorChat ? 'orchestrator' : agentId;
      await this._storeMemory(memAgentId, userId, memContent, memoryType, conversationId);

      if (insightId) stored.push(insightId);
    }

    console.log(`[InsightEngine] Extracted ${stored.length} insights from chat ${executionId}`);
    return stored;
  }

  /**
   * Extract insights from a completed goal.
   * Delegates to existing TraceAnalyzer and translates output to insight rows.
   */
  static async _extractFromGoal(goalId, userId, context) {
    const { provider, model } = context;
    // Import TraceAnalyzer to reuse existing analysis
    const TraceAnalyzer = (await import('../goal/TraceAnalyzer.js')).default;
    const analysis = await TraceAnalyzer.analyzeTrace(goalId, userId, provider, model);
    if (!analysis) return [];

    const stored = [];

    // Convert patterns to insights + memories
    for (const pattern of (analysis.patterns || [])) {
      const insightId = await this._storeInsightWithDedup(userId, {
        sourceType: 'goal',
        sourceId: goalId,
        sourceContext: { goal_id: goalId },
        targetType: 'skill',
        targetId: null,
        category: 'pattern',
        title: pattern.name,
        description: pattern.description,
        evidence: { type: pattern.type, toolSequence: pattern.toolSequence, effectiveness: pattern.effectiveness, evidence: pattern.evidence },
        confidence: pattern.effectiveness || 0.5,
      });
      await this._storeMemory('orchestrator', userId, `[Pattern] ${pattern.name}: ${pattern.description}`, 'pattern');
      if (insightId) stored.push(insightId);
    }

    // Convert antipatterns to insights + memories
    for (const ap of (analysis.antipatterns || [])) {
      const insightId = await this._storeInsightWithDedup(userId, {
        sourceType: 'goal',
        sourceId: goalId,
        sourceContext: { goal_id: goalId },
        targetType: 'skill',
        targetId: null,
        category: 'antipattern',
        title: ap.name,
        description: ap.description,
        evidence: { avoidWhen: ap.avoidWhen, evidence: ap.evidence },
        confidence: 0.6,
      });
      await this._storeMemory('orchestrator', userId, `[Avoid] ${ap.name}: ${ap.description}`, 'pattern');
      if (insightId) stored.push(insightId);
    }

    // Convert higher-order insights + memories
    for (const insight of (analysis.insights || [])) {
      const insightId = await this._storeInsightWithDedup(userId, {
        sourceType: 'goal',
        sourceId: goalId,
        sourceContext: { goal_id: goalId },
        targetType: 'agent',
        targetId: null,
        category: 'prompt_refinement',
        title: insight.substring(0, 80),
        description: insight,
        confidence: 0.4,
      });
      await this._storeMemory('orchestrator', userId, insight, 'prompt_guidance');
      if (insightId) stored.push(insightId);
    }

    console.log(`[InsightEngine] Extracted ${stored.length} insights from goal ${goalId}`);
    return stored;
  }

  /**
   * Extract insights from a workflow execution.
   */
  static async _extractFromWorkflow(executionId, userId, context) {
    const { provider, model } = context;
    // Load workflow execution and node executions
    const db = (await import('../../models/database/index.js')).default;

    const execution = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM workflow_executions WHERE id = ?', [executionId], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    if (!execution) return [];

    const nodeExecutions = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM node_executions WHERE execution_id = ? ORDER BY start_time', [executionId], (err, rows) => {
        if (err) reject(err); else resolve(rows || []);
      });
    });

    if (nodeExecutions.length < 2) return [];

    // Build workflow trace
    const trace = this._buildWorkflowTrace(execution, nodeExecutions);
    const rawInsights = await this._llmExtractWorkflowInsights(trace, userId, provider, model);
    if (!rawInsights || rawInsights.length === 0) return [];

    const stored = [];
    for (const raw of rawInsights) {
      const insightId = await this._storeInsightWithDedup(userId, {
        sourceType: 'workflow',
        sourceId: executionId,
        sourceContext: { workflow_id: execution.workflow_id },
        targetType: 'workflow',
        targetId: execution.workflow_id,
        category: raw.category,
        title: raw.title,
        description: raw.description,
        evidence: raw.evidence,
        confidence: raw.confidence || 0.5,
      });
      const memType = this._insightToMemoryType(raw.category, 'workflow');
      await this._storeMemory('orchestrator', userId, `[${raw.category}] ${raw.title}: ${raw.description}`, memType);
      if (insightId) stored.push(insightId);
    }

    console.log(`[InsightEngine] Extracted ${stored.length} insights from workflow execution ${executionId}`);
    return stored;
  }

  /**
   * Extract insights from aggregated tool usage.
   */
  static async _extractFromToolUsage(sourceId, userId, context) {
    const db = (await import('../../models/database/index.js')).default;

    // Aggregate recent tool executions
    const toolStats = await new Promise((resolve, reject) => {
      db.all(`
        SELECT tool_name, COUNT(*) as call_count,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as fail_count,
          AVG(CASE WHEN end_time IS NOT NULL AND start_time IS NOT NULL
            THEN (julianday(end_time) - julianday(start_time)) * 86400 ELSE NULL END) as avg_duration_sec
        FROM agent_tool_executions ate
        JOIN agent_executions ae ON ate.execution_id = ae.id
        WHERE ae.user_id = ? AND ate.start_time > datetime('now', '-7 days')
        GROUP BY tool_name
        HAVING call_count >= 3
        ORDER BY call_count DESC
        LIMIT 20
      `, [userId], (err, rows) => {
        if (err) reject(err); else resolve(rows || []);
      });
    });

    if (toolStats.length === 0) return [];

    const stored = [];
    for (const stat of toolStats) {
      const failRate = stat.fail_count / stat.call_count;
      if (failRate > 0.3) {
        // High failure rate tool
        const toolDescription = `Tool "${stat.tool_name}" has a ${Math.round(failRate * 100)}% failure rate over ${stat.call_count} calls in the last 7 days.`;
        const insightId = await this._storeInsightWithDedup(userId, {
          sourceType: 'tool_call',
          sourceId: 'aggregate',
          sourceContext: { period: '7d' },
          targetType: 'tool',
          targetId: stat.tool_name,
          category: 'bottleneck',
          title: `High failure rate: ${stat.tool_name}`,
          description: toolDescription,
          evidence: { callCount: stat.call_count, successCount: stat.success_count, failCount: stat.fail_count, avgDuration: stat.avg_duration_sec },
          confidence: Math.min(0.9, 0.5 + (stat.call_count / 50)),
        });
        await this._storeMemory('orchestrator', userId, `[Tool Issue] ${toolDescription}`, 'tool_insight');
        if (insightId) stored.push(insightId);
      }
    }

    console.log(`[InsightEngine] Extracted ${stored.length} insights from tool usage aggregation`);
    return stored;
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Build a trace string from agent chat execution data.
   */
  static _buildChatTrace(execution, toolExecutions, conversationLog) {
    const maxChars = 1500;
    let trace = `=== AGENT CHAT EXECUTION ===
Agent: ${execution.agentName || execution.agentId || 'Unknown'}
Status: ${execution.status}
Tool Calls: ${execution.toolCallsCount || 0}
Duration: ${execution.endTime && execution.startTime ? Math.round((new Date(execution.endTime) - new Date(execution.startTime)) / 1000) + 's' : 'unknown'}

`;

    // Add conversation messages (summarized)
    if (conversationLog?.full_history) {
      try {
        const messages = JSON.parse(conversationLog.full_history);
        const userMessages = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content.substring(0, 200) : '');
        trace += `=== USER MESSAGES ===\n${userMessages.join('\n---\n').substring(0, maxChars)}\n\n`;
      } catch { /* ignore */ }
    }

    // Add tool executions
    if (toolExecutions.length > 0) {
      trace += `=== TOOL EXECUTIONS ===\n`;
      for (const te of toolExecutions.slice(0, 15)) {
        const input = te.input ? String(typeof te.input === 'string' ? te.input : JSON.stringify(te.input)).substring(0, 200) : '';
        const output = te.output ? String(typeof te.output === 'string' ? te.output : JSON.stringify(te.output)).substring(0, 200) : '';
        trace += `Tool: ${te.toolName || te.tool_name} [${te.status}]\n  Input: ${input}\n  Output: ${output}\n\n`;
      }
    }

    // Final response (summarized)
    if (execution.finalResponse) {
      trace += `=== FINAL RESPONSE ===\n${execution.finalResponse.substring(0, maxChars)}\n`;
    }

    return trace;
  }

  /**
   * Build a trace string from workflow execution data.
   */
  static _buildWorkflowTrace(execution, nodeExecutions) {
    let trace = `=== WORKFLOW EXECUTION ===
Workflow: ${execution.workflow_name || execution.workflow_id}
Status: ${execution.status}
Duration: ${execution.end_time && execution.start_time ? Math.round((new Date(execution.end_time) - new Date(execution.start_time)) / 1000) + 's' : 'unknown'}

=== NODE EXECUTIONS ===
`;
    for (const ne of nodeExecutions.slice(0, 20)) {
      const output = ne.output ? String(typeof ne.output === 'string' ? ne.output : JSON.stringify(ne.output)).substring(0, 300) : '';
      trace += `Node: ${ne.node_id} [${ne.status}]
  Duration: ${ne.end_time && ne.start_time ? Math.round((new Date(ne.end_time) - new Date(ne.start_time)) / 1000) + 's' : 'unknown'}
  Error: ${ne.error || 'None'}
  Output: ${output}

`;
    }

    return trace;
  }

  /**
   * Use LLM to extract insights from a chat trace.
   */
  static async _llmExtractChatInsights(trace, userId, provider = null, model = null) {
    const messages = [
      {
        role: 'system',
        content: `You are an AI behavior analyst. Extract reusable insights from agent chat execution traces.

Extract insights in these categories:
1. **memory** — Facts about the user, their preferences, or corrections they gave (memory_type: fact, preference, or correction)
2. **prompt_refinement** — Ways the agent's system prompt could be improved based on what worked/didn't
3. **tool_preference** — Tool usage patterns or preferences observed

Return ONLY a valid JSON array (no markdown, no fences):
[
  {
    "category": "memory|prompt_refinement|tool_preference",
    "title": "Short descriptive title",
    "description": "Detailed description of the insight",
    "evidence": "Specific reference from the trace",
    "confidence": 0.7,
    "memoryType": "fact|preference|correction",
    "memoryContent": "The memory to store (for memory category only)"
  }
]

Rules:
- Only extract insights with clear evidence from the trace
- Skip trivial or generic observations
- Maximum 5 insights per extraction
- For memory items, write the memoryContent as a concise statement the agent should remember
- Return an empty array [] if no meaningful insights can be extracted`,
      },
      { role: 'user', content: trace },
    ];

    try {
      const result = await this._callLlm(userId, messages, provider, model);
      return this._parseJsonArray(result);
    } catch (error) {
      console.error('[InsightEngine] LLM chat insight extraction failed:', error.message);
      return [];
    }
  }

  /**
   * Use LLM to extract insights from a workflow trace.
   */
  static async _llmExtractWorkflowInsights(trace, userId, provider = null, model = null) {
    const messages = [
      {
        role: 'system',
        content: `You are a workflow optimization analyst. Analyze workflow execution traces and extract improvement insights.

Extract insights in these categories:
1. **bottleneck** — Nodes that are slow, failing, or causing issues
2. **parameter_tune** — Parameter values that should be adjusted
3. **pattern** — Successful patterns worth preserving

Return ONLY a valid JSON array (no markdown, no fences):
[
  {
    "category": "bottleneck|parameter_tune|pattern",
    "title": "Short descriptive title",
    "description": "Detailed description",
    "evidence": "Specific reference from the trace",
    "confidence": 0.7
  }
]

Rules:
- Only extract insights with clear evidence
- Maximum 5 insights
- Return an empty array [] if no meaningful insights`,
      },
      { role: 'user', content: trace },
    ];

    try {
      const result = await this._callLlm(userId, messages, provider, model);
      return this._parseJsonArray(result);
    } catch (error) {
      console.error('[InsightEngine] LLM workflow insight extraction failed:', error.message);
      return [];
    }
  }

  /**
   * Store an insight with deduplication.
   * Returns the insight ID (new or existing reinforced).
   */
  static async _storeInsightWithDedup(userId, data) {
    try {
      // Check for existing duplicate
      const existing = await InsightModel.findDuplicate(userId, data.targetType, data.targetId, data.category, data.title);
      if (existing) {
        // Reinforce existing insight
        await InsightModel.reinforce(existing.id);
        console.log(`[InsightEngine] Reinforced existing insight ${existing.id} (count: ${existing.occurrence_count + 1})`);
        return existing.id;
      }

      // Create new insight
      const id = await InsightModel.create({ userId, ...data });
      return id;
    } catch (error) {
      console.error('[InsightEngine] Failed to store insight:', error.message);
      return null;
    }
  }

  /**
   * Map insight category + source type to a memory type.
   */
  static _insightToMemoryType(category, sourceType) {
    if (category === 'memory') return null; // caller provides via raw.memoryType
    if (category === 'prompt_refinement') return 'prompt_guidance';
    if (category === 'tool_preference') return 'tool_insight';
    if (category === 'pattern') return 'pattern';
    if (category === 'antipattern') return 'pattern';
    if (category === 'bottleneck') return sourceType === 'workflow' ? 'workflow_insight' : 'tool_insight';
    if (category === 'parameter_tune') return 'workflow_insight';
    return 'fact';
  }

  /**
   * Store a memory in the agent_memory table with deduplication.
   * Used by all extraction methods to persist learnings.
   */
  static async _storeMemory(agentId, userId, content, memoryType, conversationId = null) {
    try {
      const resolvedAgentId = agentId || 'orchestrator';

      const existing = await AgentMemoryModel.findDuplicate(resolvedAgentId, content);
      if (existing) {
        await AgentMemoryModel.update(existing.id, { relevanceScore: Math.min(2.0, existing.relevance_score + 0.2) });
        return existing.id;
      }

      return await AgentMemoryModel.create({
        agentId: resolvedAgentId,
        userId,
        memoryType,
        content,
        sourceConversationId: conversationId,
      });
    } catch (error) {
      console.error('[InsightEngine] Failed to store memory:', error.message);
      return null;
    }
  }

  /**
   * Call the LLM using the standard createLlmClient + createLlmAdapter pattern.
   * Same approach as PluginGenerator, OrchestratorService, etc.
   */
  static async _callLlm(userId, messages, provider = null, model = null) {
    let rawProvider = provider;
    if (!rawProvider || !model) {
      const UserModel = (await import('../../models/UserModel.js')).default;
      const userSettings = await UserModel.getUserSettings(userId);
      if (!rawProvider) rawProvider = userSettings?.selectedProvider;
      if (!model) model = userSettings?.selectedModel;
    }
    if (!rawProvider) throw new Error('No AI provider configured');

    // Normalize provider the same way the orchestrator does
    const providerConfig = getProviderConfig(rawProvider);
    const normalizedProvider = providerConfig ? providerConfig.key : rawProvider.toLowerCase();

    // Validate that the model belongs to the resolved provider.
    // If mismatched (e.g. stale DB default), pick the first available model.
    const ProviderRegistry = await import('../ai/ProviderRegistry.js');
    const providerModels = ProviderRegistry.getTextModels(normalizedProvider);
    if (providerModels.length > 0 && !providerModels.includes(model)) {
      model = providerModels[0];
    }

    const client = await createLlmClient(normalizedProvider, userId);
    const adapter = await createLlmAdapter(normalizedProvider, client, model);
    const result = await adapter.call(messages, []);

    if (result.responseMessage?.content) {
      if (typeof result.responseMessage.content === 'string') {
        return result.responseMessage.content;
      }
      if (Array.isArray(result.responseMessage.content)) {
        return result.responseMessage.content.map(block => block.text || '').join('');
      }
    }
    return '';
  }

  /**
   * Parse a JSON array from potentially messy LLM output.
   */
  static _parseJsonArray(rawOutput) {
    try {
      let cleaned = rawOutput;
      if (typeof cleaned === 'string') {
        cleaned = cleaned
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
      }
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

export default InsightEngine;
