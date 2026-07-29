/**
 * CONTRACT: a virtual network adapter never outranks a physical one when we
 * are choosing an address to put in a pairing QR.
 *
 * WHY THIS EXISTS
 * ---------------
 * lanAddresses() ranked candidates by IP RANGE alone, demoting 172.16-31.x
 * because WSL, Docker and Hyper-V live there. That is true but incomplete:
 *
 *   VirtualBox host-only  ->  192.168.56.x   scored 0, the BEST rank
 *   VMware host-only      ->  192.168.x      scored 0, the BEST rank
 *
 * Both are reachable from exactly one machine, so on any box with VirtualBox
 * installed the QR offered a virtual adapter ahead of real Wi-Fi -- and the
 * failure is silent: a valid code on an address the phone cannot route to.
 *
 * The interface NAME is the reliable signal, so it dominates the range.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInterfaces = vi.fn();
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, networkInterfaces: () => mockInterfaces() } };
});

const { lanAddresses } = await import('./RemoteAccessConfig.js');

/** Build an os.networkInterfaces()-shaped object. */
function nics(entries) {
  const out = {};
  for (const [iface, address, internal = false] of entries) {
    (out[iface] ||= []).push({ address, family: 'IPv4', internal });
  }
  return out;
}

const order = () => lanAddresses().map((a) => `${a.iface}:${a.address}`);

describe('lanAddresses — adapter ranking', () => {
  beforeEach(() => mockInterfaces.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('ranks real Wi-Fi above a VirtualBox host-only adapter on the SAME best range', () => {
    // The case pure range-scoring gets wrong: both are 192.168.x.
    mockInterfaces.mockReturnValue(
      nics([
        ['VirtualBox Host-Only Network', '192.168.56.1'],
        ['Wi-Fi', '192.168.40.208'],
      ])
    );
    expect(order()[0]).toBe('Wi-Fi:192.168.40.208');
  });

  it('ranks real Wi-Fi above a VMware adapter on the same range', () => {
    mockInterfaces.mockReturnValue(
      nics([
        ['VMware Network Adapter VMnet8', '192.168.10.1'],
        ['Wi-Fi', '192.168.40.208'],
      ])
    );
    expect(order()[0]).toBe('Wi-Fi:192.168.40.208');
  });

  it('puts every virtual adapter below every physical one', () => {
    mockInterfaces.mockReturnValue(
      nics([
        ['vEthernet (WSL)', '172.19.48.1'],
        ['docker0', '172.17.0.1'],
        ['VirtualBox Host-Only Network', '192.168.56.1'],
        ['Wi-Fi', '192.168.40.208'],
        ['Tailscale', '100.119.81.89'],
      ])
    );
    const ranked = order();
    const firstVirtual = ranked.findIndex((r) =>
      /^(vEthernet|docker|VirtualBox)/i.test(r)
    );
    const lastPhysical = ranked.reduce(
      (acc, r, i) => (/^(Wi-Fi|Tailscale)/.test(r) ? i : acc),
      -1
    );
    expect(firstVirtual).toBeGreaterThan(lastPhysical);
  });

  it('keeps the real-world ordering: Wi-Fi, then Tailscale, then WSL', () => {
    mockInterfaces.mockReturnValue(
      nics([
        ['Tailscale', '100.119.81.89'],
        ['Wi-Fi', '192.168.40.208'],
        ['vEthernet (WSL)', '172.19.48.1'],
        ['Loopback Pseudo-Interface 1', '127.0.0.1', true],
      ])
    );
    expect(order()).toEqual([
      'Wi-Fi:192.168.40.208',
      'Tailscale:100.119.81.89',
      'vEthernet (WSL):172.19.48.1',
    ]);
  });

  it('still excludes internal interfaces entirely', () => {
    mockInterfaces.mockReturnValue(
      nics([
        ['Loopback Pseudo-Interface 1', '127.0.0.1', true],
        ['Wi-Fi', '192.168.40.208'],
      ])
    );
    expect(order()).toEqual(['Wi-Fi:192.168.40.208']);
  });

  it('does not drop virtual adapters -- a multi-homed user may genuinely want one', () => {
    // Demotion, not exclusion. A Docker-network address is the right answer for
    // a container on that bridge, and the human picking from the list knows
    // something the server cannot infer.
    mockInterfaces.mockReturnValue(nics([['vEthernet (WSL)', '172.19.48.1']]));
    expect(order()).toEqual(['vEthernet (WSL):172.19.48.1']);
  });

  it('a physical adapter on a poor range still beats a virtual one on a good range', () => {
    mockInterfaces.mockReturnValue(
      nics([
        ['VirtualBox Host-Only Network', '192.168.56.1'],
        ['Ethernet', '172.20.5.9'],
      ])
    );
    expect(order()[0]).toBe('Ethernet:172.20.5.9');
  });
});
