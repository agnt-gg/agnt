import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isCapacitorNative,
  canUseWebCamera,
  isRemoteInsecureHost,
  nativeShellSetupUrl,
  bounceToNativeShellForSetup,
} from './mobileLiteNative.js';

describe('mobileLiteNative', () => {
  afterEach(() => {
    delete window.Capacitor;
    vi.unstubAllGlobals();
  });

  it('detects Capacitor native via isNativePlatform()', () => {
    window.Capacitor = { isNativePlatform: () => true };
    expect(isCapacitorNative()).toBe(true);
    window.Capacitor = { isNativePlatform: () => false };
    expect(isCapacitorNative()).toBe(false);
  });

  it('detects Capacitor via userAgent when bridge is missing', () => {
    delete window.Capacitor;
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Capacitor' });
    expect(isCapacitorNative()).toBe(true);
  });

  it('canUseWebCamera is false on plain http LAN without secure context', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { protocol: 'http:', hostname: '192.168.1.10' },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    expect(canUseWebCamera()).toBe(false);
    expect(isRemoteInsecureHost()).toBe(true);
  });

  it('nativeShellSetupUrl uses agntchat scheme on iOS', () => {
    window.Capacitor = { getPlatform: () => 'ios' };
    expect(nativeShellSetupUrl()).toBe('agntchat://localhost/?setup=1');
  });

  it('bounceToNativeShellForSetup navigates on remote http even without Capacitor bridge', () => {
    const assign = vi.fn();
    delete window.Capacitor;
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        protocol: 'http:',
        hostname: '192.168.1.5',
        assign,
      },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0', mediaDevices: undefined });

    expect(bounceToNativeShellForSetup()).toBe(true);
    expect(assign).toHaveBeenCalledWith('agntchat://localhost/?setup=1');
  });
});
