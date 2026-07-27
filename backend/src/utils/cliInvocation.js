/**
 * cliInvocation — resolve local coding CLIs into something Node can actually spawn.
 *
 * The subscription-CLI connectors (grok-build, cursor-cli) were written against
 * POSIX installs, where the CLI is a single executable file. On Windows that
 * assumption breaks in two different ways:
 *
 *   grok   — the installer ships a real `grok.exe` under ~/.grok/bin, but the
 *            POSIX candidate list looked for extensionless `grok` and never
 *            found it. Fix: add the .exe candidates.
 *
 *   cursor — the installer ships ONLY `.cmd`/`.ps1` shims (in
 *            %LOCALAPPDATA%\cursor-agent). Node's spawn() refuses .cmd/.bat
 *            without a shell (EINVAL since the CVE-2024-27980 fix), and
 *            shell:true would push arbitrary prompt text through cmd.exe
 *            quoting — a correctness and injection hazard. The shim itself
 *            just runs `versions\<latest>\node.exe versions\<latest>\index.js`,
 *            so we resolve THAT invocation and spawn the real node.exe
 *            directly: no shell, no quoting, arbitrary argv-safe.
 *
 * Everything takes an optional `overrides` bag ({ platform, env, homedir })
 * so the Windows and POSIX paths are both unit-testable from any OS.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';

function expandUserPath(p, homedir) {
  if (!p) return p;
  if (p === '~') return homedir;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir, p.slice(2));
  return p;
}

/**
 * Mirror of the cursor-agent.ps1 shim's version selection: directories named
 * `YYYY.MM.DD-commit` or `YYYY.MM.DD-HH-MM-SS-commit`, newest date wins.
 * Returns the version key as a zero-padded numeric string for comparison.
 */
function cursorVersionKey(name) {
  const m = name.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/);
  if (!m) return null;
  return m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0');
}

/**
 * If `root` contains a runnable cursor-agent payload (node.exe + index.js,
 * either at the root itself or under versions/<latest>), return the direct
 * invocation for it. Null when the layout is not present.
 */
function deriveCursorNodeInvocation(root) {
  try {
    if (!root || !fs.existsSync(root)) return null;
    // "Are we somehow in the same dir as the payload? Just run it." (shim parity)
    const rootNode = path.join(root, 'node.exe');
    const rootIndex = path.join(root, 'index.js');
    if (fs.existsSync(rootNode) && fs.existsSync(rootIndex)) {
      return { command: rootNode, args: [rootIndex] };
    }
    const versionsDir = path.join(root, 'versions');
    if (!fs.existsSync(versionsDir)) return null;
    // Newest first, but skip dirs whose payload is incomplete (a partially
    // downloaded update must not shadow a working older version).
    const ranked = fs
      .readdirSync(versionsDir)
      .map((name) => ({ name, key: cursorVersionKey(name) }))
      .filter((v) => v.key)
      .sort((a, b) => (a.key < b.key ? 1 : -1));
    for (const v of ranked) {
      const nodeBin = path.join(versionsDir, v.name, 'node.exe');
      const indexJs = path.join(versionsDir, v.name, 'index.js');
      if (fs.existsSync(nodeBin) && fs.existsSync(indexJs)) {
        return { command: nodeBin, args: [indexJs] };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve how to invoke the Cursor Agent CLI on this machine.
 *
 * Returns { command, args } where `args` is a prefix to prepend before the
 * CLI's own arguments: spawn(command, [...args, ...cliArgs]).
 * The command is always directly spawnable (a real executable or a bare name
 * for PATH lookup) — never a .cmd/.ps1 shim.
 */
export function resolveCursorInvocation(overrides = {}) {
  const platform = overrides.platform || process.platform;
  const env = overrides.env || process.env;
  const homedir = overrides.homedir || os.homedir();

  const envBin = env.AGNT_CURSOR_BIN ? expandUserPath(env.AGNT_CURSOR_BIN, homedir) : null;
  if (envBin) {
    // A shim path in the override still can't be spawned; derive the real
    // payload from its directory. If that fails we return the shim as-is and
    // let spawn fail loudly — an honest error beats a silent reroute.
    if (platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(envBin)) {
      const derived = deriveCursorNodeInvocation(path.dirname(envBin));
      if (derived) return derived;
    }
    return { command: envBin, args: [] };
  }

  if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA
        ? path.join(env.LOCALAPPDATA, 'cursor-agent')
        : path.join(homedir, 'AppData', 'Local', 'cursor-agent'),
      path.join(homedir, '.cursor', 'bin'),
    ];
    for (const root of roots) {
      const derived = deriveCursorNodeInvocation(root);
      if (derived) return derived;
    }
    return { command: 'cursor-agent', args: [] }; // PATH fallback — fails loudly if absent
  }

  const candidates = [
    path.join(homedir, '.local/bin/cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent',
    path.join(homedir, '.cursor/bin/cursor-agent'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return { command: c, args: [] };
    } catch {
      // ignore
    }
  }
  return { command: 'cursor-agent', args: [] };
}

/**
 * Candidate paths for the Grok Build CLI binary, platform-aware.
 * The GROK_BIN env override is handled by the caller (it predates this util).
 */
export function grokBinCandidates(overrides = {}) {
  const platform = overrides.platform || process.platform;
  const homedir = overrides.homedir || os.homedir();
  const names = platform === 'win32' ? ['grok.exe', 'grok'] : ['grok'];
  const dirs = [
    path.join(homedir, '.local', 'bin'),
    path.join(homedir, '.grok', 'bin'),
  ];
  const candidates = [];
  for (const dir of dirs) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  if (platform !== 'win32') {
    candidates.push('/opt/homebrew/bin/grok', '/usr/local/bin/grok');
  }
  return candidates;
}
