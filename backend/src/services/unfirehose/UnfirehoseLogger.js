/**
 * unfirehose/1.0 — Native JSONL session logger for agnt.
 *
 * File layout:
 *   ~/.agnt/unfirehose/{project-slug}/{session-uuid}.jsonl
 *
 * Each line is a JSON object with $schema: "unfirehose/1.0".
 * Session envelope first, then messages in append-only order.
 */

import { randomUUID } from 'crypto';
import { mkdir, appendFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const UNFIREHOSE_DIR = process.env.UNFIREHOSE_DIR || join(homedir(), '.agnt', 'unfirehose');
const HARNESS = 'agnt';
let HARNESS_VERSION = '0.5.0';

// Try to read version from package.json at startup
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'));
  if (pkg.version) HARNESS_VERSION = pkg.version;
} catch { /* use default */ }

/**
 * Map agnt provider strings to unfirehose provider enum.
 */
function mapProvider(provider) {
  if (!provider) return undefined;
  const p = provider.toLowerCase();
  if (p === 'anthropic' || p.includes('claude')) return 'anthropic';
  if (p === 'openai' || p.includes('gpt') || p.includes('o1') || p.includes('o3')) return 'openai';
  if (p === 'google' || p.includes('gemini')) return 'google';
  if (p === 'local' || p === 'lmstudio' || p.includes('ollama') || p.includes('llama')) return 'local';
  // openrouter, groq, deepseek, cerebras, together — map to provider name
  return undefined;
}

/**
 * Map agnt stop reasons to unfirehose enum.
 */
function mapStopReason(reason) {
  if (!reason) return undefined;
  if (reason === 'stop' || reason === 'end_turn') return 'end_turn';
  if (reason === 'tool_calls' || reason === 'tool_use') return 'tool_calls';
  if (reason === 'length' || reason === 'max_tokens') return 'length';
  if (reason === 'content_filter') return 'content_filter';
  return undefined;
}

/**
 * Encode a filesystem path to a project slug.
 */
