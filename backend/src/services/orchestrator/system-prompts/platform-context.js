import os from 'os';

/**
 * Describe the host OS + the shell that execute_shell_command actually spawns,
 * so the LLM stops emitting bash-flavored commands on Windows (and vice-versa).
 *
 * The tool uses `spawn(cmd, { shell: true })`, which Node routes to:
 *   - Windows → cmd.exe via the COMSPEC env var
 *   - POSIX   → /bin/sh
 *
 * The rules below match those targets exactly. If the tool ever switches to
 * PowerShell or a custom shell, update getShellTarget() to match.
 */

function getShellTarget() {
  if (process.platform === 'win32') {
    const comspec = process.env.COMSPEC || 'cmd.exe';
    return {
      name: comspec.toLowerCase().includes('powershell') ? 'PowerShell' : 'cmd.exe',
      path: comspec,
    };
  }
  return { name: '/bin/sh', path: '/bin/sh' };
}

function getOsLabel() {
  switch (process.platform) {
    case 'win32':
      return `Windows (${os.release()})`;
    case 'darwin':
      return `macOS (Darwin ${os.release()})`;
    case 'linux':
      return `Linux (${os.release()})`;
    default:
      return `${process.platform} (${os.release()})`;
  }
}

function getShellRules(shellName) {
  if (shellName === 'cmd.exe') {
    return [
      'Shell is **Windows cmd.exe** (Node spawns it via `shell: true`).',
      '**Do NOT embed literal newlines in a single command string.** cmd.exe `/c "..."` mangles multi-line input and silently returns empty output. Chain with `&&` (run-if-success), `&` (run-always), or `||` (run-if-fail).',
      'Redirection: `2>&1` works. `2>/dev/null` does NOT — use `2>nul`.',
      'Quoting: outer cmd.exe quotes use `"..."`. Single-quoted strings (`\'...\'`) are NOT a thing in cmd.exe — the quotes pass through literally.',
      'POSIX-only syntax that will fail: `$(...)`, here-docs (`<<EOF`), single-quoted strings, `2>/dev/null`, `;` as a command separator.',
      'Path separator: `\\` is canonical, `/` works in most contexts. Always quote paths containing spaces.',
      'For multi-line scripts (Python, Node, shell): write the script to a file with write_file first, then run the file. Do NOT pass multi-line code via `-c "..."` — cmd.exe quoting will break it.',
    ];
  }
  if (shellName === 'PowerShell') {
    return [
      'Shell is **PowerShell** (Node spawns it via `shell: true`).',
      'Chain with `;` (always) or `-and`/`-or` in conditions. `&&` and `||` ONLY work in PowerShell 7+; assume 5.1 and avoid them.',
      'Redirection: `2>&1` works but wraps native stderr as ErrorRecords in PS 5.1 — prefer not redirecting unless needed.',
      'Default file encoding for `Out-File`/`Set-Content` is UTF-16 LE with BOM. When writing files other tools will read, pass `-Encoding utf8`.',
      'Path separator: `\\` is canonical, `/` works in most contexts.',
      'For multi-line scripts: write to a `.ps1`/`.py`/`.js` file first, then run it. Here-strings (`@\'...\'@`) work inline but the closing `\'@` must be at column 0.',
    ];
  }
  // POSIX /bin/sh (macOS, Linux, BSDs, etc.)
  return [
    `Shell is **${shellName}** (Node spawns it via \`shell: true\`).`,
    'Chain with `&&`, `||`, or `;`. Embedded newlines in the command string are fine — sh treats them as statement separators.',
    'Standard POSIX syntax works: `$(...)`, here-docs (`<<EOF`), single-quoted strings, `2>/dev/null`.',
    'Path separator: `/`. Quote paths containing spaces.',
    'For multi-line scripts longer than ~5 lines: prefer write_file + run-the-file over `-c "..."` to keep quoting sane.',
  ];
}

/**
 * Build the EXECUTION ENVIRONMENT block. Returns a string suitable for
 * dropping directly into a system prompt. Pure function of process state at
 * call time — no caching, since the prompt is rebuilt per turn anyway.
 */
export function getPlatformContextSection() {
  const shell = getShellTarget();
  const osLabel = getOsLabel();
  const rules = getShellRules(shell.name);

  return `EXECUTION ENVIRONMENT:
- Operating system: ${osLabel}
- CPU architecture: ${process.arch}
- Node.js: ${process.version}
- Default shell for execute_shell_command: ${shell.name} (${shell.path})

When using execute_shell_command, the command runs in the shell above. Follow these rules:
${rules.map((r) => `- ${r}`).join('\n')}

Cross-platform rules (all OSes):
- One logical command per call. Multi-step work: chain with the shell's operator (above) or write a script file first.
- The shell's default text encoding is the OS native codepage. Python output is forced to UTF-8 (PYTHONIOENCODING=utf-8 is set in the env). Other native programs may emit OS-codepage text — if output looks empty or mojibake'd, run the program with explicit UTF-8 output flags.
- Long-running commands need \`_executeAsync: true\` so the user retains a Stop button.
- If a command returns empty stdout but \`success: true\`, the command likely failed to parse in the shell — re-check quoting, newlines, and shell-specific syntax against the rules above before retrying.`;
}

export default getPlatformContextSection;
