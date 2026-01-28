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
  // First try CodexAuthManager which has comprehensive platform detection
  const managerBin = CodexAuthManager?.codexBin;
  if (typeof managerBin === 'string' && managerBin.trim()) {
    return managerBin.trim();
  }

  const envBin = typeof process.env.CODEX_BIN === 'string' ? process.env.CODEX_BIN.trim() : '';
  if (envBin) return envBin;

  const isWindows = process.platform === 'win32';
  const home = os.homedir();

  // Helper to find first existing path
  const findFirst = (candidates) => {
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  // Helper to find latest version in a node versions directory
  const findInNodeVersions = (baseDir, binSubpath) => {
    try {
      if (!fs.existsSync(baseDir)) return null;
      const versions = fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      for (let i = versions.length - 1; i >= 0; i -= 1) {
        const candidate = path.join(baseDir, versions[i], binSubpath);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  };

  if (isWindows) {
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;

    // Windows npm global install
    if (appData) {
      const npmGlobal = findFirst([
        path.join(appData, 'npm', 'codex.cmd'),
        path.join(appData, 'npm', 'codex'),
      ]);
      if (npmGlobal) return npmGlobal;
    }

    // Windows nvm (nvm-windows)
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      const nvmBin = findInNodeVersions(nvmHome, 'codex.cmd') || findInNodeVersions(nvmHome, 'codex');
      if (nvmBin) return nvmBin;
    }

    // Windows fnm
    if (localAppData) {
      const fnmDir = path.join(localAppData, 'fnm_multishells');
      if (fs.existsSync(fnmDir)) {
        const fnmBin = findInNodeVersions(fnmDir, 'codex.cmd') || findInNodeVersions(fnmDir, 'codex');
        if (fnmBin) return fnmBin;
      }
    }
  } else {
    // macOS / Linux

    // Common global npm locations
    const globalPaths = findFirst([
      '/usr/local/bin/codex',
      path.join(home, '.npm-global', 'bin', 'codex'),
      path.join(home, '.local', 'bin', 'codex'),
    ]);
    if (globalPaths) return globalPaths;

    // Homebrew (macOS)
    if (process.platform === 'darwin') {
      const brewPaths = findFirst([
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
      ]);
      if (brewPaths) return brewPaths;
    }

    // nvm (Linux/macOS)
    const nvmNodeDir = path.join(home, '.nvm', 'versions', 'node');
    const nvmBin = findInNodeVersions(nvmNodeDir, path.join('bin', 'codex'));
    if (nvmBin) return nvmBin;

    // fnm (Linux/macOS)
    const fnmNodeDir = path.join(home, '.fnm', 'node-versions');
    const fnmBin = findInNodeVersions(fnmNodeDir, path.join('installation', 'bin', 'codex'));
    if (fnmBin) return fnmBin;

    // volta
    const voltaBin = path.join(home, '.volta', 'bin', 'codex');
    if (fs.existsSync(voltaBin)) return voltaBin;

    // asdf
    const asdfNodeDir = path.join(home, '.asdf', 'installs', 'nodejs');
    const asdfBin = findInNodeVersions(asdfNodeDir, path.join('bin', 'codex'));
    if (asdfBin) return asdfBin;
  }

  // Fallback to PATH lookup
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

  getDefaultWorkdir() {
    return DEFAULT_CODEX_WORKDIR;
  }

  getToolRunnerPath() {
    return TOOL_RUNNER_PATH;
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

    const promptStr = String(prompt);
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (fullAuto) {
      args.push('--full-auto');
    }
    // Model flag must come BEFORE resume subcommand (resume inherits model but we set it anyway for new sessions)
    if (model && !resumeThreadId) {
      args.push('-m', model);
    }
    if (resumeThreadId) {
      // When resuming, use config override for model since resume subcommand doesn't accept -m
      if (model) {
        args.push('-c', `model="${model}"`);
      }
      args.push('resume', String(resumeThreadId));
    }
    if (Array.isArray(extraArgs) && extraArgs.length > 0) {
      args.push(...extraArgs);
    }

    const isWindows = process.platform === 'win32';

    // Always use stdin for prompts to avoid shell quoting issues and command line limits
    // This is especially important on Windows where shell: true causes argument splitting
    args.push('-'); // Read from stdin

    const env = { ...process.env };
    if (userId) env.AGNT_USER_ID = String(userId);
    if (conversationId) env.AGNT_CONVERSATION_ID = String(conversationId);
    if (authToken) env.AGNT_AUTH_TOKEN = String(authToken);
    if (provider) env.AGNT_PROVIDER = String(provider);
    env.AGNT_TOOL_RUNNER = TOOL_RUNNER_PATH;
    env.AGNT_BACKEND_ROOT = BACKEND_ROOT;
    env.AGNT_REPO_ROOT = REPO_ROOT;

    const spawnOptions = {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'], // Always use pipe for stdin
    };

    // On Windows, .cmd files need shell: true to execute properly
    if (isWindows) {
      spawnOptions.shell = true;
    }

    const child = spawn(this.codexBin, args, spawnOptions);

    // Write prompt to stdin
    child.stdin.write(promptStr);
    child.stdin.end();

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