function encodeProjectSlug(fsPath) {
  if (!fsPath) return 'default';
  return fsPath.replace(/[\\/:.\s]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Generate a UUIDv7-like ID (time-ordered).
 * Falls back to randomUUID if crypto.randomUUID is available.
 */
function generateSessionId() {
  // UUIDv7: first 48 bits are millisecond timestamp
  const now = Date.now();
  const hex = now.toString(16).padStart(12, '0');
  const uuid = randomUUID();
  // Replace first 12 hex chars with timestamp, set version to 7
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-7' + uuid.slice(15);
}

/**
 * Create a new UnfirehoseSession for logging.
 *
 * @param {object} opts
 * @param {string} [opts.conversationId] - Existing conversation ID (used as session ID)
 * @param {string} [opts.provider] - LLM provider
 * @param {string} [opts.model] - Model name
 * @param {string} [opts.chatType] - agnt chat type (orchestrator, agent, workflow, goal, tool)
 * @param {string} [opts.firstPrompt] - First user message
 * @param {string} [opts.cwd] - Working directory
 * @param {string} [opts.projectSlug] - Project slug override
 * @returns {UnfirehoseSession}
 */
export function createSession(opts = {}) {
  return new UnfirehoseSession(opts);
}

class UnfirehoseSession {
  constructor(opts = {}) {
    this.sessionId = opts.conversationId || generateSessionId();
    this.projectSlug = opts.projectSlug || encodeProjectSlug(opts.cwd || process.cwd());
    this.provider = opts.provider;
    this.model = opts.model;
    this.chatType = opts.chatType;
    this.cwd = opts.cwd || process.cwd();
    this.firstPrompt = opts.firstPrompt;
    this.createdAt = new Date().toISOString();
    this.messageCounter = 0;
    this.lastParentId = null;
    this.totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    // Ensure output directory exists
    this.outputDir = join(UNFIREHOSE_DIR, this.projectSlug);
    this.outputFile = join(this.outputDir, `${this.sessionId}.jsonl`);
    this._dirReady = mkdir(this.outputDir, { recursive: true }).catch(err => {
      console.error('[unfirehose] Failed to create output directory:', err.message);
    });

    // Write session envelope
    this._append({
      $schema: 'unfirehose/1.0',
      type: 'session',
      id: this.sessionId,
      projectId: this.projectSlug,
      status: 'active',
      createdAt: this.createdAt,
      firstPrompt: this.firstPrompt?.substring(0, 500),
      cwd: this.cwd,
      harness: HARNESS,
      harnessVersion: HARNESS_VERSION,
      messageCount: 0,
    });
  }

  /**
   * Log a user message.
   */
  logUserMessage(content, opts = {}) {
    const msgId = this._nextMsgId();
    const blocks = [];

    if (typeof content === 'string') {
      blocks.push({ type: 'text', text: content });
    } else if (Array.isArray(content)) {
      // Multi-part content (vision, etc.)
      for (const part of content) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          blocks.push({ type: 'image', mediaType: 'image/png', data: part.image_url?.url || '' });
        }
      }
    }

    if (blocks.length === 0) {
      blocks.push({ type: 'text', text: String(content) });
    }

    this._appendMessage({
      id: msgId,
      role: 'user',
      content: blocks,
    });

    return msgId;
  }

  /**
   * Log an assistant message (streamed content completed).
   */
  logAssistantMessage(content, opts = {}) {
    const msgId = this._nextMsgId();
    const blocks = [];

    // Text content
    if (content) {
      const text = typeof content === 'string' ? content :
        Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join('') :
        String(content);
      if (text) blocks.push({ type: 'text', text });
    }

    // Tool calls from the assistant
    if (opts.toolCalls && opts.toolCalls.length > 0) {
      for (const tc of opts.toolCalls) {
        let input = {};
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || {});
        } catch { /* leave empty */ }

        blocks.push({
          type: 'tool-call',
          toolCallId: tc.id || randomUUID(),
          toolName: tc.function?.name || 'unknown',
          input,
        });
      }
    }

    // Usage
    const usage = this._extractUsage(opts.usage);

    this._appendMessage({
      id: msgId,
      role: 'assistant',
      content: blocks,
      model: opts.model || this.model,
      provider: mapProvider(opts.provider || this.provider),
      stopReason: mapStopReason(opts.stopReason),
      usage,
      durationMs: opts.durationMs,
      subtype: this.chatType,
    });

    return msgId;
  }

  /**
   * Log a tool result message.
   */
  logToolResult(toolCallId, toolName, output, opts = {}) {
    const msgId = this._nextMsgId();

    let outputStr;
    if (typeof output === 'string') {
      // Truncate massive outputs (>50KB)
      outputStr = output.length > 50000 ? output.substring(0, 50000) + '\n[truncated]' : output;
    } else {
      try {
        const s = JSON.stringify(output);
        outputStr = s.length > 50000 ? s.substring(0, 50000) + '\n[truncated]' : s;
      } catch {
        outputStr = String(output);
      }
    }

    this._appendMessage({
      id: msgId,
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId,
        toolName,
        output: outputStr,
        isError: opts.isError || false,
      }],
    });

    return msgId;
  }

  /**
   * Log a system message.
   */
  logSystemMessage(text) {
    const msgId = this._nextMsgId();
    this._appendMessage({
      id: msgId,
      role: 'system',
      content: [{ type: 'text', text }],
    });
    return msgId;
  }

  /**
   * Log a goal evaluation event as a training run eval.
   */
  logGoalEvaluation(goalId, score, feedback, opts = {}) {
    this._append({
      $schema: 'unfirehose/1.0',
      type: 'run.eval',
      run_id: `goal-${goalId}`,
      step: opts.step || 0,
      eval: feedback || 'goal_evaluation',
      score: typeof score === 'number' ? score : (score ? 1 : 0),
      ts: new Date().toISOString(),
    });
  }

  /**
   * Log a training-related event.
   */
  logTrainingEvent(event) {
    this._append({
      $schema: 'unfirehose/1.0',
      ...event,
    });
  }

  /**
   * Close the session.
   */
  close(opts = {}) {
    this._append({
      $schema: 'unfirehose/1.0',
      type: 'session',
      id: this.sessionId,
      status: 'closed',
      closedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: this.messageCounter,
      totalUsage: this.totalUsage,
      summary: opts.summary,
    });
  }

  // --- Internal methods ---

  _nextMsgId() {
    this.messageCounter++;
    return `${this.sessionId}-${String(this.messageCounter).padStart(4, '0')}`;
  }

  _appendMessage(msg) {
    const full = {
      $schema: 'unfirehose/1.0',
      type: 'message',
      ...msg,
      sessionId: this.sessionId,
      parentId: this.lastParentId,
      timestamp: new Date().toISOString(),
      harness: HARNESS,
      harnessVersion: HARNESS_VERSION,
      cwd: this.cwd,
    };

    this.lastParentId = msg.id;
    this._append(full);
  }

  _extractUsage(usage) {
    if (!usage) return undefined;
    const u = {};
    if (usage.prompt_tokens != null || usage.inputTokens != null) {
      u.inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
      this.totalUsage.inputTokens += u.inputTokens;
    }
    if (usage.completion_tokens != null || usage.outputTokens != null) {
      u.outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
      this.totalUsage.outputTokens += u.outputTokens;
    }
    if (u.inputTokens != null || u.outputTokens != null) {
      u.totalTokens = (u.inputTokens || 0) + (u.outputTokens || 0);
      this.totalUsage.totalTokens += u.totalTokens;
    }
    // Cache tokens (Anthropic)
    if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
      u.inputTokenDetails = {};
      if (usage.cache_read_input_tokens) u.inputTokenDetails.cacheReadTokens = usage.cache_read_input_tokens;
      if (usage.cache_creation_input_tokens) u.inputTokenDetails.cacheWriteTokens = usage.cache_creation_input_tokens;
    }
    return Object.keys(u).length > 0 ? u : undefined;
  }

  async _append(obj) {
    const op = (async () => {
      try {
        await this._dirReady;
        await appendFile(this.outputFile, JSON.stringify(obj) + '\n');
      } catch (err) {
        console.error('[unfirehose] Write failed:', err.message);
      }
    })();
    this._pendingWrites = (this._pendingWrites || Promise.resolve()).then(() => op);
  }

  /**
   * Wait for all pending writes to complete (useful for testing).
   */
  async flush() {
    await this._pendingWrites;
  }
}

