import { spawn } from 'child_process';
import path from 'path';

const DEFAULT_MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 1000 * 60 * 15;
const KILL_GRACE_MS = 10_000;
const LEASE_STOP_TIMEOUT_MS = 60_000;
const LEASE_VALUE_FLAGS = new Map([
  ['provider', '--provider'],
  ['profile', '--profile'],
  ['ttl', '--ttl'],
  ['idleTimeout', '--idle-timeout'],
  ['className', '--class'],
  ['arch', '--arch'],
  ['os', '--os'],
  ['machineType', '--type'],
  ['market', '--market'],
  ['slug', '--slug'],
  ['target', '--target'],
  ['windowsMode', '--windows-mode'],
  ['network', '--network'],
]);

const RUN_VALUE_FLAGS = new Map([
  ['leaseId', '--id'],
  ['stopAfter', '--stop-after'],
  ['label', '--label'],
  ['leaseOutput', '--lease-output'],
  ['envFromProfile', '--env-from-profile'],
  ['script', '--script'],
  ['freshPr', '--fresh-pr'],
  ['preflightTools', '--preflight-tools'],
  ['junit', '--junit'],
  ['emitProof', '--emit-proof'],
]);

const LEASE_BOOLEAN_FLAGS = new Map([
  ['keep', '--keep'],
  ['reclaim', '--reclaim'],
  ['desktop', '--desktop'],
  ['browser', '--browser'],
  ['code', '--code'],
  ['tailscale', '--tailscale'],
  ['debug', '--debug'],
]);

const RUN_BOOLEAN_FLAGS = new Map([
  ['keepOnFailure', '--keep-on-failure'],
  ['fullResync', '--full-resync'],
  ['noSync', '--no-sync'],
  ['noHydrate', '--no-hydrate'],
  ['checksum', '--checksum'],
  ['forceSyncLarge', '--force-sync-large'],
  ['preflight', '--preflight'],
  ['resultsAuto', '--results-auto'],
  ['applyLocalPatch', '--apply-local-patch'],
  ['scriptStdin', '--script-stdin'],
]);

const INIT_VALUE_FLAGS = new Map([
  ['configPath', '--config'],
  ['workflowPath', '--workflow'],
  ['skillPath', '--skill'],
]);

const INIT_BOOLEAN_FLAGS = new Map([
  ['detect', '--detect'],
  ['force', '--force'],
]);

function truthy(value) {
  return value === true || value === 'true' || value === '1' || value === 1 || value === 'Yes' || value === 'yes';
}

function explicitlyDisabled(value) {
  return value === false || value === 'false' || value === '0' || value === 0 || value === 'No' || value === 'no';
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

function appendMappedFlags(args, flagMap, params) {
  for (const [key, flag] of flagMap) {
    const value = compact(params[key]);
    if (value !== undefined) {
      args.push(flag, String(value));
    }
  }
}

function appendMappedBooleans(args, flagMap, params) {
  for (const [key, flag] of flagMap) {
    if (truthy(params[key])) {
      args.push(flag);
    }
  }
}

function appendRepeatable(args, flag, value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim())
      : [];

  for (const item of values) {
    if (item) {
      args.push(flag, String(item));
    }
  }
}

