import { spawn } from 'child_process';
import path from 'path';

const DEFAULT_MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 1000 * 60 * 60 * 2;
const RUN_ACTIONS = new Set(['RUN', 'WARMUP']);
const VALUE_FLAGS = new Map([
  ['provider', '--provider'],
  ['leaseId', '--id'],
  ['ttl', '--ttl'],
  ['idleTimeout', '--idle-timeout'],
  ['className', '--class'],
  ['arch', '--arch'],
  ['os', '--os'],
  ['machineType', '--type'],
  ['market', '--market'],
  ['slug', '--slug'],
  ['stopAfter', '--stop-after'],
  ['envFromProfile', '--env-from-profile'],
]);

const BOOLEAN_FLAGS = new Map([
  ['keep', '--keep'],
  ['keepOnFailure', '--keep-on-failure'],
  ['fullResync', '--full-resync'],
  ['noSync', '--no-sync'],
  ['noHydrate', '--no-hydrate'],
  ['preflight', '--preflight'],
  ['debug', '--debug'],
  ['resultsAuto', '--results-auto'],
]);

function truthy(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function compact(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseCommandLine(command) {
  if (Array.isArray(command)) {
    return command.map(String).filter((part) => part.length > 0);
  }

  if (typeof command !== 'string' || command.trim() === '') {
    return [];
  }

  const args = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    throw new Error(`Unclosed ${quote} quote in command`);
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export function normalizeAllowEnv(value) {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeAllowEnv);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildCrabboxArgs(params = {}) {
  const action = (params.action || 'RUN').toUpperCase();
  const args = [];

  switch (action) {
    case 'RUN':
      args.push('run');
      break;
    case 'WARMUP':
      args.push('warmup');
      break;
    case 'STATUS':
      args.push('status');
      break;
    case 'LIST':
      args.push('list');
      break;
    case 'STOP':
      args.push('stop');
      break;
    case 'DOCTOR':
      args.push('doctor');
      break;
    case 'VERSION':
      args.push('--version');
      return args;
    default:
      throw new Error(`Unsupported Crabbox action: ${params.action}`);
  }

  if (RUN_ACTIONS.has(action)) {
    for (const [key, flag] of VALUE_FLAGS) {
      const value = compact(params[key]);
      if (value !== undefined) {
        args.push(flag, String(value));
      }
    }

    for (const [key, flag] of BOOLEAN_FLAGS) {
      if (truthy(params[key])) {
        args.push(flag);
      }
    }

    if (params.timingJson !== false && params.timingJson !== 'false') {
      args.push('--timing-json');
    }

    for (const envName of normalizeAllowEnv(params.allowEnv)) {
      args.push('--allow-env', envName);
    }
  }

  if (action === 'STATUS') {
    const id = compact(params.leaseId || params.id);
    if (!id) throw new Error('leaseId is required for Crabbox status');
    args.push('--id', String(id));
    if (truthy(params.wait)) {
      args.push('--wait');
    }
  }

  if (action === 'LIST') {
    const provider = compact(params.provider);
    if (provider) {
      args.push('--provider', String(provider));
    }
  }

  if (action === 'STOP') {
    const id = compact(params.leaseId || params.id);
    if (!id) throw new Error('leaseId is required for Crabbox stop');
    args.push(String(id));
  }

  if (action === 'DOCTOR') {
    const provider = compact(params.provider);
    if (provider) {
      args.push('--provider', String(provider));
    }
  }

  if (action === 'RUN') {
    const command = compact(params.command);
    if (!command) {
      throw new Error('command is required for Crabbox run');
    }

    if (truthy(params.shell)) {
      args.push('--shell', '--', command);
    } else {
      const commandArgs = parseCommandLine(command);
      if (commandArgs.length === 0) {
        throw new Error('command is required for Crabbox run');
      }
      args.push('--', ...commandArgs);
    }
  }

  return args;
}

function appendBounded(target, chunk, maxBytes) {
  const next = target + chunk;
  if (Buffer.byteLength(next) <= maxBytes) {
    return next;
  }

  const overflowMarker = '\n[agnt: output truncated]\n';
  const keepBytes = Math.max(0, maxBytes - Buffer.byteLength(overflowMarker));
  return overflowMarker + Buffer.from(next).subarray(-keepBytes).toString('utf8');
}

export function parseCrabboxOutput(stdout = '', stderr = '') {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let timing = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;

    try {
      const parsed = JSON.parse(line);
      if (
        parsed &&
        (parsed.provider || parsed.leaseId || parsed.runId || parsed.exitCode !== undefined || parsed.totalMs !== undefined)
      ) {
        timing = parsed;
        break;
      }
    } catch {
      // Not every JSON-looking line is the timing record.
    }
  }

  return {
    timing,
    provider: timing?.provider || combined.match(/\bprovider[=:]\s*([a-z0-9_-]+)/i)?.[1] || null,
    leaseId: timing?.leaseId || combined.match(/\b(?:leaseId|lease id|id)[=:]\s*((?:cbx|tbx)_[a-z0-9_-]+)/i)?.[1] || null,
    runId: timing?.runId || combined.match(/\brunId[=:]\s*([a-z0-9_-]+)/i)?.[1] || null,
    slug: timing?.slug || combined.match(/\bslug[=:]\s*([a-z0-9_-]+)/i)?.[1] || null,
    stopCommand: timing?.stopCommand || combined.match(/crabbox stop[^\r\n]*/i)?.[0] || null,
    exitCode: timing?.exitCode ?? null,
  };
}

export function resolveWorkingDirectory(workingDirectory) {
  const requested = compact(workingDirectory);
  if (!requested) {
    return process.cwd();
  }

  return path.resolve(requested);
}

class CrabboxPlugin {
  constructor() {
    this.name = 'crabbox';
  }

  async execute(params = {}) {
    console.log('[CrabboxPlugin] Executing with params:', JSON.stringify({ ...params, command: params.command }, null, 2));

    try {
      const binary = compact(params.binary) || process.env.CRABBOX_BIN || 'crabbox';
      const args = buildCrabboxArgs(params);
      const cwd = resolveWorkingDirectory(params.workingDirectory);
      const timeoutMs = Number(params.timeoutMs || DEFAULT_TIMEOUT_MS);
      const maxOutputBytes = Number(params.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES);
      const { stdout, stderr, exitCode, signal, timedOut } = await this.runProcess(binary, args, {
        cwd,
        timeoutMs,
        maxOutputBytes,
      });
      const parsed = parseCrabboxOutput(stdout, stderr);

      return {
        success: exitCode === 0 && !timedOut,
        result: {
          action: (params.action || 'RUN').toUpperCase(),
          binary,
          args,
          cwd,
          stdout,
          stderr,
          exitCode,
          signal,
          timedOut,
          ...parsed,
        },
        error: exitCode === 0 && !timedOut ? null : this.formatError(exitCode, signal, timedOut, stderr),
      };
    } catch (error) {
      console.error('[CrabboxPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  runProcess(binary, args, { cwd, timeoutMs, maxOutputBytes }) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(binary, args, {
        cwd,
        env: process.env,
        shell: false,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        process.stdout.write(text);
        stdout = appendBounded(stdout, text, maxOutputBytes);
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        process.stderr.write(text);
        stderr = appendBounded(stderr, text, maxOutputBytes);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        if (error.code === 'ENOENT') {
          reject(new Error(`Crabbox binary not found: ${binary}. Install from https://crabbox.sh or set CRABBOX_BIN.`));
          return;
        }
        reject(error);
      });

      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode, signal, timedOut });
      });
    });
  }

  formatError(exitCode, signal, timedOut, stderr) {
    if (timedOut) {
      return 'Crabbox command timed out.';
    }
    const tail = stderr.trim().split(/\r?\n/).slice(-5).join('\n');
    return `Crabbox exited with ${signal ? `signal ${signal}` : `code ${exitCode}`}${tail ? `: ${tail}` : ''}`;
  }
}

export default new CrabboxPlugin();
