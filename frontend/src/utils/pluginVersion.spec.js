import { describe, it, expect } from 'vitest';
import { parsePluginSemver, checkPluginVersionPublishable } from './pluginVersion.js';

describe('parsePluginSemver', () => {
  it('parses a plain release', () => {
    expect(parsePluginSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '' });
  });

  it('parses a prerelease', () => {
    expect(parsePluginSemver('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: 'beta.1' });
  });

  it('returns null for the non-semver values that occur in real registries', () => {
    // These are the exact values PluginInstaller records when a plugin was
    // side-loaded rather than installed from the marketplace.
    for (const value of ['local', 'latest', 'unknown', '', null, undefined, '1.2', 'v1.2.3']) {
      expect(parsePluginSemver(value), String(value)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePluginSemver('  1.0.0 ')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: '' });
  });
});

describe('checkPluginVersionPublishable', () => {
  it('allows patch, minor and major increases', () => {
    expect(checkPluginVersionPublishable('1.0.1', '1.0.0').ok).toBe(true);
    expect(checkPluginVersionPublishable('1.1.0', '1.0.9').ok).toBe(true);
    expect(checkPluginVersionPublishable('2.0.0', '1.9.9').ok).toBe(true);
  });

  it('blocks republishing the same version and says why', () => {
    const result = checkPluginVersionPublishable('1.0.0', '1.0.0');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already published/i);
    expect(result.reason).toMatch(/manifest\.json/);
  });

  it('blocks a downgrade', () => {
    const result = checkPluginVersionPublishable('1.0.0', '2.0.0');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/older than/i);
  });

  it('treats a prerelease as lower than its own release', () => {
    // 1.1.0-beta.1 < 1.1.0 per semver, so this is a downgrade.
    expect(checkPluginVersionPublishable('1.1.0-beta.1', '1.1.0').ok).toBe(false);
  });

  it('allows the release that supersedes a published prerelease', () => {
    expect(checkPluginVersionPublishable('1.1.0', '1.1.0-beta.1').ok).toBe(true);
  });

  it('allows a later prerelease identifier', () => {
    expect(checkPluginVersionPublishable('1.1.0-beta.2', '1.1.0-beta.1').ok).toBe(true);
  });

  it('blocks an earlier prerelease identifier', () => {
    expect(checkPluginVersionPublishable('1.1.0-beta.1', '1.1.0-beta.2').ok).toBe(false);
  });

  it('refuses to order non-semver versions rather than guessing', () => {
    for (const [local, published] of [
      ['local', '1.0.0'],
      ['1.0.1', 'latest'],
      ['unknown', 'unknown'],
    ]) {
      const result = checkPluginVersionPublishable(local, published);
      expect(result.ok, `${local} over ${published}`).toBe(false);
      expect(result.reason).toMatch(/semver/i);
    }
  });

  it('never permits an upload the server would reject (no false-allow)', () => {
    // The server rejects anything that is not strictly greater. Sample the
    // space and assert the client is never more permissive.
    const versions = ['1.0.0', '1.0.1', '1.1.0', '2.0.0', '1.1.0-beta.1', '1.1.0-beta.2'];
    const order = (v) => {
      const p = parsePluginSemver(v);
      return [p.major, p.minor, p.patch, p.prerelease === '' ? 1 : 0, p.prerelease];
    };
    const strictlyGreater = (a, b) => {
      const [A, B] = [order(a), order(b)];
      for (let i = 0; i < A.length; i++) {
        if (A[i] === B[i]) continue;
        return A[i] > B[i];
      }
      return false;
    };
    for (const local of versions) {
      for (const published of versions) {
        const clientAllows = checkPluginVersionPublishable(local, published).ok;
        const serverAllows = strictlyGreater(local, published);
        expect(clientAllows, `${local} over ${published}`).toBe(serverAllows);
      }
    }
  });
});
