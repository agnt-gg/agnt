// Shared low-level helpers: safe process spawning (Windows-aware), which/resolveBin,
// temp dirs, and tool availability probing. No third-party deps — Node built-ins only.
import { spawn } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';

const IS_WIN = process.platform === 'win32';

/**
 * Resolve an executable name to a concrete path.
 * On Windows, `where` finds .cmd/.exe/.bat shims that execFile('name') cannot.
 * Returns the first resolved absolute path, or the bare name if resolution fails
 * (caller can still try to spawn it; a true ENOENT is handled at spawn time).
 */
export function resolveBin(bin) {
  return new Promise((resolve) => {
    const finder = IS_WIN ? 'where' : 'which';
    execFile(finder, [bin], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // Windows `where` can return multiple lines; prefer .exe > .cmd > .bat > first.
      const lines = String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return resolve(null);
      if (IS_WIN) {
        const byExt = (ext) => lines.find((l) => l.toLowerCase().endsWith(ext));
        return resolve(byExt('.exe') || byExt('.cmd') || byExt('.bat') || lines[0]);
      }
      resolve(lines[0]);
    });
  });
}

/**
 * Spawn a command safely and collect stdout/stderr.
 * CRITICAL: shell is ALWAYS false — args are passed as an argv array so untrusted
 * target strings can never be re-parsed by a shell (no command-injection surface).
 * On Windows, a resolved .cmd/.bat shim is launched via cmd.exe /d /s /c with an
 * argv array (still shell:false), which is the only safe way to run a .cmd.
 *
 * @returns {Promise<{code:number, stdout:string, stderr:string, timedOut:boolean, spawnError?:string}>}
 */
export function run(bin, args = [], opts = {}) {
  const { cwd, timeout = 120000, maxBuffer = 64 * 1024 * 1024, env } = opts;
  return new Promise(async (resolve) => {
    let cmd = bin;
    let finalArgs = args;

    if (IS_WIN) {
      const resolved = await resolveBin(bin);
      const isShim = resolved && /\.(cmd|bat)$/i.test(resolved);
      if (isShim) {
        // cmd.exe /d /s /c <bin> <args...> — argv array, shell:false. We pass the BARE
        // command name (not the resolved .cmd path) and let cmd.exe resolve it via
        // PATHEXT. Passing the fully-resolved .cmd path here breaks stdout inheritance
        // for tools like npm whose shim spawns a nested node process (observed: npm
        // audit returns empty stdout when given the absolute .cmd path, full JSON when
        // given the bare name). Args remain separate argv entries; cmd.exe does not
        // re-tokenize them, so there is still no injection surface.
        cmd = process.env.ComSpec || 'cmd.exe';
        finalArgs = ['/d', '/s', '/c', bin, ...args];
      } else if (resolved) {
        cmd = resolved;
      }
    } else {
      const resolved = await resolveBin(bin);
      if (resolved) cmd = resolved;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(cmd, finalArgs, {
        cwd,
        env: env || process.env,
        shell: false,
        windowsHide: true,
      });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: '', timedOut: false, spawnError: e.message });
    }

    const to = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, timeout);

    child.stdout?.on('data', (d) => {
      if (stdout.length < maxBuffer) stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      if (stderr.length < maxBuffer) stderr += d.toString();
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      resolve({ code: -1, stdout, stderr, timedOut: false, spawnError: e.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      resolve({ code: code ?? 0, stdout, stderr, timedOut: false });
    });
  });
}

/** True if a binary is resolvable on this machine. */
export async function hasBin(bin) {
  const r = await resolveBin(bin);
  return !!r;
}

// Candidate python interpreters to probe, in priority order. Includes common Windows
// install locations that `where python` may not surface (per-user, versioned dirs).
const PYTHON_CANDIDATES = IS_WIN
  ? ['python', 'python3', 'py',
     'C:\\Python313\\python.exe', 'C:\\Python312\\python.exe', 'C:\\Python311\\python.exe', 'C:\\Python310\\python.exe']
  : ['python3', 'python'];

/**
 * Find a python interpreter that can import `moduleName`. Returns the interpreter path
 * (usable as a spawn target) or null. Probes both PATH pythons and known Windows dirs.
 */
export async function pythonModuleAvailable(moduleName) {
  for (const py of PYTHON_CANDIDATES) {
    // Skip candidates that don't resolve at all (avoid ENOENT spam), except bare names.
    if (py.includes('\\') || py.includes('/')) {
      if (!existsSync(py)) continue;
    } else if (!(await hasBin(py))) {
      continue;
    }
    const r = await run(py, ['-c', `import ${moduleName}`], { timeout: 15000 });
    if (r.code === 0) return py;
  }
  return null;
}

/**
 * Locate a python that can run semgrep's working Windows entry point
 * (`python -m semgrep.console_scripts.pysemgrep`). The plain `semgrep`/`osemgrep`
 * shim is broken on Windows (tries to exec a missing pysemgrep binary), and
 * `python -m semgrep` is deprecated and emits no output — this module path is the
 * one that actually runs the analysis. Returns { py } or null.
 */
export async function semgrepInvoker() {
  const py = await pythonModuleAvailable('semgrep.console_scripts.pysemgrep');
  if (py) return { py, args: ['-m', 'semgrep.console_scripts.pysemgrep'] };
  return null;
}

/** Create a unique temp working directory for clones/outputs. */
export function makeTempDir(prefix = 'sentinel-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export { IS_WIN, existsSync };
