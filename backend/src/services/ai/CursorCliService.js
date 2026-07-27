/**
 * CursorCliService — local wrapper around the Cursor Agent CLI (`cursor-agent`).
 *
 * Auth: reuses the CLI's own login (`cursor-agent login`, session in ~/.cursor).
 *       We NEVER reimplement Cursor OAuth — the CLI owns the network + creds.
 *
 * Headless invocation:
 *   cursor-agent -p --output-format json --force --model <m> "<prompt>"
 *
 * IMPORTANT QUIRK (confirmed 2026-07): `cursor-agent -p` frequently DOES NOT EXIT
 * after emitting its final result line (Cursor forum: "print mode hangs
 * indefinitely and never returns"). So we parse stdout line-by-line, resolve as
 * soon as we see the terminal {"type":"result"} object, then kill the process
 * ourselves. We also enforce a hard timeout.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { resolveCursorInvocation } from '../../utils/cliInvocation.js';

const DEFAULT_MODEL = process.env.AGNT_CURSOR_DEFAULT_MODEL || 'cursor-grok-4.5-high';
const DEFAULT_TIMEOUT_MS = Number(process.env.AGNT_CURSOR_TIMEOUT_MS || 300000); // 5 min
// Grace period after we see the terminal result before force-killing the hung CLI.
const POST_RESULT_KILL_MS = 500;

function expandUserPath(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveCursorBin() {
  if (process.env.AGNT_CURSOR_BIN) return expandUserPath(process.env.AGNT_CURSOR_BIN);
  const candidates = [
    path.join(os.homedir(), '.local/bin/cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent',
    path.join(os.homedir(), '.cursor/bin/cursor-agent'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return 'cursor-agent'; // fall back to PATH
}

// Only expose the binary's own directory on PATH when it is an actual path
// (contains a separator). Never prepend '.' — that would let a stray
// cursor-agent in the CWD be executed (security).
function binDirForPath(bin) {
  if (bin && bin.includes(path.sep)) {
    const d = path.dirname(bin);
    if (d && d !== '.') return d;
  }
  return null;
}

function pathEnv(bin) {
  const d = binDirForPath(bin);
  const base = process.env.PATH || '';
  return d ? `${d}${path.delimiter}${base}` : base;
}

function getDefaultWorkdir() {
  const configured = process.env.AGNT_CURSOR_WORKDIR;
  const dir = configured ? expandUserPath(configured) : path.join(os.homedir(), 'services/agnt-cursor-work');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function getDefaultModel() {
  return DEFAULT_MODEL;
}

/**
 * Check whether the Cursor CLI is authenticated.
 * Runs `cursor-agent status` and looks for a "Logged in" marker.
 */
async function checkAuth({ timeoutMs = 25000 } = {}) {
  // Invocation, not bare bin: on Windows the CLI is a .cmd shim Node cannot
  // spawn; resolveCursorInvocation returns the underlying node.exe + index.js.
  const invocation = resolveCursorInvocation();
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const child = spawn(invocation.command, [...invocation.args, 'status'], {
      env: { ...process.env, HOME: os.homedir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(result);
    };
    const timer = setTimeout(() => done({ loggedIn: false, raw: out, error: 'status timeout' }), timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      clearTimeout(timer);
      const loggedIn = /logged in/i.test(out) && !/not logged in/i.test(out);
      const emailMatch = out.match(/Logged in as\s+([^\s]+)/i);
      done({ loggedIn, email: emailMatch ? emailMatch[1] : null, raw: out.trim() });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ loggedIn: false, raw: out, error: err.message });
    });
  });
}

/**
 * Run a headless Cursor Agent prompt.
 * Returns { success, text, model, sessionId, usage, exitCode, raw }.
 */
async function runExec({
  prompt,
  model = DEFAULT_MODEL,
  cwd,
  force = true,
  resume = false,
  sessionId = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
} = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error('cursor_exec: prompt is required');
  }
  const invocation = resolveCursorInvocation();
  const workdir = cwd ? expandUserPath(cwd) : getDefaultWorkdir();
  try { fs.mkdirSync(workdir, { recursive: true }); } catch { /* ignore */ }

  const args = ['-p', '--output-format', 'json'];
  if (force) args.push('--force');
  if (model) args.push('--model', model);
  if (resume && sessionId) args.push('--resume', sessionId);
  else if (resume) args.push('--continue');
  if (Array.isArray(extraArgs) && extraArgs.length) args.push(...extraArgs);
  args.push(String(prompt));

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let resultObj = null;
    let settled = false;

    const child = spawn(invocation.command, [...invocation.args, ...args], {
      cwd: workdir,
      env: { ...process.env, HOME: os.homedir(), PATH: pathEnv(invocation.command) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (payload, isError = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (isError) reject(payload);
      else resolve(payload);
    };

    const hardTimer = setTimeout(() => {
      // If we already captured a result but the process just won't die, return it.
      if (resultObj) {
        finish(buildResult(resultObj, stdout, model));
      } else {
        finish(new Error(`cursor_exec: timed out after ${timeoutMs}ms. stderr: ${stderr.slice(0, 400)}`), true);
      }
    }, timeoutMs);

    const tryParseResult = () => {
      // Cursor emits one JSON object per line (stream-json) OR a single json object.
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
          const obj = JSON.parse(line);
          if (obj && obj.type === 'result') {
            resultObj = obj;
            // Got the terminal object — the CLI often hangs now. Kill shortly.
            setTimeout(() => finish(buildResult(obj, stdout, model)), POST_RESULT_KILL_MS);
            return true;
          }
        } catch { /* partial line, keep buffering */ }
      }
      return false;
    };

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (!resultObj) tryParseResult();
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(hardTimer);
      if (resultObj) {
        finish(buildResult(resultObj, stdout, model));
        return;
      }
      // No structured result. Surface an error, including any usage-limit / auth text.
      const combined = (stdout + '\n' + stderr).trim();
      if (/not logged in|please.*log ?in|unautheni?ticated/i.test(combined)) {
        finish(new Error('cursor_exec: not authenticated. Run `cursor-agent login` in a terminal.'), true);
        return;
      }
      if (/usage limit|ActionRequiredError|spend limit/i.test(combined)) {
        finish({
          success: false,
          error: 'cursor_exec: model usage limit reached. Try a different model (e.g. composer-2.5 or auto).',
          raw: combined.slice(0, 800),
          exitCode: code ?? 1,
        });
        return;
      }
      finish({
        success: false,
        error: `cursor_exec: CLI exited (${code}) with no result. ${stderr.slice(0, 400) || stdout.slice(0, 400)}`,
        exitCode: code ?? 1,
      });
    });

    child.on('error', (err) => finish(new Error(`cursor_exec spawn failed: ${err.message}`), true));
  });
}

function buildResult(obj, rawStdout, model) {
  const isError = obj.is_error === true || obj.subtype === 'error';
  return {
    success: !isError,
    provider: 'cursor-cli',
    model,
    text: typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result ?? ''),
    sessionId: obj.session_id || null,
    requestId: obj.request_id || null,
    usage: obj.usage || null,
    durationMs: obj.duration_ms ?? null,
    exitCode: isError ? 1 : 0,
    ...(isError ? { error: obj.error || obj.subtype || 'cursor error' } : {}),
  };
}

export default {
  getDefaultModel,
  getDefaultWorkdir,
  resolveCursorBin,
  checkAuth,
  runExec,
};
