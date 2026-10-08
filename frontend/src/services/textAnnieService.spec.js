/**
 * The Text Annie linking QR code. Reported 2026-10-03: texting the code worked,
 * scanning the QR did not. It encoded a 97-byte https link that redirected into
 * Messages: a dense version-6 code drawn ~120px wide, and a browser hop that the
 * camera does not follow into Messages on iOS (Android also drops `&body=`).
 * The payload is now the native SMS form every phone camera opens directly.
 */
import { describe, it, expect } from 'vitest';
import { linkQrPayload, loadLinkCodes, saveLinkCodes, currentLinkCode } from './textAnnieService.js';
import { encode } from '@/utils/qrcode.js';

describe('linkQrPayload', () => {
  it('is the native SMSTO form: line, then the code', () => {
    expect(linkQrPayload('+16465792868', 'AGNT-K7Q2XM')).toBe('SMSTO:+16465792868:AGNT-K7Q2XM');
  });

  it('is never a web link', () => {
    expect(linkQrPayload('+16465792868', 'AGNT-K7Q2XM')).not.toMatch(/^https?:/);
  });

  it('stays a small, easily scanned code', () => {
    const { version } = encode(linkQrPayload('+447700900123', 'AGNT-K7Q2XM'));
    expect(version).toBeLessThanOrEqual(3);
  });

  it('refuses anything that is not a real line and code', () => {
    expect(linkQrPayload('', 'AGNT-K7Q2XM')).toBeNull();
    expect(linkQrPayload('6465792868', 'AGNT-K7Q2XM')).toBeNull();
    expect(linkQrPayload('+16465792868', 'hello')).toBeNull();
    expect(linkQrPayload('+16465792868:x', 'AGNT-K7Q2XM')).toBeNull();
  });
});

describe('remembered link codes', () => {
  const memory = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
  };
  const phone = (codeExpiresAt, state = 'pending') => ({ id: 'p1', state, codeExpiresAt });

  it('round-trips a live code and drops expired or malformed ones', () => {
    const storage = memory();
    saveLinkCodes({
      p1: { code: 'AGNT-K7Q2XM', expiresAt: 2_000 },
      p2: { code: 'AGNT-K7Q2XM', expiresAt: 500 },
      p3: { code: 'hello', expiresAt: 2_000 },
    }, storage, 1_000);
    expect(loadLinkCodes(storage, 1_000)).toEqual({ p1: { code: 'AGNT-K7Q2XM', expiresAt: 2_000 } });
  });

  it('survives corrupt or missing storage', () => {
    const storage = memory();
    storage.setItem('agnt.textAnnie.linkCodes', '{not json');
    expect(loadLinkCodes(storage)).toEqual({});
    expect(loadLinkCodes(undefined)).toEqual({});
    expect(() => saveLinkCodes({}, { setItem() { throw new Error('quota'); } })).not.toThrow();
  });

  it('returns a code only while it is the current, unexpired code of a pending phone', () => {
    const codes = { p1: { code: 'AGNT-K7Q2XM', expiresAt: 2_000 } };
    expect(currentLinkCode(codes, phone(2_000), 1_000)).toBe('AGNT-K7Q2XM');
    expect(currentLinkCode(codes, phone(3_000), 1_000)).toBeNull(); // replaced elsewhere
    expect(currentLinkCode(codes, phone(2_000), 2_000)).toBeNull(); // expired
    expect(currentLinkCode(codes, phone(2_000, 'active'), 1_000)).toBeNull(); // already linked
    expect(currentLinkCode({}, phone(2_000), 1_000)).toBeNull();
  });
});
