import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildContextManifest } from './contextManifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Provider-attribution fields on the manifest.
 *
 * cacheBestEffort  lets the panel say "opportunistic" for a provider whose
 *                  cache is documented as unreliable (Groq) instead of showing
 *                  what looks like a broken cache.
 * servedProvider   invariant I3 — which provider actually answered. Measured
 *                  2026-08-09: a request for anthropic that Codex served still
 *                  displayed Anthropic's 1h TTL and 0.1x cached rate, on three
 *                  separate providers.
 */
describe('contextManifest — provider attribution', () => {
  it('cacheBestEffort defaults false and coerces to a strict boolean', () => {
    expect(buildContextManifest({}).manifest.cacheBestEffort).toBe(false);
    expect(buildContextManifest({ cacheBestEffort: true }).manifest.cacheBestEffort).toBe(true);
    expect(buildContextManifest({ cacheBestEffort: 1 }).manifest.cacheBestEffort).toBe(true);
    expect(buildContextManifest({ cacheBestEffort: null }).manifest.cacheBestEffort).toBe(false);
  });

  it('servedProvider is null before anything has run', () => {
    const { manifest } = buildContextManifest({});
    expect(manifest.servedProvider).toBeNull();
    expect(manifest.servedModel).toBeNull();
  });

  it('carries the served provider once a failover has resolved one', () => {
    const { manifest } = buildContextManifest({ servedProvider: 'openai-codex', servedModel: 'gpt-5.4-mini' });
    expect(manifest.servedProvider).toBe('openai-codex');
    expect(manifest.servedModel).toBe('gpt-5.4-mini');
  });
});

describe('the I3 correction is wired, not merely defined', () => {
  // A helper nobody calls is indistinguishable from the bug it was written to
  // fix, so pin the call site as well as the function.
  const SRC = fs.readFileSync(path.join(__dirname, '../OrchestratorService.js'), 'utf8');

  it('defines the corrector', () => {
    expect(SRC).toMatch(/const __emitManifestForServedProvider = \(servedProvider, servedModel\) =>/);
  });

  it('calls it from the failover handler', () => {
    expect(SRC).toMatch(/__emitManifestForServedProvider\(to\.provider, to\.model\)/);
  });

  it('recomputes economics and TTL from the SERVED provider, not the requested one', () => {
    const start = SRC.indexOf('const __emitManifestForServedProvider');
    const body = SRC.slice(start, start + 1400);
    expect(body).toMatch(/cacheTtlMs: promptCacheTtlMs\(servedProvider, servedModel\)/);
    expect(body).toMatch(/cacheBestEffort: promptCacheBestEffort\(servedProvider\)/);
    expect(body).toMatch(/provider: servedProvider/);
    // …and must NOT quietly reuse the requested provider inside the corrector.
    expect(body).not.toMatch(/normalizedProvider/);
  });

  it('captures the manifest at build time so there is something to correct', () => {
    expect(SRC).toMatch(/__lastManifest = manifest;/);
    expect(SRC).toMatch(/__manifestTokens = \{/);
  });
});
