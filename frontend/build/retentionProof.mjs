/**
 * End-to-end proof, run manually (not part of the suite):
 *   1. build
 *   2. note the Settings chunk hash
 *   3. change Settings source, rebuild
 *   4. the OLD hash must still be on disk and listed in the retention ledger
 *   5. with AGNT_ASSET_RETENTION_DAYS=0 it must be gone
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JS = path.join(ROOT, 'dist', 'assets', 'js');
const LEDGER = path.join(ROOT, 'dist', '.asset-retention.json');
const SETTINGS = path.join(ROOT, 'src/views/Terminal/CenterPanel/screens/Settings/Settings.vue');
// Must change EMITTED output, not just source bytes: a stray HTML comment
// outside the SFC blocks is stripped by the compiler and the hash is unchanged.
const FROM = 'Configure your basic system preferences';
const TO = 'Configure your basic system preferences (retention proof)';

const settingsChunks = () =>
  fs.existsSync(JS) ? fs.readdirSync(JS).filter((f) => /^Settings\.[A-Za-z0-9_-]{8}\.js$/.test(f)) : [];

const build = (env = {}) => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
};

const original = fs.readFileSync(SETTINGS, 'utf8');
const results = [];

try {
  fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });

  build();
  const first = settingsChunks();
  results.push(['build 1 emits exactly one Settings chunk', first.length === 1, first.join()]);

  if (!original.includes(FROM)) throw new Error(`proof needs the marker string ${FROM}`);
  fs.writeFileSync(SETTINGS, original.replace(FROM, TO));
  build();
  const second = settingsChunks();
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));

  results.push(['build 2 emits a NEW hash alongside the old', second.length === 2, second.join()]);
  results.push(['THE FIX: the old hash survives the rebuild', second.includes(first[0]), first[0]]);
  results.push([
    'the old hash is recorded as retired',
    Object.keys(ledger).some((k) => k.endsWith(first[0])),
    `${Object.keys(ledger).length} entries`,
  ]);

  build({ AGNT_ASSET_RETENTION_DAYS: '0' });
  const third = settingsChunks();
  results.push(['retention 0 prunes it again (release builds)', !third.includes(first[0]), third.join()]);
} finally {
  fs.writeFileSync(SETTINGS, original);
}

let ok = true;
for (const [name, pass, detail] of results) {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}
process.exit(ok ? 0 : 1);
