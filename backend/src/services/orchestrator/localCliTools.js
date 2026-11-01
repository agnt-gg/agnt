/**
 * Tools that drive a program installed on this machine.
 *
 * On a hosted instance none of these programs is in the image, so offering the tools only invited a
 * failure, and two of them misreported it: cursor_exec and grok_exec said "not authenticated" when the
 * program was simply absent (bravo, 2026-10-31). There they are not offered unless the program is on
 * the tool sandbox's PATH; everywhere, a missing program is reported as not installed.
 */
import fs from 'fs';
import path from 'path';
import { hostedToolBoundaryRequired } from '../security/toolRunAuthority.js';

export const LOCAL_CLI_TOOLS = Object.freeze({
  codex_exec: { bin: 'codex', label: 'Codex CLI' },
  cursor_exec: { bin: 'cursor-agent', label: 'Cursor Agent CLI' },
  grok_exec: { bin: 'grok', label: 'Grok Build CLI' },
  computer_use: { bin: 'cua-driver', label: 'The computer-use driver' },
});

/** The PATH a hosted tool process gets (toolProcess.js / agnt-tool-run.py). */
export const HOSTED_TOOL_PATH = '/usr/local/bin:/usr/bin:/bin';

export function findExecutable(name, { envPath = process.env.PATH || '', exists = fs.existsSync, platform = process.platform, delimiter = path.delimiter } = {}) {
  if (!name) return null;
  if (path.isAbsolute(name)) return exists(name) ? name : null;
  const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of envPath.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** A spawn that failed because the program is not there. */
export function isMissingProgramError(error) {
  return /\bENOENT\b/.test(`${error?.code || ''} ${error?.message ?? error ?? ''}`);
}

export function notInstalledMessage(toolName) {
  const { bin, label } = LOCAL_CLI_TOOLS[toolName];
  return `${label} is not installed on this machine (\`${bin}\` was not found), so ${toolName} cannot run here.`;
}

// The image does not change while the server runs: look each program up once.
const hostedPresence = new Map();

/** Should this tool be left out of the tools offered here? */
export function hiddenOnThisInstance(toolName, { hosted = hostedToolBoundaryRequired(), find = findExecutable } = {}) {
  const cli = LOCAL_CLI_TOOLS[toolName];
  if (!cli || !hosted) return false;
  if (!hostedPresence.has(cli.bin)) hostedPresence.set(cli.bin, Boolean(find(cli.bin, { envPath: HOSTED_TOOL_PATH, delimiter: ':' })));
  return !hostedPresence.get(cli.bin);
}

export function _resetHostedPresenceForTests() { hostedPresence.clear(); }
