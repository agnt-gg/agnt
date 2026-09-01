/**
 * The Claude Code billing header carries the CLI version AGNT mimics, and
 * Anthropic GATES MODEL ACCESS on it:
 *
 *   400 invalid_request_error — "Claude Code 2.1.92 does not support this
 *   model; version 2.1.251 or newer is required."
 *
 * That failure took every Claude model offline and silently failed the chat
 * over to another provider. It happened because the version was a hardcoded
 * constant while the user-agent beside it was resolved live from npm.
 *
 * These tests pin the invariant that prevents a rerun: the header reports
 * whatever clientVersions.js resolves, and never a literal of its own.
 *
 * They also guard the fingerprint ALGORITHM, which the wire oracle
 * deliberately masks (see tests/provider-oracle/capture.js) so that an
 * upstream release cannot turn it red.
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
const { buildBillingHeaderBlock, buildBillingHeaderText, computeVersionSuffix } =
  await import('./claudeBillingHeader.js');

/** Pull the version and fingerprint back out of a rendered header. */
function parseHeader(text) {
  const match = /cc_version=(\d+(?:\.\d+)*)\.([0-9a-f]{3});/.exec(text);
  if (!match) throw new Error(`header did not match the cc_version shape: ${text}`);
  return { version: match[1], fingerprint: match[2] };
}

beforeEach(() => {
  resolved.version = '2.1.257';
  getCachedClientVersion.mockClear();
});

describe('billing header version is sourced, not hardcoded', () => {
  it('embeds the version clientVersions resolves', () => {
    const { text } = buildBillingHeaderBlock('hello world, this is a long message');
    expect(parseHeader(text).version).toBe('2.1.257');
    expect(getCachedClientVersion).toHaveBeenCalledWith('claude-code');
  });

  it('follows an upstream bump with no code change — the actual regression', () => {
    const before = parseHeader(buildBillingHeaderBlock('same message every time').text);

    // Anthropic ships; the npm-backed resolver picks it up.
    resolved.version = '2.1.999';
    const after = parseHeader(buildBillingHeaderBlock('same message every time').text);

    expect(before.version).toBe('2.1.257');
    expect(after.version).toBe('2.1.999');
    // The fingerprint is a hash OVER the version, so it must move with it.
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('never emits the stale literal that caused the outage', () => {
    resolved.version = '2.1.999';
    expect(buildBillingHeaderBlock('a message long enough to index').text).not.toContain('2.1.92');
  });

  it('keeps the rest of the header shape intact', () => {
    const { type, text } = buildBillingHeaderBlock('a message long enough to index');
    expect(type).toBe('text');
    expect(text).toMatch(
      /^x-anthropic-billing-header: cc_version=\d+(\.\d+)*\.[0-9a-f]{3}; cc_entrypoint=cli; cch=00000;$/
    );
  });
});

describe('the version and its fingerprint are pinned to each other', () => {
  it('pairs the suffix with the version in the same header when the cache refreshes mid-build', () => {
    // Simulate a background refresh landing between two reads: if the header
    // resolved the version twice, it would hash over 2.1.257 and print 2.1.999.
    let call = 0;
    getCachedClientVersion.mockImplementation(() => (call++ === 0 ? '2.1.257' : '2.1.999'));

    const { text } = buildBillingHeaderBlock('a message long enough to index');
    const { version, fingerprint } = parseHeader(text);

    expect(fingerprint).toBe(computeVersionSuffix('a message long enough to index', version));
    expect(getCachedClientVersion).toHaveBeenCalledTimes(1);
  });

  it('lets a caller pin both explicitly', () => {
    const suffix = computeVersionSuffix('a message long enough to index', '3.0.0');
    expect(buildBillingHeaderText(suffix, '3.0.0')).toContain(`cc_version=3.0.0.${suffix}`);
  });
});

describe('fingerprint algorithm — masked in the wire oracle, guarded here', () => {
  const base = 'abcdefghijklmnopqrstuvwxyz';

  it('is derived from characters 4, 7 and 20 of the first user message', () => {
    for (const index of [4, 7, 20]) {
      const mutated = base.slice(0, index) + 'Z' + base.slice(index + 1);
      expect(
        computeVersionSuffix(mutated, '2.1.257'),
        `character ${index} must feed the fingerprint`
      ).not.toBe(computeVersionSuffix(base, '2.1.257'));
    }
  });

  it('ignores characters outside those indices', () => {
    for (const index of [0, 5, 12, 25]) {
      const mutated = base.slice(0, index) + 'Z' + base.slice(index + 1);
      expect(
        computeVersionSuffix(mutated, '2.1.257'),
        `character ${index} must NOT feed the fingerprint`
      ).toBe(computeVersionSuffix(base, '2.1.257'));
    }
  });

  it('pads a short message with zeroes instead of throwing', () => {
    expect(computeVersionSuffix('', '2.1.257')).toMatch(/^[0-9a-f]{3}$/);
    // Both are shorter than index 4, so both pad to the same three zeroes.
    expect(computeVersionSuffix('hi', '2.1.257')).toBe(computeVersionSuffix('0000', '2.1.257'));
  });
});
