/**
 * What .gitattributes is allowed to say about merging.
 *
 * `merge=union` resolves a conflict by keeping both sides. For a Markdown
 * file people append to, that is the right call and it stops a doc edit from
 * blocking a merge. For anything with syntax it produces a file that no
 * longer parses — and does so silently, at merge time, on the trunk. This
 * test is the line between those two.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = fs
  .readFileSync(path.join(REPO_ROOT, '.gitattributes'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [pattern, ...attrs] = l.split(/\s+/);
    return { pattern, attrs };
  });

describe('.gitattributes merge policy', () => {
  it('still normalises line endings for everything', () => {
    const star = rules.find((r) => r.pattern === '*');
    expect(star?.attrs).toContain('eol=lf');
  });

  it('applies merge=union only to Markdown', () => {
    const union = rules.filter((r) => r.attrs.includes('merge=union'));
    expect(union.length, 'the API doc is meant to be union-merged').toBeGreaterThan(0);
    for (const r of union) {
      expect(r.pattern, `${r.pattern}: union-merging a file with syntax produces one that does not parse`).toMatch(/\.md$/);
    }
  });

  it('never disables merging outright without a regenerate step existing', () => {
    // `-merge` means "leave ours, mark conflict" and only makes sense for a
    // generated file the landing step regenerates. There is no such step
    // yet, so there must be no such rule yet.
    const disabled = rules.filter((r) => r.attrs.includes('-merge'));
    expect(disabled).toEqual([]);
  });
});
