/**
 * The Text Annie linking QR code. Reported 2026-10-03: texting the code worked,
 * scanning the QR did not. It encoded a 97-byte https link that redirected into
 * Messages: a dense version-6 code drawn ~120px wide, and a browser hop that the
 * camera does not follow into Messages on iOS (Android also drops `&body=`).
 * The payload is now the native SMS form every phone camera opens directly.
 */
import { describe, it, expect } from 'vitest';
import { linkQrPayload } from './textAnnieService.js';
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
