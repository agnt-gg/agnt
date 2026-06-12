import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const DEFAULT_MAX_OUTPUT_BYTES = 200_000;
const MAX_OUTPUT_BYTES_CAP = 5_000_000;
const DEFAULT_TIMEOUT_MS = 1000 * 60 * 15;
const MAX_TIMEOUT_MS = 1000 * 60 * 60;
const MIN_TIMEOUT_MS = 1000;
const KILL_GRACE_MS = 10_000;
const STREAM_FLUSH_GRACE_MS = 2_000;
const LEASE_STOP_TIMEOUT_MS = 60_000;

// Lease ids and job names are passed to the CLI as bare positionals, so a
// value starting with '-' would be parsed as a flag (e.g. `stop --all`).
const POSITIONAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function explicitlyDisabled(value) {
  if (value === false || value === 0) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'no';
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
  const chars = Array.from(command.trim());
  let current = '';
  let quote = null;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];

    // Backslash escapes only quotes, backslashes, and whitespace (never inside
    // single quotes), so Windows paths like C:\temp pass through literally.
    if (char === '\\' && quote !== "'") {
      const next = chars[index + 1];
      if (next === '"' || next === "'" || next === '\\' || (next !== undefined && /\s/.test(next))) {
        current += next;
        index += 1;
        continue;
      }
      current += char;
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

export function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function assertSafePositional(value, label) {
  const candidate = String(value);
  if (!POSITIONAL_PATTERN.test(candidate)) {
    throw new Error(`${label} contains unsupported characters: ${candidate}`);
  }
  return candidate;
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
    args.push(assertSafePositional(id, 'leaseId'));
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
    args.push(assertSafePositional(jobName, 'jobName'));
  }

  if (['STATUS', 'INSPECT', 'LIST', 'STOP', 'DOCTOR', 'SYNC_PLAN', 'INIT', 'JOB_LIST'].includes(action)) {
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

export function appendBounded(target, chunk, maxBytes) {
  const next = target + chunk;
  if (Buffer.byteLength(next) <= maxBytes) {
    return next;
  }

  const overflowMarker = '\n[agnt: output truncated]\n';
  const keepBytes = Math.max(0, maxBytes - Buffer.byteLength(overflowMarker));
  const buffer = Buffer.from(next);
  let start = buffer.length - keepBytes;
  // Never start the retained tail mid-way through a multi-byte UTF-8 character.
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return overflowMarker + buffer.subarray(start).toString('utf8');
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
    stopCommand: timing?.stopCommand || combined.match(/crabbox stop\s+[a-z0-9._-]+/i)?.[0] || null,
    exitCode: timing?.exitCode ?? null,
  };
}

// The local CLI exit code is the manifest's exitCode contract; the remote
// command's exit code from timing JSON is surfaced separately so the spread
// of parsed fields cannot mask a non-zero local exit.
export function composeResult({ action, args, cwd, stdout, stderr, exitCode, signal, timedOut, leaseCleanup, parsed }) {
  return {
    action,
    args,
    cwd,
    stdout,
    stderr,
    signal,
    timedOut,
    leaseCleanup,
    ...parsed,
    exitCode,
    remoteExitCode: parsed?.exitCode ?? null,
  };
}

export function resolveWorkingDirectory(workingDirectory) {
  const requested = compact(workingDirectory);
  if (!requested) {
    return process.cwd();
  }

  return path.resolve(requested);
}

// The binary must be an absolute path before spawn: on Windows, CreateProcess
// resolves a bare program name against the child cwd before PATH, and cwd is
// a workflow parameter - a bare 'crabbox' would let a workflow author plant
// an executable in workingDirectory and have it run.
export function resolveBinary(env = process.env, platform = process.platform) {
  const isWindows = platform === 'win32';
  const rejectShim = (candidate) => {
    if (isWindows && /\.(cmd|bat)$/i.test(candidate)) {
      throw new Error(
        `Crabbox resolved to ${candidate}, but .cmd/.bat shims cannot be spawned without a shell. ` +
          'Set CRABBOX_BIN to the crabbox executable (.exe).'
      );
    }
  };

  const configured = compact(env.CRABBOX_BIN);
  if (configured) {
    const resolved = path.resolve(configured);
    if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`CRABBOX_BIN points to a missing file: ${resolved}`);
    }
    rejectShim(resolved);
    return resolved;
  }

  const pathDirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = isWindows
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase())
    : [''];
  let shim = null;

  for (const dir of pathDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `crabbox${extension}`);
      if (!fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) continue;
      if (isWindows && /\.(cmd|bat)$/i.test(candidate)) {
        shim = shim || candidate;
        continue;
      }
      if (!isWindows) {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
        } catch {
          continue;
        }
      }
      return candidate;
    }
  }

  if (shim) rejectShim(shim);
  throw new Error('Crabbox binary not found on PATH. Install from https://crabbox.sh or set CRABBOX_BIN.');
}

// Minimal allowlist: the server env holds API keys and session secrets that the
// Crabbox CLI must never see. Only PATH/HOME-style resolution variables, temp
// dirs, Windows system/config dirs, and explicit CRABBOX_* settings cross the
// boundary, and CRABBOX_TOKEN comes exclusively from the per-run credential,
// never from the server's ambient environment.
export function buildChildEnv(token, env = process.env) {
  const childEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP']) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('CRABBOX_') && key !== 'CRABBOX_TOKEN') childEnv[key] = value;
  }
  if (token) {
    childEnv.CRABBOX_TOKEN = token;
  }
  return childEnv;
}

