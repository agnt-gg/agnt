import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * API_CONFIG.BASE_URL already ends in `/api`. Writing `${BASE_URL}/api/...`
 * requests `/api/api/...`, which is a 404 the build cannot see and the
 * component tests (which stub fetch) cannot see either. Only the user sees it.
 */
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(vue|js)$/.test(entry.name) && !/\.(spec|test)\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('API base path is not doubled', () => {
  it('no source builds a URL as BASE_URL + "/api/"', () => {
    const offenders = [];
    for (const file of walk(src)) {
      const text = fs.readFileSync(file, 'utf8');
      const re = /BASE_URL\}?\s*\+?\s*['"`]?\/api\//g;
      let m;
      while ((m = re.exec(text))) offenders.push(path.relative(src, file) + ':' + text.slice(0, m.index).split('\n').length);
    }
    expect(offenders, 'BASE_URL already includes /api').toEqual([]);
  });
});
