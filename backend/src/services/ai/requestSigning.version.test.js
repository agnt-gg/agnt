/**
 * The signature carries a client version, and that version must be sourced,
 * never a literal of this module's own: a stale constant ages out of date.
 *
 * These tests pin the invariant that prevents a rerun: the signature reports
 * whatever clientVersions.js resolves.
 *
 * They also guard the suffix ALGORITHM, which the wire oracle deliberately
 * masks (see tests/provider-oracle/capture.js) so that an upstream release
 * cannot turn it red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolved } = vi.hoisted(() => ({ resolved: { version: '2.1.257' } }));

vi.mock('./clientVersions.js', () => ({
  getCachedClientVersion: vi.fn((key) => {
    if (key !== 'claude-code') throw new Error(`unexpected key: ${key}`);
    return resolved.version;
  }),
}));

const { getCachedClientVersion } = await import('./clientVersions.js');
const { buildSigningBlock, buildSigningText, computeSignatureSuffix } =
  await import('./requestSigning.js');

/** Pull the version and suffix back out of a rendered signature. */
function parseSignature(text) {
  const match = /cc_version=(\d+(?:\.\d+)*)\.([0-9a-f]{3});/.exec(text);
  if (!match) throw new Error(`signature did not match the expected shape: ${text}`);
  return { version: match[1], suffix: match[2] };
}

beforeEach(() => {
  resolved.version = '2.1.257';
  getCachedClientVersion.mockClear();
});

describe('signature version is sourced, not hardcoded', () => {
  it('embeds the version clientVersions resolves', () => {
    const { text } = buildSigningBlock('hello world, this is a long message');
    expect(parseSignature(text).version).toBe('2.1.257');
    expect(getCachedClientVersion).toHaveBeenCalledWith('claude-code');
  });

  it('follows an upstream bump with no code change — the actual regression', () => {
    const before = parseSignature(buildSigningBlock('same message every time').text);

    // A new release ships; the npm-backed resolver picks it up.
    resolved.version = '2.1.999';
    const after = parseSignature(buildSigningBlock('same message every time').text);

    expect(before.version).toBe('2.1.257');
    expect(after.version).toBe('2.1.999');
    // The suffix is a hash OVER the version, so it must move with it.
    expect(after.suffix).not.toBe(before.suffix);
  });

  it('never emits a stale literal', () => {
    resolved.version = '2.1.999';
    expect(buildSigningBlock('a message long enough to index').text).not.toContain('2.1.92');
  });

  it('keeps the rest of the signature shape intact', () => {
    const { type, text } = buildSigningBlock('a message long enough to index');
    expect(type).toBe('text');
    expect(text).toMatch(
      /^x-anthropic-billing-header: cc_version=\d+(\.\d+)*\.[0-9a-f]{3}; cc_entrypoint=cli; cch=00000;$/
    );
  });
});

describe('the version and its suffix are pinned to each other', () => {
  it('pairs the suffix with the version in the same signature when the cache refreshes mid-build', () => {
    // Simulate a background refresh landing between two reads: if the signature
    // resolved the version twice, it would hash over 2.1.257 and print 2.1.999.
    let call = 0;
    getCachedClientVersion.mockImplementation(() => (call++ === 0 ? '2.1.257' : '2.1.999'));

    const { text } = buildSigningBlock('a message long enough to index');
    const { version, suffix } = parseSignature(text);

    expect(suffix).toBe(computeSignatureSuffix('a message long enough to index', version));
    expect(getCachedClientVersion).toHaveBeenCalledTimes(1);
  });

  it('lets a caller pin both explicitly', () => {
    const suffix = computeSignatureSuffix('a message long enough to index', '3.0.0');
    expect(buildSigningText(suffix, '3.0.0')).toContain(`cc_version=3.0.0.${suffix}`);
  });
});

describe('suffix algorithm — masked in the wire oracle, guarded here', () => {
  const base = 'abcdefghijklmnopqrstuvwxyz';

  it('is derived from characters 4, 7 and 20 of the first user message', () => {
    for (const index of [4, 7, 20]) {
      const mutated = base.slice(0, index) + 'Z' + base.slice(index + 1);
      expect(
        computeSignatureSuffix(mutated, '2.1.257'),
        `character ${index} must feed the suffix`
      ).not.toBe(computeSignatureSuffix(base, '2.1.257'));
    }
  });

  it('ignores characters outside those indices', () => {
    for (const index of [0, 5, 12, 25]) {
      const mutated = base.slice(0, index) + 'Z' + base.slice(index + 1);
      expect(
        computeSignatureSuffix(mutated, '2.1.257'),
        `character ${index} must NOT feed the suffix`
      ).toBe(computeSignatureSuffix(base, '2.1.257'));
    }
  });

  it('pads a short message with zeroes instead of throwing', () => {
    expect(computeSignatureSuffix('', '2.1.257')).toMatch(/^[0-9a-f]{3}$/);
    // Both are shorter than index 4, so both pad to the same three zeroes.
    expect(computeSignatureSuffix('hi', '2.1.257')).toBe(computeSignatureSuffix('0000', '2.1.257'));
  });
});
