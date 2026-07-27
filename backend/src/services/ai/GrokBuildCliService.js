/**
 * GrokBuildCliService — headless runner for the Grok Build CLI.
 *
 * Spawns: grok -p <prompt> --output-format streaming-json --always-approve …
 * Parses NDJSON events:
 *   { type: "thought", data: "…" }
 *   { type: "text", data: "…" }
 *   { type: "end", sessionId, usage, stopReason, … }
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import GrokBuildAuthManager from '../auth/GrokBuildAuthManager.js';
import { augmentEnvPath } from '../../utils/envPath.js';

const DEFAULT_GROK_WORKDIR =
  process.env.AGNT_GROK_WORKDIR || path.join(os.homedir(), 'services', 'agnt-grok-work');

const FALLBACK_DEFAULT_MODEL = 'grok-4.5';
const DEFAULT_TIMEOUT_MS = Number(process.env.AGNT_GROK_TIMEOUT_MS) || 15 * 60 * 1000;
const PROMPT_FILE_THRESHOLD = 80 * 1024;

function ensureDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (error) {
    console.warn(`[Grok Build CLI] Failed to ensure workdir '${dirPath}':`, error?.message || error);
  }
}

// Deliberately NO ensureDirectory() at module scope: tools.js imports this
// file unconditionally, so an import-time mkdir would write to the user's
// home directory on every backend boot (and in every test run) whether or
// not Grok Build is ever used. runExec ensures the workdir when it runs.

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isModelNotSupportedError(error) {
  const message = String(error?.message || error || '');
  if (!/model/i.test(message)) return false;
  return /not supported|unsupported|unknown model|does not exist|not found|no access|not available|invalid params/i.test(
    message
  );
}

/**
 * Pure parser for streaming-json NDJSON lines. Exported for unit tests.
 * @param {string[]} lines
 * @returns {{ text: string, thoughts: string, sessionId: string|null, usage: object|null, stopReason: string|null, error: string|null }}
 */
export function parseStreamingJsonLines(lines) {
  let text = '';
  let thoughts = '';
  let sessionId = null;
  let usage = null;
  let stopReason = null;
  let error = null;

  for (const line of lines) {
    if (!line || !String(line).trim()) continue;
    const event = safeJsonParse(String(line).trim());
    if (!event || typeof event !== 'object') {
      // Non-JSON line — treat as plain text fallback fragment
      if (!text && String(line).trim()) {
        text += (text ? '' : '') + String(line);
      }
      continue;
    }

    const type = event.type || event.event || '';

    if (type === 'text' || type === 'message' || type === 'assistant' || type === 'delta') {
      const chunk =
        typeof event.data === 'string'
          ? event.data
          : typeof event.delta === 'string'
            ? event.delta
            : typeof event.content === 'string'
              ? event.content
              : typeof event.text === 'string'
                ? event.text
                : '';
      if (chunk) text += chunk;
      continue;
    }

    if (type === 'thought' || type === 'thinking' || type === 'reasoning') {
      const chunk = typeof event.data === 'string' ? event.data : typeof event.text === 'string' ? event.text : '';
      if (chunk) thoughts += chunk;
      continue;
    }

    if (type === 'end' || type === 'result' || type === 'done') {
      if (event.sessionId || event.session_id) {
        sessionId = String(event.sessionId || event.session_id);
      }
      if (event.usage) usage = event.usage;
      if (event.stopReason || event.stop_reason) {
        stopReason = event.stopReason || event.stop_reason;
      }
      if (typeof event.result === 'string' && !text) text = event.result;
      continue;
    }

    if (type === 'error') {
      error =
        event.message ||
        event.error?.message ||
        (typeof event.data === 'string' ? event.data : null) ||
        'Grok Build CLI reported an error.';
      continue;
    }

    // session-only events
    if (event.sessionId || event.session_id) {
      sessionId = String(event.sessionId || event.session_id);
    }
  }

  return { text, thoughts, sessionId, usage, stopReason, error };
}

class GrokBuildCliService {
  constructor() {
    this.grokBin = GrokBuildAuthManager.getGrokBin();
  }

  getGrokBin() {
    this.grokBin = GrokBuildAuthManager.getGrokBin();
    return this.grokBin;
  }

  getDefaultModel() {
    const envModel =
      typeof process.env.AGNT_GROK_DEFAULT_MODEL === 'string'
        ? process.env.AGNT_GROK_DEFAULT_MODEL.trim()
        : '';
    return envModel || FALLBACK_DEFAULT_MODEL;
  }

  getDefaultWorkdir() {
    return DEFAULT_GROK_WORKDIR;
  }

  /**
   * Run headless Grok Build with automatic model fallback if the requested
   * model id is rejected by the account.
   */
  async runExecStream(options = {}, handlers = {}) {
    try {
      return await this._runExecStreamOnce(options, handlers);
    } catch (error) {
      if (options.model && isModelNotSupportedError(error)) {
        console.warn(
          `[Grok Build CLI] Model '${options.model}' rejected (${error.message}). ` +
            "Retrying with the account's default model. " +
            'Set AGNT_GROK_DEFAULT_MODEL to a supported model to skip this retry.'
        );
        return await this._runExecStreamOnce({ ...options, model: null }, handlers);
      }
      throw error;
    }
  }

