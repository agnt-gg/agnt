/**
 * Prose does not go inside a SQL template literal.
 *
 * THE FAILURE THIS PREVENTS
 * ------------------------
 * Every SQL statement in this codebase is a JS template literal. SQLite
 * accepts `--` line comments, so it is tempting to explain a tricky clause
 * where it lives:
 *
 *     db.run(`UPDATE t SET x = 1
 *             -- keep this in sync with the `>` in the reader
 *             WHERE id = ?`)
 *
 * That backtick in the prose ENDS THE TEMPLATE LITERAL. What reaches the
 * driver is a truncated statement, and the failure is not an exception:
 * node-sqlite3 aborts the process from native code with
 *
 *     FATAL ERROR: Error::New napi_get_last_error_info
 *
 * pointing at the driver, several frames and one file away from the typo.
 * A whole test file reports as "22 skipped" because the worker died. It cost
 * two debugging cycles to find; nobody should pay that twice.
 *
 * Backticks are not the only hazard (a `${` in prose interpolates, an
 * apostrophe can unbalance a quoted literal), and no lint rule covers this,
 * so the rule is the blunt one: SQL strings contain SQL. Explanations go in a
 * JS comment above the call, where the language cannot misread them.
 *
 * As of writing, all 600+ SQL template literals in backend/src already comply,
 * so this guard costs nothing to keep green.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BACKEND_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A template literal that opens with a SQL verb. Deliberately conservative:
// this must never flag ordinary strings, so it only inspects literals that are
// unambiguously statements.
const SQL_START = /^\s*(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|REPLACE|WITH|PRAGMA)\b/i;
const TEMPLATE_LITERAL = /`([^`\\]|\\.)*`/g;
const SQL_LINE_COMMENT = /(^|\n)\s*--/;

function* jsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      yield* jsFiles(full);
    } else if (entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

/**
 * @returns {{ scanned: number, offenders: Array<{file: string, line: string}> }}
 */
function scanForCommentedSql(root) {
  let scanned = 0;
  const offenders = [];

  for (const file of jsFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(TEMPLATE_LITERAL)) {
      const body = match[0].slice(1, -1);
      if (!SQL_START.test(body)) continue;
      scanned++;
      if (SQL_LINE_COMMENT.test(body)) {
        offenders.push({
          file: path.relative(root, file),
          line: (body.split('\n').find((l) => l.trim().startsWith('--')) || '').trim(),
        });
      }
    }
  }

  return { scanned, offenders };
}

describe('SQL template literals carry no prose', () => {
  const result = scanForCommentedSql(BACKEND_SRC);

  it('scans a meaningful number of statements', () => {
    // Anti-vacuity: a broken walker returning nothing would otherwise make the
    // assertion below pass forever.
    expect(result.scanned).toBeGreaterThan(100);
  });

  it('finds no `--` comments inside any SQL statement', () => {
    expect(result.offenders).toEqual([]);
  });

  it('the detector actually catches the shape that crashed the process', () => {
    // NEGATIVE CONTROL, written out rather than described: this is the real
    // clause, with the real prose, that killed a worker.
    const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'sqlguard-'));
    try {
      fs.writeFileSync(
        path.join(tmp, 'offender.js'),
        [
          'db.run(`UPDATE content_outputs SET last_read_at = CURRENT_TIMESTAMP',
          "        -- pinned one second back so the comparison cannot tie",
          '        WHERE id = ?`, [id]);',
        ].join('\n'),
      );
      const caught = scanForCommentedSql(tmp);
      expect(caught.scanned).toBe(1);
      expect(caught.offenders).toHaveLength(1);
      expect(caught.offenders[0].line).toContain('pinned one second back');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not flag a clean multi-line statement', () => {
    const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'sqlguard-ok-'));
    try {
      fs.writeFileSync(
        path.join(tmp, 'clean.js'),
        [
          'db.run(`UPDATE content_outputs',
          "        SET last_read_at = COALESCE(content_outputs.last_read_at, datetime(content_outputs.updated_at, '-1 second'))",
          '        WHERE id = ?`, [id]);',
        ].join('\n'),
      );
      const caught = scanForCommentedSql(tmp);
      expect(caught.scanned).toBe(1);
      expect(caught.offenders).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
