/**
 * clientVersions resolves the CLI versions AGNT mimics. Two properties matter
 * beyond "it fetches JSON":
 *
 *   1. The baked fallbacks are what a cold, offline first run puts on the
 *      wire. Providers reject versions they consider too old — Anthropic
 *      returns 400 claude_code_version_too_old and takes every Claude model
 *      with it — so a fallback left to rot is a scheduled outage, not a
 *      cosmetic nit.
 *   2. getCachedClientVersion is read from a synchronous request-build path
 *      (claudeBillingHeader.js). It must answer immediately, whatever the
 *      network is doing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// vi.hoisted runs before the import statements above, so this cannot reach for
// `os` or `path` — build the directory from the environment instead.
const { cacheDir } = vi.hoisted(() => ({
  cacheDir: `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/agnt-clientversions-${process.pid}`,
}));

// Keep the cache file out of the developer's real AGNT data directory.
vi.mock('../../utils/PathManager.js', () => ({
  default: { getPath: (file) => `${cacheDir}/${file}` },
}));

const { getCachedClientVersion, inspectClientVersions, refreshClientVersions, warmupClientVersions } =
  await import('./clientVersions.js');

/** Compare dotted numeric versions: -1 / 0 / 1. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

beforeEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('baked fallbacks are current enough to be accepted', () => {
  // Anthropic began enforcing this floor on 2026-09-01. Raise it (and the
  // fallback) when they raise theirs; never lower it.
  const CLAUDE_CODE_VERSION_FLOOR = '2.1.251';

  it('ships a claude-code fallback that clears the enforced floor', () => {
    const { fallback } = inspectClientVersions()['claude-code'];
    expect(
      compareVersions(fallback, CLAUDE_CODE_VERSION_FLOOR),
      `claude-code fallback ${fallback} is below the ${CLAUDE_CODE_VERSION_FLOOR} floor Anthropic enforces — ` +
        'a cold offline start would fail every Claude request with claude_code_version_too_old'
    ).toBeGreaterThanOrEqual(0);
  });

  it('formats the claude-code identity as the real CLI does', () => {
    const { fallback } = inspectClientVersions()['claude-code'];
    expect(inspectClientVersions()['claude-code'].registry).toContain('@anthropic-ai/claude-code');
    expect(fallback).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('gives every configured client a plausible fallback', () => {
    for (const [key, entry] of Object.entries(inspectClientVersions())) {
      expect(entry.fallback, `${key} must declare a fallback`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('getCachedClientVersion — synchronous, never blocking', () => {
  it('answers from the fallback on a cold cache without awaiting the network', () => {
    // A registry that never settles: a blocking implementation would hang the
    // request-build path behind it.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));

    expect(getCachedClientVersion('claude-code')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fetchSpy).toHaveBeenCalled(); // refresh was SCHEDULED, not awaited
  });

  it('serves the resolved version once a refresh has landed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: '9.9.9' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await refreshClientVersions(['claude-code']);

    expect(getCachedClientVersion('claude-code')).toBe('9.9.9');
  });

  it('prefers a stale cached version over the baked fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: '9.9.9' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    await refreshClientVersions(['claude-code']);

    // Network dies, and the cached entry ages out. The last known-good value
    // is still more accurate than a fallback baked in months ago.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    warmupClientVersions(); // expires every entry, schedules refreshes that will fail

    expect(inspectClientVersions()['claude-code'].cached.fresh).toBe(false);
    expect(getCachedClientVersion('claude-code')).toBe('9.9.9');
  });

  it('refuses an unknown key loudly rather than inventing a version', () => {
    expect(() => getCachedClientVersion('not-a-client')).toThrow(/Unknown client-version provider/);
  });
});
