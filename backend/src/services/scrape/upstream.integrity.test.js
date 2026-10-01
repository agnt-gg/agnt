import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FILES, MANIFEST, VENDOR_DIR, normalizedText, sha256 } from '../../../../scripts/sync-scrape-upstream.mjs';

/**
 * ./upstream is scrape.agnt.gg's converter, copied byte for byte from agnt-server by
 * scripts/sync-scrape-upstream.mjs, so the desktop and hosted scrapers cannot drift.
 *
 * An edit here would quietly fork them again: fix conversion upstream, then sync.
 * `node scripts/sync-scrape-upstream.mjs --check` compares against a local agnt-server.
 */
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

describe('vendored scrape converter', () => {
  it('records every synced file, from a real upstream commit', () => {
    expect(Object.keys(manifest.files).sort()).toEqual(Object.values(FILES).sort());
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(Object.values(FILES))('%s is unmodified since the sync', (vendored) => {
    const text = normalizedText(fs.readFileSync(path.join(VENDOR_DIR, vendored)));
    expect(sha256(text), `${vendored} was edited here; change it in agnt-server and re-sync`).toBe(manifest.files[vendored].sha256);
  });

  it('holds nothing the sync does not own', () => {
    const owned = new Set([...Object.values(FILES), 'SOURCE.json'].map((rel) => path.join(VENDOR_DIR, rel)));
    expect(listFiles(VENDOR_DIR).filter((file) => !owned.has(file))).toEqual([]);
  });

  // The hosted test suites, run against the vendored copy and THIS repo's dependency versions
  // (mammoth, jsdom...). They are node:test files, so node runs them, not vitest.
  it('passes the hosted converter test suites', () => {
    const suites = Object.values(FILES).filter((rel) => rel.endsWith('.nodetest.js'));
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...suites], { cwd: VENDOR_DIR, encoding: 'utf8', timeout: 120000 });
    const count = (name) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(run.stdout)?.[1] ?? NaN);
    expect(count('fail'), run.stdout.slice(-3000) + run.stderr.slice(-2000)).toBe(0);
    expect(count('pass')).toBeGreaterThanOrEqual(20);
    expect(run.status).toBe(0);
  }, 150000);
});
