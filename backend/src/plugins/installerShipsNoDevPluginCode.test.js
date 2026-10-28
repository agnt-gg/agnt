/**
 * What ships in the installer may not contain development-only plugin code.
 *
 * Reported 2026-10-27: an older Mac's install was flagged by SentinelOne.
 * Every installer carried Sentinel's _selftest/vulnapp (a deliberately
 * vulnerable app with fake keys and injection routes), twice: as source under
 * backend/plugins/dev, and inside the bundled sentinel.agnt archive.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

// backend/src/plugins -> backend/plugins (the bundled catalogue) and the repo root.
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginsDir = path.join(backendDir, 'plugins');
const repoRoot = path.resolve(backendDir, '..');
const DEV_ONLY = /(^|\/)(_selftest|test-fixtures)(\/|$)/;

/** Entry names of a .agnt (gzipped tar), read without extracting anything. */
function archiveEntries(file) {
  const tar = zlib.gunzipSync(fs.readFileSync(file));
  const names = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join('/');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

describe('the installer ships no development-only plugin code', () => {
  it('no bundled plugin archive contains a self-test or fixtures folder', () => {
    const archives = fs.readdirSync(path.join(pluginsDir, 'marketplace-default')).filter((f) => f.endsWith('.agnt'));
    expect(archives.length).toBeGreaterThan(10); // anti-vacuity: the catalogue is really being read
    const offenders = archives.flatMap((archive) =>
      archiveEntries(path.join(pluginsDir, 'marketplace-default', archive)).filter((entry) => DEV_ONLY.test(entry)).map((entry) => `${archive}: ${entry}`));
    expect(offenders).toEqual([]);
  });

  it('Sentinel comes from the online marketplace, not the bundled catalogue', () => {
    // Published to api.agnt.gg as AGNT (official, 1.0.1) on 2026-10-28; the
    // installer merges the online catalogue in (PluginInstaller.getAvailablePlugins).
    const catalogue = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'marketplace.json'), 'utf8'));
    const entries = catalogue.plugins || catalogue;
    expect(entries.some((entry) => entry.name === 'sentinel')).toBe(false);
    expect(fs.existsSync(path.join(pluginsDir, 'marketplace-default', 'sentinel.agnt'))).toBe(false);
  });

  it('the Electron build leaves plugin sources (backend/plugins/dev) out', () => {
    const files = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).build.files;
    expect(files).toContain('backend/**/*');
    expect(files).toContain('!backend/plugins/dev/**/*');
  });
});
