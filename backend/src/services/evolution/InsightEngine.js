import InsightModel from '../../models/InsightModel.js';
import AgentMemoryModel from '../../models/AgentMemoryModel.js';
import StreamEngine from '../../stream/StreamEngine.js';

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
    const { agentId, conversationId } = context;
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
    const rawInsights = await this._llmExtractChatInsights(trace, userId);
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

      // If this is a memory-type insight and we have a specific agent, store in agent_memory
      if (raw.category === 'memory' && agentId && !isOrchestratorChat) {
        await this._storeAgentMemory(agentId, userId, raw, conversationId);
      }

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
    // Import TraceAnalyzer to reuse existing analysis
    const TraceAnalyzer = (await import('../goal/TraceAnalyzer.js')).default;
    const analysis = await TraceAnalyzer.analyzeTrace(goalId, userId);
    if (!analysis) return [];

    const stored = [];

    // Convert patterns to insights
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
      if (insightId) stored.push(insightId);
    }

    // Convert antipatterns to insights
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
      if (insightId) stored.push(insightId);
    }

    // Convert higher-order insights
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
      if (insightId) stored.push(insightId);
    }

    console.log(`[InsightEngine] Extracted ${stored.length} insights from goal ${goalId}`);
    return stored;
  }

  /**
   * Extract insights from a workflow execution.
   */
  static async _extractFromWorkflow(executionId, userId, context) {
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
    const rawInsights = await this._llmExtractWorkflowInsights(trace, userId);
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
        const insightId = await this._storeInsightWithDedup(userId, {
          sourceType: 'tool_call',
          sourceId: 'aggregate',
          sourceContext: { period: '7d' },
          targetType: 'tool',
          targetId: stat.tool_name,
          category: 'bottleneck',
          title: `High failure rate: ${stat.tool_name}`,
          description: `Tool "${stat.tool_name}" has a ${Math.round(failRate * 100)}% failure rate over ${stat.call_count} calls in the last 7 days.`,
          evidence: { callCount: stat.call_count, successCount: stat.success_count, failCount: stat.fail_count, avgDuration: stat.avg_duration_sec },
          confidence: Math.min(0.9, 0.5 + (stat.call_count / 50)),
        });
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
  static async _llmExtractChatInsights(trace, userId) {
    const streamEngine = new StreamEngine(userId);

    const prompt = `You are an AI behavior analyst. Analyze this agent chat execution trace and extract reusable insights.

${trace}

---

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
- Return an empty array [] if no meaningful insights can be extracted`;

    try {
      const resolved = await this._resolveProviderForCompletion(userId);
      if (!resolved) return [];

      const result = await streamEngine.generateCompletion(prompt, resolved.provider, resolved.model);
      if (streamEngine._lastCompletionUsage) {
        const u = streamEngine._lastCompletionUsage;
        console.log(`[InsightEngine] Chat extraction tokens: ${(u.prompt_tokens || u.input_tokens || 0)} in / ${(u.completion_tokens || u.output_tokens || 0)} out`);
      }

      return this._parseJsonArray(result);
    } catch (error) {
      console.error('[InsightEngine] LLM chat insight extraction failed:', error.message);
      return [];
    }
  }

  /**
   * Use LLM to extract insights from a workflow trace.
   */
  static async _llmExtractWorkflowInsights(trace, userId) {
    const streamEngine = new StreamEngine(userId);

    const prompt = `You are a workflow optimization analyst. Analyze this workflow execution trace and extract improvement insights.

${trace}

---

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
- Return an empty array [] if no meaningful insights`;

    try {
      const resolved = await this._resolveProviderForCompletion(userId);
      if (!resolved) return [];

      const result = await streamEngine.generateCompletion(prompt, resolved.provider, resolved.model);
      if (streamEngine._lastCompletionUsage) {
        const u = streamEngine._lastCompletionUsage;
        console.log(`[InsightEngine] Workflow extraction tokens: ${(u.prompt_tokens || u.input_tokens || 0)} in / ${(u.completion_tokens || u.output_tokens || 0)} out`);
      }

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
   * Store a memory fact in agent_memory table.
   */
  static async _storeAgentMemory(agentId, userId, raw, conversationId) {
    try {
      const content = raw.memoryContent || raw.description;

      // Check for duplicate
      const existing = await AgentMemoryModel.findDuplicate(agentId, content);
      if (existing) {
        // Update relevance score
        await AgentMemoryModel.update(existing.id, { relevanceScore: Math.min(2.0, existing.relevance_score + 0.2) });
        return existing.id;
      }

      return await AgentMemoryModel.create({
        agentId,
        userId,
        memoryType: raw.memoryType || 'fact',
        content,
        sourceConversationId: conversationId,
      });
    } catch (error) {
      console.error('[InsightEngine] Failed to store agent memory:', error.message);
      return null;
    }
  }

  /**
   * Resolve a provider/model pair that generateCompletion actually supports.
   * Custom providers (Z.AI, etc.) aren't in the switch — fall back to a known one.
   */
  static async _resolveProviderForCompletion(userId) {
    const UserModel = (await import('../../models/UserModel.js')).default;
    const userSettings = await UserModel.getUserSettings(userId);
    let provider = userSettings?.selectedProvider;
    let model = userSettings?.selectedModel;
    if (!provider) return null;

    // Providers that generateCompletion's switch statement supports
    const supportedProviders = new Set([
      'anthropic', 'claude-code', 'cerebras', 'deepseek', 'openai',
      'openai-codex', 'openai-codex-cli', 'openrouter', 'togetherai',
      'gemini', 'gemini-cli', 'grokai', 'groq', 'kimi', 'minimax', 'local',
    ]);

    if (supportedProviders.has(provider.toLowerCase())) {
      return { provider, model };
    }

    // Unsupported provider (Z.AI, custom, etc.) — try openrouter as fallback
    // since most custom providers are OpenAI-compatible and often routed via OpenRouter
    console.log(`[InsightEngine] Provider "${provider}" not supported by generateCompletion, trying openrouter fallback`);
    try {
      const { createLlmClient } = await import('../../services/ai/LlmService.js');
      const client = await createLlmClient('openrouter', userId);
      if (client) return { provider: 'openrouter', model: null };
    } catch { /* no openrouter configured */ }

    // Try other common fallbacks
    for (const fallback of ['anthropic', 'openai', 'groq', 'gemini']) {
      try {
        const { createLlmClient } = await import('../../services/ai/LlmService.js');
        const client = await createLlmClient(fallback, userId);
        if (client) {
          console.log(`[InsightEngine] Using fallback provider: ${fallback}`);
          return { provider: fallback, model: null };
        }
      } catch { /* not configured */ }
    }

    console.warn(`[InsightEngine] No supported provider found for insight extraction`);
    return null;
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
