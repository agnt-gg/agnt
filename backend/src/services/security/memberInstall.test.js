import { describe, it, expect } from 'vitest';
import { memberInstallRefusal } from './memberSafePlugins.js';

// Members of a shared instance may add plugins themselves, within the member-safe bar.
const ok = { success: true, trustTier: 'official', integrityState: 'verified', valid: true, detected: { network: { count: 3 } } };

describe('a member may add an official, verified, network-only plugin', () => {
  it('allows it (Gmail, Drive, Sheets: official, verified, network only)', () => {
    expect(memberInstallRefusal(ok)).toBe(null);
    expect(memberInstallRefusal({ ...ok, detected: {} })).toBe(null);
  });
  it('refuses anything that is not, with the reason', () => {
    expect(memberInstallRefusal({ ...ok, trustTier: 'verified' })).toMatch(/official/);
    expect(memberInstallRefusal({ ...ok, integrityState: 'tofu' })).toMatch(/verified/);
    expect(memberInstallRefusal({ ...ok, integrityState: 'mismatch' })).toMatch(/verified/);
    expect(memberInstallRefusal({ ...ok, valid: false })).toMatch(/validation/);
    expect(memberInstallRefusal({ ...ok, detected: { network: {}, 'spawn-process': {}, filesystem: {} } })).toMatch(/spawn-process, filesystem/);
    expect(memberInstallRefusal({ success: false, error: 'offline' })).toMatch(/checked/);
    expect(memberInstallRefusal(null)).toMatch(/checked/);
  });
});
