/**
 * The commit-msg reflow pre-pass.
 *
 * These are integration tests: they run the real script against real files,
 * because the whole point of the pre-pass is what it does to bytes on disk.
 * The cases that matter are the REFUSALS — `commit-msg-lint.mjs --fix` cannot
 * be called directly precisely because it strips comments, the scissors diff,
 * a non-blank line 2 and any body line starting with '#'. If these refusals
 * ever regress, the hook starts silently deleting parts of commit messages.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REFLOW = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.githooks',
  'commit-msg-reflow.mjs',
);

const LONG =
  'This body line is deliberately authored as one very long single line '
  + 'exactly like git commit -m would produce on Windows and must be reflowed.';

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'reflow-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Write a message, run the pre-pass, return the file contents afterwards. */
function run(lines, eol = '\n') {
  const file = path.join(dir, 'COMMIT_EDITMSG');
  const raw = lines.join(eol) + eol;
  writeFileSync(file, raw, 'utf8');
  execFileSync('node', [REFLOW, file], { encoding: 'utf8', stdio: 'pipe' });
  return { raw, after: readFileSync(file, 'utf8') };
}

const bodyLines = (text) =>
  text.split(/\r?\n/).slice(2).filter((l) => l.trim() && !l.startsWith('#'));

/** Write bytes verbatim, run the pre-pass, return the bytes afterwards. */
function runRaw(raw) {
  const file = path.join(dir, 'COMMIT_EDITMSG');
  writeFileSync(file, raw, 'utf8');
  execFileSync('node', [REFLOW, file], { encoding: 'utf8', stdio: 'pipe' });
  return readFileSync(file, 'utf8');
}

const trailingNewlines = (text) => (text.match(/\n*$/) ?? [''])[0].length;

