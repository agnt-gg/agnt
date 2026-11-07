import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stapleWithRetry } from './notarize.js';

const WORKFLOW = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'electron-build.yml'), 'utf8');

const APP = '/Users/runner/work/agnt/agnt/dist/mac/AGNT.app';
const dropped = () => Object.assign(new Error('Command failed: xcrun stapler staple'), { output: 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."' });

// The Intel Mac runner lost its connection while fetching the ticket, twice in a row, after Apple had
// accepted the app: one dropped download failed the whole release.
describe('stapleWithRetry', () => {
  it('fetches the ticket again after a dropped connection, the same way @electron/notarize does', async () => {
    const run = vi.fn().mockRejectedValueOnce(dropped()).mockRejectedValueOnce(dropped()).mockResolvedValueOnce('The staple and validate action worked!');
    const sleep = vi.fn(async () => {});
    await stapleWithRetry(APP, { run, sleep, log: () => {} });
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledWith('xcrun', ['stapler', 'staple', '-v', 'AGNT.app'], '/Users/runner/work/agnt/agnt/dist/mac');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([20_000, 40_000]);
  });

  it('gives up after its attempts and reports it; the hook then ships unstapled', async () => {
    const run = vi.fn().mockRejectedValue(dropped());
    await expect(stapleWithRetry(APP, { run, sleep: async () => {}, log: () => {} })).rejects.toThrow(/Failed to staple after 4 attempts/);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('the release check: the signature stays hard, the ticket is best-effort', () => {
    const step = WORKFLOW.slice(WORKFLOW.indexOf('- name: Verify macOS signature and notarization'));
    const body = step.slice(0, step.indexOf('\n      - name:', 10) > 0 ? step.indexOf('\n      - name:', 10) : undefined);
    expect(body).toMatch(/codesign --verify --deep --strict/);
    expect(body).toMatch(/if xcrun stapler validate "\$APP"; then/);
    expect(body).toMatch(/::warning::.*without a stapled ticket/);
    expect(body).toMatch(/spctl --assess --type execute/);
    // An absent ticket no longer fails a notarized build; a bad signature still does.
    expect(body).not.toMatch(/exit 1/);
  });

  it('does not wait when the first attempt works', async () => {
    const run = vi.fn().mockResolvedValue('ok');
    const sleep = vi.fn();
    await stapleWithRetry(APP, { run, sleep, log: () => {} });
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
