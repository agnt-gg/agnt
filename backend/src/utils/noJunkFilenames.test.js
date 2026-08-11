import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

/**
 * NO ACCIDENTAL FILES IN THE REPOSITORY.
 *
 * A zero-byte file literally named `{const` was committed on 2026-08-10 and
 * survived until someone noticed it in a directory listing. It was not a typo.
 * It was the shell:
 *
 *     C:\> echo x=>{const y}
 *     C:\> dir
 *     {const
 *
 * cmd.exe reads the `>` in an unquoted `=>` as an output redirect and creates a
 * file named after the next token. Reproduced deliberately to confirm the
 * mechanism — and note that a PROPERLY double-quoted `node -e "...=>{...}"` is
 * safe, so this only bites when quoting is lost somewhere in a chained command.
 * That is exactly the case nobody inspects.
 *
 * `git add -A` then swept it into a commit, and nothing downstream cared: it
 * broke no test, no build and no lint, because a 0-byte file with a strange
 * name is invisible to every tool that reasons about CONTENT.
 *
 * So the guard has to reason about NAMES. This is cheap, runs everywhere, and
 * closes the whole class rather than the one instance — which matters more than
 * usual here, because the same shell runs every command on this project.
 */

/** Tracked paths, straight from git — never a directory walk. */
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Patterns that are never a deliberate filename in this repository.
 *
 * Deliberately narrow. A guard that fires on plausible names gets suppressed,
 * and a suppressed guard protects nothing.
 */
const FORBIDDEN = [
  {
    name: 'shell metacharacter',
    re: /[{}<>|"*?]/,
    why: 'cmd.exe / sh redirect or glob accident — e.g. an unquoted `=>{const` creates a file named `{const`',
  },
  {
    name: 'NUL device captured as a file',
    re: /(^|\/)nul$/i,
    why: 'a `> nul` redirect that landed in the repo instead of the null device',
  },
  {
    name: 'temporary probe file',
    re: /(^|\/)tmp-[^/]*$/,
    why: 'scratch file from a debugging session; delete it or move it out of the repo',
  },
  {
    name: 'editor or merge leftover',
    re: /\.(orig|rej|bak|swp|swo|tmp)$/i,
    why: 'left behind by a merge or an editor crash',
  },
  {
    name: 'captured command output',
    re: /(^|\/)(out|output|stdout|stderr|log|result)\.txt$/i,
    why: 'redirected console output, not source',
  },
  {
    name: 'leading or trailing whitespace',
    re: /(^|\/)\s|\s(\/|$)/,
    why: 'invisible in most listings and breaks on case-sensitive filesystems',
  },
];

describe('no accidental files are tracked', () => {
  const files = trackedFiles();

  it('ANTI-VACUITY: the scan actually sees the repository', () => {
    // If `git ls-files` returns nothing — wrong cwd, no git, a submodule quirk —
    // every assertion below passes while inspecting an empty list.
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('package.json');
  });

  it.each(FORBIDDEN)('no tracked file matches: $name', ({ re, why }) => {
    const offenders = files.filter((f) => re.test(f));
    expect(
      offenders,
      `${why}\n  Remove it with:  git rm --cached "<path>"\n  If it is genuinely intended, narrow the pattern rather than deleting the rule.`
    ).toEqual([]);
  });

  it('every tracked path is plain ASCII with no control characters', () => {
    // Non-ASCII names are legal but arrive here almost exclusively by accident
    // (encoding mangling, a paste gone wrong), and they break on the mix of
    // Windows/macOS/Linux this project builds on.
    // eslint-disable-next-line no-control-regex
    const odd = files.filter((f) => /[^\x20-\x7E]/.test(f));
    expect(odd, 'non-ASCII or control character in a tracked filename').toEqual([]);
  });

  it('the guard would have caught the file that prompted it', () => {
    // Proof the rule is load-bearing rather than decorative: the exact name
    // that shipped must be rejected by the exact pattern that now runs.
    const shellMeta = FORBIDDEN.find((f) => f.name === 'shell metacharacter');
    expect(shellMeta.re.test('{const')).toBe(true);
    expect(shellMeta.re.test('backend/src/services/ai/providerConfigs.js')).toBe(false);
  });
});