function appendExtraArgs(args, value) {
  const extraArgs = parseCommandLine(value);
  if (extraArgs.includes('--')) {
    throw new Error('extraArgs must not include --; command separation is managed by the Crabbox tool');
  }
  args.push(...extraArgs);
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
    case 'INSPECT':
      args.push('inspect');
      break;
    case 'DOCTOR':
      args.push('doctor');
      break;
    case 'SYNC_PLAN':
      args.push('sync-plan');
      break;
    case 'INIT':
      args.push('init');
      break;
    case 'JOB_LIST':
      args.push('job', 'list');
      break;
    case 'JOB_RUN':
      args.push('job', 'run');
      break;
    case 'VERSION':
      args.push('--version');
      return args;
    default:
      throw new Error(`Unsupported Crabbox action: ${params.action}`);
  }

  if (action === 'RUN' || action === 'WARMUP') {
    appendMappedFlags(args, LEASE_VALUE_FLAGS, params);
    appendMappedBooleans(args, LEASE_BOOLEAN_FLAGS, params);
  }

  if (action === 'RUN') {
    appendMappedFlags(args, RUN_VALUE_FLAGS, params);
    appendMappedBooleans(args, RUN_BOOLEAN_FLAGS, params);
    if (!explicitlyDisabled(params.timingJson)) {
      args.push('--timing-json');
    }

    for (const envName of normalizeAllowEnv(params.allowEnv)) {
      args.push('--allow-env', envName);
    }

    appendRepeatable(args, '--artifact-glob', params.artifactGlob);
    appendRepeatable(args, '--require-artifact', params.requireArtifact);
    appendRepeatable(args, '--download', params.download);
  }

  if (action === 'WARMUP' && !explicitlyDisabled(params.timingJson)) {
    args.push('--timing-json');
  }

  if (action === 'RUN' || action === 'WARMUP') {
    appendExtraArgs(args, params.extraArgs);
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

  if (action === 'INSPECT') {
    const id = compact(params.leaseId || params.id);
    if (!id) throw new Error('leaseId is required for Crabbox inspect');
    args.push('--id', String(id));
  }

  if (action === 'DOCTOR') {
    const provider = compact(params.provider);
    if (provider) {
      args.push('--provider', String(provider));
    }
  }

  if (action === 'INIT') {
    appendMappedFlags(args, INIT_VALUE_FLAGS, params);
    appendMappedBooleans(args, INIT_BOOLEAN_FLAGS, params);
  }

  if (action === 'JOB_RUN') {
    const id = compact(params.leaseId || params.id);
    const jobName = compact(params.jobName);
    if (id) args.push('--id', String(id));
    if (truthy(params.noHydrate)) args.push('--no-hydrate');
    if (truthy(params.githubRunner)) args.push('--github-runner');
    if (truthy(params.dryRun)) args.push('--dry-run');
    if (compact(params.stop)) args.push('--stop', String(compact(params.stop)));
    appendExtraArgs(args, params.extraArgs);
    if (!jobName) throw new Error('jobName is required for Crabbox job run');
    args.push(String(jobName));
  }

  if (['STATUS', 'INSPECT', 'LIST', 'DOCTOR', 'SYNC_PLAN', 'INIT', 'JOB_LIST'].includes(action)) {
    appendExtraArgs(args, params.extraArgs);
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

// Minimal allowlist: the server env holds API keys and session secrets that the
// Crabbox CLI must never see. Only PATH/HOME (binary + CLI config resolution)
// and explicit CRABBOX_* settings cross the boundary.
export function buildChildEnv(token, env = process.env) {
  const childEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP']) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('CRABBOX_')) childEnv[key] = value;
  }
  if (token) {
    childEnv.CRABBOX_TOKEN = token;
  }
  return childEnv;
}

class CrabboxPlugin {
  constructor() {
    this.name = 'crabbox';
  }

  async execute(params = {}, inputData, workflowEngine) {
    const { __auth, ...loggableParams } = params;
    console.log('[CrabboxPlugin] Executing with params:', JSON.stringify(loggableParams, null, 2));

    try {
      const token = __auth?.token;
      if (!token) {
        throw new Error(
          'No valid Crabbox credential found. Connect Crabbox (API key) in Settings → Integrations. ' +
            'The Crabbox node never uses the server\'s ambient CLI login.'
        );
      }

      const binary = process.env.CRABBOX_BIN || 'crabbox';
      const args = buildCrabboxArgs(params);
      const cwd = resolveWorkingDirectory(params.workingDirectory);
      const env = buildChildEnv(token);
      const timeoutMs = Number(params.timeoutMs || DEFAULT_TIMEOUT_MS);
      const maxOutputBytes = Number(params.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES);
      const { stdout, stderr, exitCode, signal, timedOut } = await this.runProcess(binary, args, {
        cwd,
        env,
        timeoutMs,
        maxOutputBytes,
      });
      const parsed = parseCrabboxOutput(stdout, stderr);
      const leaseCleanup = await this.cleanupLease({ params, parsed, binary, cwd, env, timedOut, signal });

      return {
        success: exitCode === 0 && !timedOut,
        result: {
          action: (params.action || 'RUN').toUpperCase(),
          args,
          cwd,
          stdout,
          stderr,
          exitCode,
          signal,
          timedOut,
          leaseCleanup,
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

  // A timed-out or signal-killed local CLI never gets to release its remote
  // lease, which keeps billing on the broker side. Stop it explicitly unless
  // the user asked to keep it.
  async cleanupLease({ params, parsed, binary, cwd, env, timedOut, signal }) {
    const action = (params.action || 'RUN').toUpperCase();
    if (!timedOut && !signal) return null;
    if (!['RUN', 'WARMUP'].includes(action)) return null;
    if (!parsed.leaseId) return { attempted: false, reason: 'no lease id found in output' };
    if (truthy(params.keep) || truthy(params.keepOnFailure)) {
      return { attempted: false, reason: `lease ${parsed.leaseId} kept on request` };
    }

    console.warn(`[CrabboxPlugin] Run interrupted; stopping remote lease ${parsed.leaseId}`);
    try {
      const stop = await this.runProcess(binary, ['stop', parsed.leaseId], {
        cwd,
        env,
        timeoutMs: LEASE_STOP_TIMEOUT_MS,
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
      });
      return { attempted: true, leaseId: parsed.leaseId, stopped: stop.exitCode === 0 && !stop.timedOut };
    } catch (error) {
      console.error(`[CrabboxPlugin] Failed to stop lease ${parsed.leaseId}:`, error.message);
      return { attempted: true, leaseId: parsed.leaseId, stopped: false, error: error.message };
    }
  }

  runProcess(binary, args, { cwd, env, timeoutMs, maxOutputBytes }) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killTimer = null;

      const child = spawn(binary, args, {
        cwd,
        env,
        shell: false,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, KILL_GRACE_MS);
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
        clearTimeout(killTimer);
        if (error.code === 'ENOENT') {
          reject(new Error(`Crabbox binary not found: ${binary}. Install from https://crabbox.sh or set CRABBOX_BIN.`));
          return;
        }
        reject(error);
      });

      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
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