// Decide whether an interrupted or failed run should stop its remote lease.
// Caller-supplied leases are reused, not owned by this run, so they are never
// stopped here.
export function shouldStopLease({ action, failed, keep, keepOnFailure, callerLeaseId, leaseId }) {
  if (!['RUN', 'WARMUP'].includes((action || 'RUN').toUpperCase())) {
    return { stop: false, reason: null };
  }
  if (!failed) {
    return { stop: false, reason: null };
  }
  if (callerLeaseId) {
    return { stop: false, reason: `caller-supplied lease ${callerLeaseId} left running` };
  }
  if (!leaseId) {
    return { stop: false, reason: 'no lease id found in output' };
  }
  if (truthy(keep) || truthy(keepOnFailure)) {
    return { stop: false, reason: `lease ${leaseId} kept on request` };
  }
  if (!POSITIONAL_PATTERN.test(String(leaseId))) {
    return { stop: false, reason: `lease id failed validation: ${leaseId}` };
  }
  return { stop: true, reason: null };
}

class CrabboxPlugin {
  constructor() {
    this.name = 'crabbox';
  }

  async execute(params = {}, inputData, workflowEngine) {
    const { __auth, ...loggableParams } = params;
    console.log('[CrabboxPlugin] Executing with params:', JSON.stringify(loggableParams, null, 2));

    const action = (params.action || 'RUN').toUpperCase();
    let context = null;

    try {
      const token = __auth?.token;
      if (!token) {
        throw new Error(
          'No valid Crabbox credential found. Connect Crabbox (API key) in Settings > Integrations. ' +
            'The Crabbox node never uses the server\'s ambient CLI login.'
        );
      }

      const binary = resolveBinary();
      const args = buildCrabboxArgs(params);
      const cwd = resolveWorkingDirectory(params.workingDirectory);
      if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`workingDirectory does not exist: ${cwd}`);
      }
      const env = buildChildEnv(token);
      context = { binary, cwd, env };
      const timeoutMs = clampNumber(params.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const maxOutputBytes = clampNumber(params.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 1024, MAX_OUTPUT_BYTES_CAP);
      const { stdout, stderr, exitCode, signal, timedOut } = await this.runProcess(binary, args, {
        cwd,
        env,
        timeoutMs,
        maxOutputBytes,
      });
      const parsed = parseCrabboxOutput(stdout, stderr);
      const failed = timedOut || Boolean(signal) || exitCode !== 0;
      const leaseCleanup = await this.cleanupLease({ params, parsed, context, failed });

      return {
        success: !failed,
        result: composeResult({ action, args, cwd, stdout, stderr, exitCode, signal, timedOut, leaseCleanup, parsed }),
        error: failed ? this.formatError(exitCode, signal, timedOut, stderr) : null,
      };
    } catch (error) {
      console.error('[CrabboxPlugin] Error:', error);
      // The child may have acquired a lease before dying; salvage its partial
      // output so the lease is stopped instead of billing until ttl.
      let leaseCleanup = null;
      if (context && (error.stdout || error.stderr)) {
        const parsed = parseCrabboxOutput(error.stdout || '', error.stderr || '');
        leaseCleanup = await this.cleanupLease({ params, parsed, context, failed: true });
      }
      return {
        success: false,
        result: leaseCleanup ? { leaseCleanup } : null,
        error: error.message,
      };
    }
  }

  // A timed-out, signal-killed, or failed local CLI may leave its remote lease
  // running (and billing) on the broker side. Stop leases this run created
  // unless the user asked to keep them; `crabbox stop` on an already-released
  // lease is harmless.
  async cleanupLease({ params, parsed, context, failed }) {
    const decision = shouldStopLease({
      action: params.action,
      failed,
      keep: params.keep,
      keepOnFailure: params.keepOnFailure,
      callerLeaseId: compact(params.leaseId || params.id),
      leaseId: parsed.leaseId,
    });

    if (!decision.stop) {
      return decision.reason ? { attempted: false, reason: decision.reason } : null;
    }

    console.warn(`[CrabboxPlugin] Run failed or was interrupted; stopping remote lease ${parsed.leaseId}`);
    try {
      const stop = await this.runProcess(context.binary, ['stop', parsed.leaseId], {
        cwd: context.cwd,
        env: context.env,
        timeoutMs: LEASE_STOP_TIMEOUT_MS,
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
      });
      const stopped = stop.exitCode === 0 && !stop.timedOut;
      const cleanup = { attempted: true, leaseId: parsed.leaseId, stopped };
      if (!stopped) {
        cleanup.detail = `${stop.stderr || stop.stdout || ''}`.trim().split(/\r?\n/).slice(-3).join('\n');
      }
      return cleanup;
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
      let flushTimer = null;

      const child = spawn(binary, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
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
        clearTimeout(flushTimer);
        const wrapped =
          error.code === 'ENOENT'
            ? new Error(`Failed to spawn ${binary}: not found. Check CRABBOX_BIN or install from https://crabbox.sh.`)
            : error;
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        wrapped.timedOut = timedOut;
        reject(wrapped);
      });

      // 'close' waits for the stdio pipes to drain, and grandchildren that
      // inherited those pipes can hold them open forever after a kill; force
      // the streams shut shortly after the process itself exits.
      child.on('exit', () => {
        flushTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
        }, STREAM_FLUSH_GRACE_MS);
        flushTimer.unref?.();
      });

      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        clearTimeout(flushTimer);
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
