import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';
import CodexAuthManager from '../auth/CodexAuthManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOOL_RUNNER_PATH = path.resolve(__dirname, '../../cli/runTool.js');
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const DEFAULT_CODEX_WORKDIR = process.env.AGNT_CODEX_WORKDIR || path.join(os.homedir(), 'services', 'agnt-codex-work');

function ensureDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (error) {
    console.warn(`[Codex CLI] Failed to ensure workdir '${dirPath}':`, error?.message || error);
  }
}

ensureDirectory(DEFAULT_CODEX_WORKDIR);

function resolveCodexBin() {
  const managerBin = CodexAuthManager?.codexBin;
  if (typeof managerBin === 'string' && managerBin.trim()) {
    return managerBin.trim();
  }

  const envBin = typeof process.env.CODEX_BIN === 'string' ? process.env.CODEX_BIN.trim() : '';
  if (envBin) return envBin;

  try {
    const nvmNodeDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmNodeDir)) {
      const versions = fs
        .readdirSync(nvmNodeDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      for (let i = versions.length - 1; i >= 0; i -= 1) {
        const candidate = path.join(nvmNodeDir, versions[i], 'bin', 'codex');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // Fall back to PATH lookup.
  }

  return 'codex';
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

class CodexCliService {
  constructor() {
    this.codexBin = resolveCodexBin();
  }

  getCodexBin() {
    return this.codexBin;
  }

  async runExecStream(
    {
      prompt,
      model,
      cwd = DEFAULT_CODEX_WORKDIR,
      extraArgs = [],
      resumeThreadId = null,
      fullAuto = true,
      userId = null,
      conversationId = null,
      authToken = null,
      provider = 'openai-codex-cli',
    },
    { onDelta, onEvent } = {}
  ) {
    if (!prompt || !String(prompt).trim()) {
      throw new Error('Codex CLI prompt is required.');
    }

    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (fullAuto) {
      args.push('--full-auto');
    }
    if (resumeThreadId) {
      args.push('resume', String(resumeThreadId));
    }
    if (model) {
      args.push('-m', model);
    }
    if (Array.isArray(extraArgs) && extraArgs.length > 0) {
      args.push(...extraArgs);
    }
    args.push(String(prompt));

    const env = { ...process.env };
    if (userId) env.AGNT_USER_ID = String(userId);
    if (conversationId) env.AGNT_CONVERSATION_ID = String(conversationId);
    if (authToken) env.AGNT_AUTH_TOKEN = String(authToken);
    if (provider) env.AGNT_PROVIDER = String(provider);
    env.AGNT_TOOL_RUNNER = TOOL_RUNNER_PATH;
    env.AGNT_BACKEND_ROOT = BACKEND_ROOT;
    env.AGNT_REPO_ROOT = REPO_ROOT;

    const child = spawn(this.codexBin, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let lastAgentMessage = '';
    let usage = null;
    let errorEvent = null;
    let threadId = resumeThreadId ? String(resumeThreadId) : null;

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      const event = safeJsonParse(line);
      if (!event) return;

      onEvent?.(event);

      if (event.type === 'thread.started' && event.thread_id) {
        threadId = String(event.thread_id);
        return;
      }

      if (event.type === 'error') {
        errorEvent = event;
        return;
      }

      if (event.type === 'turn.completed' && event.usage) {
        usage = event.usage;
        return;
      }

      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const text = typeof event.item.text === 'string' ? event.item.text : '';
        if (!text) return;

        // Emit only the new suffix when possible to avoid duplicate chunks.
        let delta = text;
        if (lastAgentMessage && text.startsWith(lastAgentMessage)) {
          delta = text.slice(lastAgentMessage.length);
        }
        lastAgentMessage = text;

        if (delta) {
          onDelta?.(delta, { fullText: text });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', (err) => reject(err));
      child.on('close', (code) => resolve(code ?? 1));
    });

    rl.close();

    if (errorEvent) {
      const message =
        errorEvent.message ||
        errorEvent.error?.message ||
        errorEvent.error ||
        'Codex CLI reported an error.';
      throw new Error(message);
    }

    if (exitCode !== 0 && !lastAgentMessage) {
      const detail = stderr ? stderr.trim() : `codex exec exited with code ${exitCode}`;
      throw new Error(detail);
    }

    return {
      text: lastAgentMessage,
      usage,
      exitCode,
      stderr: stderr.trim() || null,
      threadId,
    };
  }
}

export default new CodexCliService();
