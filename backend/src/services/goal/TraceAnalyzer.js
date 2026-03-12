import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import GoalIterationModel from '../../models/GoalIterationModel.js';
import GoalEvaluator from './GoalEvaluator.js';
import { createLlmClient } from '../ai/LlmService.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { getProviderConfig } from '../ai/providerConfigs.js';
import { isEnabled as isUnfirehoseEnabled } from '../unfirehose/UnfirehoseLogger.js';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

/**
 * TraceAnalyzer — LLM-as-Judge that reviews goal execution traces
 * to extract reusable patterns and generate skill candidates.
 */
class TraceAnalyzer {
  /**
   * Analyze a completed goal's execution traces.
   * @param {string} goalId - The completed goal to analyze
   * @param {string} userId - Owner of the goal
   * @returns {Object|null} TraceAnalysis with patterns, antipatterns, insights, skillCandidate
   */
  static async analyzeTrace(goalId, userId, provider = null, model = null) {
    try {
      console.log(`[TraceAnalyzer] Starting trace analysis for goal ${goalId}`);

      // Gather execution data
      const goal = await GoalModel.findOne(goalId);
      if (!goal) {
        console.log(`[TraceAnalyzer] Goal ${goalId} not found`);
        return null;
      }

      const tasks = await TaskModel.findByGoalId(goalId);
      const iterations = await GoalIterationModel.findByGoalId(goalId);

      // Guard: need at least 1 task with some data to analyze
      if (tasks.length === 0) {
        console.log(`[TraceAnalyzer] Skipping — no tasks found for goal ${goalId}`);
        return null;
      }

      // Get evaluation report
      let evaluation = null;
      try {
        evaluation = await GoalEvaluator.getEvaluationReport(goalId);
      } catch (e) {
        console.log(`[TraceAnalyzer] No evaluation report available: ${e.message}`);
      }

      const evalScore = evaluation?.overall_score || evaluation?.evaluation_data?.scores?.overall || 0;

      // Build trace document
      let traceDoc = this._buildTraceDocument(goal, tasks, iterations, evaluation);

      // Enrich with unfirehose execution logs if available
      try {
        if (isUnfirehoseEnabled()) {
          const enrichment = await this._getUnfirehoseEnrichment(goal, tasks);
          if (enrichment) {
            traceDoc += enrichment;
            console.log(`[TraceAnalyzer] Enriched trace with unfirehose execution logs`);
          }
        }
      } catch (err) {
        console.log(`[TraceAnalyzer] Unfirehose enrichment skipped: ${err.message}`);
      }

      // Determine if we should generate a skill candidate
      const generateSkill = evalScore >= 30;

      // Send to LLM Judge
      const analysis = await this._llmJudgeAnalysis(traceDoc, userId, generateSkill, provider, model);
      if (!analysis) {
        console.log(`[TraceAnalyzer] LLM judge returned no usable analysis`);
        return null;
      }

      console.log(`[TraceAnalyzer] Analysis complete — quality: ${analysis.traceQuality}, patterns: ${analysis.patterns?.length || 0}, candidate: ${analysis.skillCandidate?.shouldGenerate ? 'yes' : 'no'}`);

      return analysis;
    } catch (error) {
      console.error(`[TraceAnalyzer] Error analyzing trace for goal ${goalId}:`, error);
      return null;
    }
  }

  /**
   * Build structured trace document from execution data.
   * @private
   */
  static _buildTraceDocument(goal, tasks, iterations, evaluation) {
    const maxOutputChars = 2000;

    let doc = `=== GOAL ===
Title: ${goal.title}
Description: ${goal.description}
Success Criteria: ${JSON.stringify(goal.success_criteria || {}, null, 2)}
Status: ${goal.status}
Priority: ${goal.priority || 'medium'}
Total Iterations: ${iterations.length}

=== TASKS ===
`;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      let output = '';
      try {
        const raw = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;
        output = raw ? JSON.stringify(raw).substring(0, maxOutputChars) : 'No output';
      } catch {
        output = String(task.output || '').substring(0, maxOutputChars);
      }

      let toolsUsed = '[]';
      try {
        toolsUsed = JSON.stringify(task.required_tools ? (typeof task.required_tools === 'string' ? JSON.parse(task.required_tools) : task.required_tools) : []);
      } catch { /* ignore */ }

      doc += `Task #${i + 1}: ${task.title}
  Status: ${task.status}
  Agent: ${task.agent_id || 'unassigned'}
  Tools: ${toolsUsed}
  Output: ${output}
  Error: ${task.error || 'None'}
  Duration: ${task.started_at && task.completed_at ? `${Math.round((new Date(task.completed_at) - new Date(task.started_at)) / 1000)}s` : 'unknown'}

`;
    }

    doc += `=== ITERATION HISTORY ===
`;

    for (const iter of iterations) {
      doc += `Iteration #${iter.iteration_number}:
  Score: ${iter.evaluation_score != null ? `${iter.evaluation_score}%` : 'N/A'}
  Passed: ${iter.evaluation_passed ? 'Yes' : 'No'}
  Replanned Tasks: ${JSON.stringify(iter.replanned_tasks || [])}
  Duration: ${iter.duration_ms ? `${Math.round(iter.duration_ms / 1000)}s` : 'unknown'}

`;
    }