  async _runExecStreamOnce(
    {
      prompt,
      model,
      cwd = DEFAULT_GROK_WORKDIR,
      extraArgs = [],
      resumeSessionId = null,
      alwaysApprove = true,
      maxTurns = 30,
      effort = null,
      readOnly = false,
      noPlan = true,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      userId = null,
      conversationId = null,
      authToken = null,
    },
    { onDelta, onEvent, onThought } = {}
  ) {
    if (!prompt || !String(prompt).trim()) {
      throw new Error('Grok Build CLI prompt is required.');
    }

    ensureDirectory(cwd);

    const promptStr = String(prompt);
    const args = [];

    // Resume / continue
    if (resumeSessionId) {
      args.push('--resume', String(resumeSessionId));
    }

    // Prompt: use --prompt-file for large prompts to avoid OS arg limits
    let promptFilePath = null;
    if (promptStr.length > PROMPT_FILE_THRESHOLD) {
      promptFilePath = path.join(
        os.tmpdir(),
        `agnt-grok-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
      );
      fs.writeFileSync(promptFilePath, promptStr, 'utf8');
      args.push('--prompt-file', promptFilePath);
    } else {
      args.push('-p', promptStr);
    }

    args.push('--output-format', 'streaming-json');
    if (alwaysApprove) args.push('--always-approve');
    if (noPlan) args.push('--no-plan');
    if (maxTurns != null) args.push('--max-turns', String(maxTurns));
    if (model) args.push('-m', String(model));
    if (cwd) args.push('--cwd', String(cwd));
    if (effort) args.push('--effort', String(effort));

    if (readOnly) {
      // Restrict to read tools only — exact tool names may vary by CLI version
      args.push('--tools', 'read_file,grep,list_dir,glob,web_search');
    }

    if (Array.isArray(extraArgs) && extraArgs.length > 0) {
      args.push(...extraArgs.filter((a) => typeof a === 'string'));
    }

    const env = { ...process.env };
    if (userId) env.AGNT_USER_ID = String(userId);
    if (conversationId) env.AGNT_CONVERSATION_ID = String(conversationId);
    if (authToken) env.AGNT_AUTH_TOKEN = String(authToken);
    env.AGNT_PROVIDER = 'grok-build';
    // GUI-launched processes on macOS get a minimal PATH
    augmentEnvPath(env);

    const bin = this.getGrokBin();
    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let lastText = '';
    let sessionId = resumeSessionId ? String(resumeSessionId) : null;
    let usage = null;
    let stopReason = null;
    let errorMessage = null;
    const rawLines = [];

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      rawLines.push(line);
      const event = safeJsonParse(line);
      if (!event) {
        // plain-text fallback line
        if (line && line.trim()) {
          lastText += (lastText ? '' : '') + line;
          onDelta?.(line, { fullText: lastText });
        }
        return;
      }

      onEvent?.(event);

      const type = event.type || event.event || '';

      if (type === 'text' || type === 'message' || type === 'assistant' || type === 'delta') {
        const chunk =
          typeof event.data === 'string'
            ? event.data
            : typeof event.delta === 'string'
              ? event.delta
              : typeof event.content === 'string'
                ? event.content
                : typeof event.text === 'string'
                  ? event.text
                  : '';
        if (chunk) {
          lastText += chunk;
          onDelta?.(chunk, { fullText: lastText });
        }
        return;
      }

      if (type === 'thought' || type === 'thinking' || type === 'reasoning') {
        const chunk = typeof event.data === 'string' ? event.data : '';
        if (chunk) onThought?.(chunk);
        return;
      }

      if (type === 'end' || type === 'result' || type === 'done') {
        if (event.sessionId || event.session_id) {
          sessionId = String(event.sessionId || event.session_id);
        }
        if (event.usage) usage = event.usage;
        if (event.stopReason || event.stop_reason) {
          stopReason = event.stopReason || event.stop_reason;
        }
        if (typeof event.result === 'string' && !lastText) {
          lastText = event.result;
          onDelta?.(event.result, { fullText: lastText });
        }
        return;
      }

      if (type === 'error') {
        errorMessage =
          event.message ||
          event.error?.message ||
          (typeof event.data === 'string' ? event.data : null) ||
          'Grok Build CLI reported an error.';
        return;
      }

      if (event.sessionId || event.session_id) {
        sessionId = String(event.sessionId || event.session_id);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGTERM');
            } catch {
              // ignore
            }
          }, timeoutMs)
        : null;

    let exitCode;
    try {
      exitCode = await new Promise((resolve, reject) => {
        child.on('error', (err) => reject(err));
        child.on('close', (code) => resolve(code ?? 1));
      });
    } finally {
      if (timer) clearTimeout(timer);
      rl.close();
      if (promptFilePath) {
        try {
          fs.unlinkSync(promptFilePath);
        } catch {
          // ignore
        }
      }
    }

    // If streaming-json produced nothing useful, try plain parse of full stdout buffer
    if (!lastText && rawLines.length > 0) {
      const parsed = parseStreamingJsonLines(rawLines);
      if (parsed.text) lastText = parsed.text;
      if (parsed.sessionId && !sessionId) sessionId = parsed.sessionId;
      if (parsed.usage && !usage) usage = parsed.usage;
      if (parsed.error && !errorMessage) errorMessage = parsed.error;
    }

    // stderr may contain model-not-found before any JSON
    if (!lastText && stderr) {
      const errLine = stderr.trim();
      if (/unknown model|invalid params|not authenticated/i.test(errLine)) {
        throw new Error(errLine.split('\n')[0]);
      }
    }

    if (errorMessage && !lastText) {
      throw new Error(errorMessage);
    }

    if (timedOut && !lastText) {
      throw new Error(`Grok Build CLI timed out after ${timeoutMs}ms`);
    }

    if (exitCode !== 0 && !lastText) {
      const detail = stderr ? stderr.trim() : `grok exited with code ${exitCode}`;
      throw new Error(detail);
    }

    return {
      text: lastText,
      sessionId,
      usage,
      exitCode,
      stderr: stderr.trim() || null,
      stopReason,
      timedOut,
    };
  }
}

export default new GrokBuildCliService();
