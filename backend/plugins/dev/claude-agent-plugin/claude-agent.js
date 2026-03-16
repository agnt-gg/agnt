import { query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';


/**
 * ClaudeAgent Tool
 *
 * Uses the Claude Agent SDK to perform autonomous tasks within AGNT workflows.
 */
class ClaudeAgent {
  constructor() {
    this.name = 'claude-agent';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[ClaudeAgent] Starting task:', params.prompt);

    try {
      // 1. Resolve API Key
      const apiKey = params.__auth?.token;
      if (!apiKey) {
        throw new Error('Not connected to Anthropic. Connect in Settings → Connections.');
      }

      // Set API key for the SDK (SDK often expects it in env or via config)
      process.env.ANTHROPIC_API_KEY = apiKey;

      // 2. Prepare Tools
      // We will bridge existing AGNT tools to Claude SDK tools
      const allowedToolsList = params.allowedTools ? params.allowedTools.split(',').map((t) => t.trim()) : [];

      const { bridgeTools } = await import('./bridge-tools.js');
      const bridgedTools = await bridgeTools(workflowEngine, allowedToolsList);

      // 3. Configure Options
      const options = {
        permissionMode: params.permissionMode || 'default',
        maxBudgetUsd: params.maxBudgetUsd || 1.0,
        systemPrompt: params.systemPrompt
          ? { type: 'preset', preset: 'claude_code', append: params.systemPrompt }
          : { type: 'preset', preset: 'claude_code' },
        sandbox: {
          enabled: params.useSandbox === 'true' || params.useSandbox === true,
        },
        cwd: workflowEngine.cwd || process.cwd(),
      };

      // 4. Run the Agent
      let finalResult = '';
      let totalCost = 0;
      let totalTurns = 0;
      let success = false;

      const queryStream = query({
        prompt: params.prompt,
        options: options,
      });

      for await (const message of queryStream) {
        // Lifecycle check: stop requested?
        if (workflowEngine.stopRequested) {
          console.log('[ClaudeAgent] Workflow stop requested, interrupting query...');
          if (typeof queryStream.interrupt === 'function') {
            await queryStream.interrupt();
          }
          break;
        }

        // Handle different message types from the SDK
        switch (message.type) {
          case 'assistant':
            // Partial text updates could be logged here
            break;
          case 'result':
            success = message.subtype === 'success';
            finalResult = message.result;
            totalCost = message.total_cost_usd;
            totalTurns = message.num_turns;
            break;
          case 'error':
            throw new Error(`SDK Error: ${message.message}`);
        }
      }

      return {
        success,
        result: finalResult,
        totalCost,
        turns: totalTurns,
        error: null,
      };
    } catch (error) {
      console.error('[ClaudeAgent] Execution failed:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }
}

export default new ClaudeAgent();
