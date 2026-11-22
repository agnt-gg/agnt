// Finished or working-as-usual things are quiet; only exceptions get a coloured badge.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ACTIVITY = readFileSync(join(DIR, 'FocusedActivity.vue'), 'utf8');
const LIBRARY = readFileSync(join(DIR, 'FocusedLibrary.vue'), 'utf8');
const quietOf = () => {
  const line = LIBRARY.match(/const isQuietStatus = \(s\) => \/(.+)\/i\.test/);
  return new RegExp(line[1], 'i');
};

describe('badges only for exceptions', () => {
  it('Activity shows a finished run as a quiet check, and everything else as a tag', () => {
    expect(ACTIVITY).toMatch(/<span v-if="r\.status\.tone === 'good'" class="v2-done"><i class="fas fa-check"[^>]*><\/i>\{\{ r\.status\.label \}\}<\/span><span v-else class="tag"/);
  });

  it('the Library hides the usual states and keeps the exceptions', () => {
    const quiet = quietOf();
    for (const s of ['active', 'Active', 'enabled', 'published', 'ready', 'completed']) expect(quiet.test(s), s).toBe(true);
    for (const s of ['draft', 'paused', 'failed', 'running', 'needs_review']) expect(quiet.test(s), s).toBe(false);
    expect(LIBRARY).toContain('v-if="r.status && !isQuietStatus(r.status)"');
  });
});
