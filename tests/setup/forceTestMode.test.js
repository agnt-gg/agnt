/**
 * The backend suite runs in test mode no matter which shell launched it.
 *
 * Vitest sets NODE_ENV=test only when it is unset, so a shell inheriting
 * NODE_ENV=production (every shell the packaged app spawns) ran the backend
 * suite in production mode — production cookie, CORS and logging branches —
 * unlike CI. tests/setup/forceTestMode.mjs pins the mode; this fails if that
 * guard is dropped from the root vitest.config.js.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

describe('test mode', () => {
  it('NODE_ENV is test, not whatever the launching shell had', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('both vitest configs import the guard before anything else', () => {
    for (const config of ['vitest.config.js', 'frontend/vitest.config.js']) {
      const imports = fs
        .readFileSync(path.join(repo, config), 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^import\s/.test(line));
      expect(imports[0], config).toMatch(/tests\/setup\/forceTestMode\.mjs['"]/);
    }
  });
});