    doc += `=== EVALUATION ===
`;
    if (evaluation) {
      const scores = evaluation.evaluation_data?.scores || {};
      doc += `Overall Score: ${evaluation.overall_score || scores.overall || 'N/A'}%
Completeness: ${scores.completeness || 'N/A'}%
Quality: ${scores.quality || 'N/A'}%
Feedback: ${evaluation.feedback || 'No feedback'}
`;
      if (evaluation.taskEvaluations) {
        doc += `Per-Task Scores:\n`;
        for (const te of evaluation.taskEvaluations) {
          doc += `  - ${te.task_id || te.taskId}: ${te.score}%\n`;
        }
      }
    } else {
      doc += `No evaluation data available.\n`;
    }

    return doc;
  }

  /**
   * Send trace document to LLM-as-Judge for structured analysis.
   * @private
   */
  static async _llmJudgeAnalysis(traceDoc, userId, generateSkill = true, provider = null, model = null) {
    const skillInstructions = generateSkill
      ? `6. SKILL CANDIDATE
   - Based on the patterns above, generate a reusable SKILL.md candidate
   - Include: strategy overview, step-by-step approach, tool usage guidance, anti-patterns, recovery strategies
   - Set shouldGenerate to true only if patterns are strong and transferable
   - Set confidence (0.0-1.0) based on evidence strength`
      : `6. SKILL CANDIDATE
   - Set shouldGenerate to false (score too low for skill generation)`;

    const prompt = `You are an expert AI systems researcher. You analyze execution traces from autonomous AI agents to extract reusable strategies and patterns.

Your analysis must be EVIDENCE-BASED — every pattern you identify must reference specific moments in the trace that demonstrate it.

---

TRACE DOCUMENT:
${traceDoc}

---

ANALYSIS RUBRIC:

1. TOOL SEQUENCE PATTERNS
   - What sequences of tool calls led to successful task completion?
   - Were there tool combinations that consistently worked together?
   - What was the optimal ordering?

2. PROMPT/APPROACH PATTERNS
   - What approaches in task execution worked well?
   - Were there specific strategies the agent used that drove success?

3. ERROR RECOVERY PATTERNS
   - How were failures handled?
   - What recovery strategies worked?

4. EFFICIENCY PATTERNS
   - Were there unnecessary steps that could be skipped?
   - What was the minimum viable tool sequence?

5. TRANSFERABILITY ASSESSMENT
   - Could these patterns work for similar future tasks?
   - What is category-specific vs. universally applicable?

${skillInstructions}

---

OUTPUT FORMAT (respond with valid JSON only, no markdown fences):
{
  "traceQuality": "high|medium|low",
  "overallAssessment": "1-2 sentence summary",
  "patterns": [
    {
      "name": "kebab-case-pattern-name",
      "type": "tool_sequence|prompt_strategy|error_recovery|efficiency",
      "description": "What the pattern does and why it works",
      "toolSequence": ["tool_name_1", "tool_name_2"],
      "whenToUse": "Context where this pattern applies",
      "effectiveness": 0.85,
      "evidence": "Specific trace reference"
    }
  ],
  "antipatterns": [
    {
      "name": "kebab-case-antipattern-name",
      "description": "What went wrong and why",
      "avoidWhen": "Context where this should be avoided",
      "evidence": "Specific trace reference"
    }
  ],
  "insights": ["Higher-order observation 1"],
  "skillCandidate": {
    "shouldGenerate": true,
    "confidence": 0.82,
    "name": "Descriptive Skill Name",
    "category": "research|coding|analysis|communication|planning|debugging",
    "description": "One-line description",
    "allowedTools": ["tool1", "tool2"],
    "instructions": "Full markdown content for a SKILL.md file including strategy, steps, anti-patterns, and recovery.",
    "estimatedEffectiveness": 0.78
  }
}`;

    try {
      // Use passed provider/model, fall back to user settings
      let rawProvider = provider;
      let resolvedModel = model;
      if (!rawProvider || !resolvedModel) {
        const UserModel = (await import('../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);
        if (!rawProvider) rawProvider = userSettings?.selectedProvider;
        if (!resolvedModel) resolvedModel = userSettings?.selectedModel;
      }

      if (!rawProvider || !resolvedModel) {
        console.error('[TraceAnalyzer] No provider/model configured');
        return null;
      }

      const _cfg = getProviderConfig(rawProvider);
      const normalizedProvider = _cfg ? _cfg.key : rawProvider.toLowerCase();
      const client = await createLlmClient(normalizedProvider, userId);
      const adapter = await createLlmAdapter(normalizedProvider, client, resolvedModel);
      const adapterResult = await adapter.call([
        { role: 'system', content: 'You are an expert AI systems researcher. Analyze execution traces and return valid JSON only.' },
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

      return this._validateAnalysis(result);
    } catch (error) {
      console.error('[TraceAnalyzer] LLM judge analysis failed:', error);
      return null;
    }
  }

  /**
   * Validate and parse LLM judge output.
   * @private
   */
  static _validateAnalysis(rawOutput) {
    try {
      let cleaned = rawOutput;
      if (typeof cleaned === 'string') {
        cleaned = cleaned
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
      }

      const analysis = JSON.parse(cleaned);

      // Validate required fields
      if (!analysis.traceQuality || !analysis.patterns) {
        console.error('[TraceAnalyzer] Invalid analysis structure — missing required fields');
        return null;
      }

      // Ensure arrays exist
      analysis.patterns = Array.isArray(analysis.patterns) ? analysis.patterns : [];
      analysis.antipatterns = Array.isArray(analysis.antipatterns) ? analysis.antipatterns : [];
      analysis.insights = Array.isArray(analysis.insights) ? analysis.insights : [];

      // Validate skill candidate if present
      if (analysis.skillCandidate && analysis.skillCandidate.shouldGenerate) {
        const sc = analysis.skillCandidate;
        if (!sc.name || !sc.instructions || !sc.category) {
          console.log('[TraceAnalyzer] Skill candidate missing required fields, disabling');
          analysis.skillCandidate.shouldGenerate = false;
        }
      }

      return analysis;
    } catch (error) {
      console.error('[TraceAnalyzer] Failed to parse LLM judge output:', error);
      return null;
    }
  }

  /**
   * Scan unfirehose session files for execution logs that overlap with the goal's timeframe.
   * Returns an enrichment string to append to the trace document, or null.
   * @private
   */
  static async _getUnfirehoseEnrichment(goal, tasks) {
    const baseDir = process.env.UNFIREHOSE_DIR || join(homedir(), '.agnt', 'unfirehose');

    // Determine execution time window from tasks
    const startTimes = tasks.filter(t => t.started_at).map(t => new Date(t.started_at).getTime());
    const endTimes = tasks.filter(t => t.completed_at).map(t => new Date(t.completed_at).getTime());
    if (startTimes.length === 0) return null;

    const windowStart = Math.min(...startTimes) - 60000; // 1 min buffer
    const windowEnd = endTimes.length > 0 ? Math.max(...endTimes) + 60000 : Date.now();

    const matchingSessions = [];

    const projectDirs = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
    for (const dirent of projectDirs) {
      if (!dirent.isDirectory()) continue;
      if (matchingSessions.length >= 5) break;

      const dirPath = join(baseDir, dirent.name);
      const files = (await readdir(dirPath).catch(() => [])).filter(f => f.endsWith('.jsonl'));

      // Only check the most recent 50 files per directory
      for (const file of files.slice(-50)) {
        if (matchingSessions.length >= 5) break;

        const filePath = join(dirPath, file);
        const content = await readFile(filePath, 'utf-8').catch(() => '');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) continue;

        try {
          const envelope = JSON.parse(lines[0]);
          if (envelope.type !== 'session') continue;

          const sessionTime = new Date(envelope.createdAt).getTime();
          if (sessionTime >= windowStart && sessionTime <= windowEnd) {
            const messages = [];
            for (let i = 1; i < lines.length; i++) {
              try {
                const parsed = JSON.parse(lines[i]);
                if (parsed.type === 'message') messages.push(parsed);
              } catch { /* skip malformed lines */ }
            }
            matchingSessions.push({ envelope, messages });
          }
        } catch { continue; }
      }
    }

    if (matchingSessions.length === 0) return null;

    // Build enrichment section (capped at 50 entries to keep prompt manageable)
    let enrichment = `\n=== DETAILED EXECUTION LOG (unfirehose) ===\n`;
    enrichment += `Sessions found: ${matchingSessions.length}\n\n`;

    let entryCount = 0;
    for (const session of matchingSessions) {
      enrichment += `--- Session: ${session.envelope.id} (${session.envelope.chatType || 'unknown'}) ---\n`;

      for (const msg of session.messages) {
        if (entryCount >= 50) break;

        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          // Log tool calls with their inputs
          for (const block of msg.content) {
            if (block.type === 'tool-call') {
              const inputStr = JSON.stringify(block.input || {}).substring(0, 500);
              enrichment += `Tool Call: ${block.toolName}\n  Input: ${inputStr}\n`;
              entryCount++;
            }
          }
          // Log assistant reasoning (first text block, truncated)
          const textBlock = msg.content.find(b => b.type === 'text');
          if (textBlock?.text && textBlock.text.length > 10) {
            enrichment += `Agent Reasoning: ${textBlock.text.substring(0, 300)}\n`;
            entryCount++;
          }
        }

        if (msg.role === 'tool' && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool-result') {
              const outputStr = String(block.output || '').substring(0, 300);
              enrichment += `Tool Result: ${block.toolName} ${block.isError ? '[ERROR]' : '[OK]'}\n  Output: ${outputStr}\n`;
              entryCount++;
            }
          }
        }
      }

      if (entryCount >= 50) {
        enrichment += `... (truncated, ${entryCount} entries shown)\n`;
        break;
      }
    }

    return enrichment;
  }
}

export default TraceAnalyzer;