describe('commit-msg reflow pre-pass', () => {
  describe('repairs what it can', () => {
    it('rewraps an over-long body at 72 columns', () => {
      const { after } = run(['fix(scope): a fine subject', '', LONG]);
      expect(bodyLines(after).every((l) => l.length <= 72)).toBe(true);
      expect(bodyLines(after).length).toBeGreaterThan(1);
    });

    it('keeps every word — reflow moves text, it does not drop it', () => {
      const { raw, after } = run(['fix(scope): a fine subject', '', LONG]);
      const words = (t) => t.split(/\s+/).filter(Boolean).join(' ');
      expect(words(after)).toBe(words(raw));
    });

    it('reflows the body even when the subject is also too long', () => {
      const subject = `fix(workflow): ${'x'.repeat(80)}`;
      const { after } = run([subject, '', LONG]);
      expect(bodyLines(after).every((l) => l.length <= 72)).toBe(true);
      // The subject is a judgement call and is never rewritten.
      expect(after.split('\n')[0]).toBe(subject);
    });

    it('is idempotent', () => {
      const file = path.join(dir, 'COMMIT_EDITMSG');
      writeFileSync(file, ['fix(scope): fine', '', LONG].join('\n') + '\n', 'utf8');
      execFileSync('node', [REFLOW, file], { stdio: 'pipe' });
      const once = readFileSync(file, 'utf8');
      execFileSync('node', [REFLOW, file], { stdio: 'pipe' });
      expect(readFileSync(file, 'utf8')).toBe(once);
    });
  });

  describe('preserves what git and the author put there', () => {
    it("keeps the '# Please enter the commit message' block", () => {
      const { after } = run([
        'fix(scope): a fine subject', '', LONG, '',
        '# Please enter the commit message for your changes.',
        '# On branch main',
      ]);
      expect(after).toContain('# Please enter the commit message');
      expect(after).toContain('# On branch main');
    });

    it('keeps the scissors line and the --verbose diff', () => {
      const { after } = run([
        'fix(scope): a fine subject', '', LONG, '',
        '# ------------------------ >8 ------------------------',
        'diff --git a/x b/x', '+added line',
      ]);
      expect(after).toContain('>8');
      expect(after).toContain('diff --git a/x b/x');
      expect(after).toContain('+added line');
    });

    it('keeps trailers and preformatted blocks byte-for-byte', () => {
      const { after } = run([
        'fix(scope): a fine subject', '', LONG, '',
        '    preformatted   spacing   kept', '',
        'Co-authored-by: Someone <a@b.co>',
      ]);
      expect(after).toContain('    preformatted   spacing   kept');
      expect(after).toContain('Co-authored-by: Someone <a@b.co>');
    });

    it('preserves CRLF line endings', () => {
      const { after } = run(['fix(scope): fine', '', LONG], '\r\n');
      expect(after).toContain('\r\n');
      expect(/[^\r]\n/.test(after)).toBe(false);
    });
  });

  describe('leaves the end of the file exactly as it found it', () => {
    // `raw.split(/\r?\n/)` yields a trailing "" for a file ending in a newline.
    // Treating that artifact as a blank line and then restoring the EOL adds a
    // blank line at EOF on every rewrite.
    it('keeps exactly one trailing newline', () => {
      const after = runRaw(`fix(scope): fine\n\n${LONG}\n`);
      expect(trailingNewlines(after)).toBe(1);
    });

    it('keeps exactly one trailing newline with a comment block', () => {
      const after = runRaw(
        `fix(scope): fine\n\n${LONG}\n\n# Please enter the commit message.\n`,
      );
      expect(trailingNewlines(after)).toBe(1);
    });

    it('keeps exactly one trailing newline with a scissors diff', () => {
      const after = runRaw(
        `fix(scope): fine\n\n${LONG}\n\n`
        + '# ------------------------ >8 ------------------------\n'
        + 'diff --git a/x b/x\n',
      );
      expect(trailingNewlines(after)).toBe(1);
    });

    it('does not add a newline to a file that had none', () => {
      const after = runRaw(`fix(scope): fine\n\n${LONG}`);
      expect(trailingNewlines(after)).toBe(0);
    });

    it('ends CRLF files with exactly one CRLF', () => {
      const after = runRaw(`fix(scope): fine\r\n\r\n${LONG}\r\n`);
      expect(after.endsWith('\r\n')).toBe(true);
      expect(after.endsWith('\r\n\r\n')).toBe(false);
    });

    it('does not grow the file end when a long line is reintroduced', () => {
      const file = path.join(dir, 'COMMIT_EDITMSG');
      writeFileSync(file, `fix(scope): fine\n\n${LONG}\n`, 'utf8');
      for (let i = 0; i < 3; i += 1) {
        execFileSync('node', [REFLOW, file], { stdio: 'pipe' });
        expect(trailingNewlines(readFileSync(file, 'utf8'))).toBe(1);
        writeFileSync(file, readFileSync(file, 'utf8') + `${LONG}\n`, 'utf8');
      }
    });
  });

  describe('refuses to act where reflowing would lose information', () => {
    it('leaves the file alone when line 2 is not blank', () => {
      // reflowBody reads the body as slice(2), so line 1 would be dropped.
      const { raw, after } = run([
        'fix(scope): a fine subject',
        'THIS-LINE-MUST-SURVIVE',
        LONG,
      ]);
      expect(after).toBe(raw);
      expect(after).toContain('THIS-LINE-MUST-SURVIVE');
    });

    it("leaves the file alone when a body line starts with '#'", () => {
      // git's default cleanup is `whitespace` for -F/-m, so such a line is
      // stored verbatim in the commit and must not be silently deleted.
      const { raw, after } = run([
        'fix(scope): a fine subject', '',
        '#123 is the upstream issue this closes',
        LONG,
      ]);
      expect(after).toBe(raw);
      expect(after).toContain('#123');
    });

    it('does not touch a message that already complies', () => {
      const { raw, after } = run(['fix(scope): fine', '', 'A short body line.']);
      expect(after).toBe(raw);
    });

    it('does not touch a generated subject such as a merge', () => {
      const { raw, after } = run(["Merge branch 'feature' into main", '', LONG]);
      expect(after).toBe(raw);
    });

    it('does not touch a subject-only message', () => {
      const { raw, after } = run(['fix(scope): fine']);
      expect(after).toBe(raw);
    });
  });

  describe('never blocks a commit on its own', () => {
    it('exits 0 for every shape, including ones it refuses', () => {
      const shapes = [
        ['fix(scope): fine', '', LONG],
        ['fix(scope): fine', 'no blank line 2', LONG],
        ['fix(scope): fine'],
        [''],
      ];
      for (const lines of shapes) {
        const file = path.join(dir, 'msg.txt');
        writeFileSync(file, lines.join('\n') + '\n', 'utf8');
        const status = (() => {
          try {
            execFileSync('node', [REFLOW, file], { stdio: 'pipe' });
            return 0;
          } catch (e) { return e.status; }
        })();
        expect(status).toBe(0);
      }
    });

    it('exits 0 when the file does not exist', () => {
      const status = (() => {
        try {
          execFileSync('node', [REFLOW, path.join(dir, 'nope.txt')], { stdio: 'pipe' });
          return 0;
        } catch (e) { return e.status; }
      })();
      expect(status).toBe(0);
    });
  });
});