/**
 * Wrap the sendEvent function to intercept SSE events and log them.
 * This is the main integration point — wraps universalChatHandler's sendEvent.
 *
 * @param {UnfirehoseSession} session
 * @param {Function} originalSendEvent
 * @returns {Function} wrapped sendEvent
 */
export function wrapSendEvent(session, originalSendEvent) {
  let assistantContent = '';
  let assistantToolCalls = [];
  let assistantStartTime = null;
  let currentModel = null;
  let currentProvider = null;

  return function instrumentedSendEvent(eventName, data) {
    // Always forward to original
    originalSendEvent(eventName, data);

    // Intercept and log to unfirehose
    try {
      switch (eventName) {
        case 'assistant_message':
          // Reset accumulator for new assistant turn
          assistantContent = '';
          assistantToolCalls = [];
          assistantStartTime = Date.now();
          break;

        case 'content_delta':
          // Accumulate streamed content
          if (data.accumulated != null) {
            assistantContent = data.accumulated;
          } else if (data.delta) {
            assistantContent += data.delta;
          }
          break;

        case 'tool_start':
          // Track tool call (will be logged with assistant message)
          if (data.toolCall) {
            assistantToolCalls.push({
              id: data.toolCall.id,
              function: {
                name: data.toolCall.name,
                arguments: JSON.stringify(data.toolCall.args || {}),
              },
            });
          }
          break;

        case 'tool_end':
          // Log tool result
          if (data.toolCall) {
            const isError = !!data.toolCall.error;
            const output = data.toolCall.error
              ? { error: data.toolCall.error }
              : (data.toolCall.result || data.toolCall.output || 'completed');
            session.logToolResult(
              data.toolCall.id,
              data.toolCall.name || 'unknown',
              output,
              { isError }
            );
          }
          break;

        case 'final_content':
          // Log the completed assistant message with all accumulated tool calls
          if (assistantContent || assistantToolCalls.length > 0) {
            session.logAssistantMessage(
              data.content || assistantContent,
              {
                toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined,
                durationMs: assistantStartTime ? Date.now() - assistantStartTime : undefined,
                model: currentModel,
                provider: currentProvider,
              }
            );
          }
          break;

        case 'tool_executions':
          // After a round of tool calls, the LLM will respond again
          // Log the assistant message that contained the tool calls
          if (assistantToolCalls.length > 0) {
            session.logAssistantMessage(
              assistantContent,
              {
                toolCalls: assistantToolCalls,
                stopReason: 'tool_calls',
                durationMs: assistantStartTime ? Date.now() - assistantStartTime : undefined,
                model: currentModel,
                provider: currentProvider,
              }
            );
            // Reset for next turn
            assistantContent = '';
            assistantToolCalls = [];
            assistantStartTime = Date.now();
          }
          break;

        case 'done':
          // Close the session
          session.close({
            summary: assistantContent?.substring(0, 200),
          });
          break;

        case 'error':
          if (data.error) {
            session.logSystemMessage(`[error] ${data.error}`);
          }
          break;
      }
    } catch (err) {
      console.error('[unfirehose] Event interception error:', err.message);
    }
  };
}

/**
 * Check if unfirehose logging is enabled.
 * Disabled by default. Enable with UNFIREHOSE_ENABLED=1.
 */
export function isEnabled() {
  return process.env.UNFIREHOSE_ENABLED === '1';
}

export default { createSession, wrapSendEvent, isEnabled };
