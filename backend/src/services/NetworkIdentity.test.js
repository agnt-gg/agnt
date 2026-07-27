import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseWindowsSsid,
  parseMacSsid,
  parseLinuxSsid,
  getNetworkName,
  _resetNetworkNameCache,
} from './NetworkIdentity.js';

// Verbatim output from `netsh wlan show interfaces` on the machine this was
// built against. Note BSSID on the very next line — a naive /SSID\s*:/ match
// finds it first and reports a MAC address as the network name, which would
// put "connect your phone to aa:bb:cc:dd:ee:ff" in the UI.
const WINDOWS_REAL = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Example Wireless Adapter
    GUID                   : 00000000-0000-0000-0000-000000000000
    Physical address       : 00:11:22:33:44:55
    State                  : connected
    SSID                   : Example Network 5G
    BSSID                  : aa:bb:cc:dd:ee:ff
    Network type           : Infrastructure
    Radio type             : 802.11ax
`;

describe('parseWindowsSsid', () => {
  it('extracts the SSID from real netsh output', () => {
    expect(parseWindowsSsid(WINDOWS_REAL)).toBe('Example Network 5G');
  });

  it('does NOT return the BSSID (a MAC address is not a network name)', () => {
    const out = parseWindowsSsid(WINDOWS_REAL);
    expect(out).not.toMatch(/^[0-9a-f]{2}:/i);
  });

  it('keeps internal spaces and colons in the name', () => {
    expect(parseWindowsSsid('    SSID                   : My Net: 5G\n')).toBe('My Net: 5G');
  });

  it('returns null when disconnected (no SSID line at all)', () => {
    expect(parseWindowsSsid('There is 1 interface on the system:\n\n    State : disconnected\n')).toBeNull();
  });

  it.each([null, undefined, '', '   '])('returns null for %s', (v) => {
    expect(parseWindowsSsid(v)).toBeNull();
  });
});

describe('parseMacSsid', () => {
  it('extracts the network name', () => {
    expect(parseMacSsid('Current Wi-Fi Network: Example Network 5G')).toBe('Example Network 5G');
  });
  it('returns null when not associated', () => {
    expect(parseMacSsid('You are not associated with an AirPort network.')).toBeNull();
  });
});

describe('parseLinuxSsid', () => {
  it('trims iwgetid output', () => {
    expect(parseLinuxSsid('Example Network 5G\n')).toBe('Example Network 5G');
  });
  it('returns null when empty', () => {
    expect(parseLinuxSsid('\n')).toBeNull();
  });
});

describe('getNetworkName', () => {
  beforeEach(() => _resetNetworkNameCache());

  it('never throws and returns a string or null', async () => {
    const v = await getNetworkName();
    expect(v === null || typeof v === 'string').toBe(true);
  });

  it('caches, so polling /status cannot spawn a process per request', async () => {
    const first = await getNetworkName();
    const started = Date.now();
    const second = await getNetworkName();
    // Cached: returns synchronously-fast, and identical.
    expect(Date.now() - started).toBeLessThan(50);
    expect(second).toBe(first);
  });
});
