/**
 * The Phone Access panel's job is not to render a QR code — it is to make the
 * ONE hard prerequisite unmissable, and to tell the user whether their phone
 * actually got here.
 *
 * These tests exist because the panel previously did neither, and a phone on
 * mobile data was indistinguishable from a broken server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const getStatus = vi.fn();
const createCode = vi.fn();

vi.mock('@/services/pairingService.js', () => ({
  default: {
    getStatus: (...a) => getStatus(...a),
    createCode: (...a) => createCode(...a),
    setLanAccess: vi.fn(),
    revokeAll: vi.fn(),
    restartBackend: vi.fn(),
  },
}));

// Captured so a test can assert WHICH url got encoded ?" the whole point of
// offering a choice is that the QR follows it.
const toSvg = vi.fn(() => '<svg id="stub-qr"></svg>');
vi.mock('@/utils/qrcode.js', () => ({ toSvg: (...a) => toSvg(...a) }));

const encodedUrl = () => toSvg.mock.calls.at(-1)?.[0];

import PhoneAccessSection from './PhoneAccessSection.vue';

const baseStatus = (over = {}) => ({
  success: true,
  lanEnabled: true,
  desiredLanEnabled: true,
  bindHost: '0.0.0.0',
  bindSource: 'config',
  restartRequired: false,
  networkName: 'Example Network 5G',
  lastExternalRequest: null,
  addresses: [{ address: '192.168.40.208', iface: 'Wi-Fi' }],
  urls: ['http://192.168.40.208:3333'],
  ...over,
});

beforeEach(() => {
  vi.useRealTimers();
  toSvg.mockClear();
  getStatus.mockReset();
  createCode.mockReset();
  getStatus.mockResolvedValue(baseStatus());
  createCode.mockResolvedValue({
    code: 'a'.repeat(32),
    url: 'http://192.168.40.208:3333/pair?c=' + 'a'.repeat(32),
    expiresAt: Date.now() + 120000,
    ttlMs: 120000,
  });
});

async function mountPanel(statusOver) {
  if (statusOver) getStatus.mockResolvedValue(baseStatus(statusOver));
  const wrapper = mount(PhoneAccessSection);
  await flushPromises();
  return wrapper;
}

describe('the network requirement', () => {
  it('names the actual network instead of saying "the same Wi-Fi"', async () => {
    const w = await mountPanel();
    const req = w.find('.pa-req');
    expect(req.exists()).toBe(true);
    expect(req.text()).toContain('Example Network 5G');
  });

  it('warns that mobile data and VPNs will not work', async () => {
    // These are the two causes that produce a silent failure, so they are
    // stated up front rather than left for the user to guess.
    const w = await mountPanel();
    expect(w.find('.pa-req').text()).toMatch(/mobile data/i);
    expect(w.find('.pa-req').text()).toMatch(/VPN/i);
  });

  it('falls back to generic wording when the network cannot be named', async () => {
    const w = await mountPanel({ networkName: null });
    const text = w.find('.pa-req').text();
    expect(text).toMatch(/same Wi-Fi/i);
    expect(text).not.toContain('null');
  });
});

describe('the reachability witness', () => {
  it('is not shown before a code exists', async () => {
    const w = await mountPanel();
    expect(w.find('.pa-witness').exists()).toBe(false);
  });

  it('waits after a code is generated', async () => {
    const w = await mountPanel();
    await w.vm.onGenerate();
    await flushPromises();
    expect(w.find('.pa-witness').text()).toMatch(/waiting/i);
  });

  it('reports success when a device reached the machine AFTER the code appeared', async () => {
    const w = await mountPanel();
    await w.vm.onGenerate();
    await flushPromises();

    getStatus.mockResolvedValue(baseStatus({ lastExternalRequest: { ip: '192.168.40.42', path: '/pair', at: Date.now() + 500 } }));
    await w.vm.refresh();
    await flushPromises();

    const wit = w.find('.pa-witness');
    expect(wit.classes()).toContain('ok');
    expect(wit.text()).toContain('192.168.40.42');
  });

  it('IGNORES a hit that predates the code — a false green is worse than no signal', async () => {
    // Without this guard, any earlier connection (a previous session, the
    // user's own desktop browser) would light the panel green for a phone that
    // never connected, sending the user off to debug the wrong half.
    const stale = Date.now() - 60_000;
    const w = await mountPanel({ lastExternalRequest: { ip: '10.0.0.9', path: '/', at: stale } });
    await w.vm.onGenerate();
    await flushPromises();

    const wit = w.find('.pa-witness');
    expect(wit.classes()).not.toContain('ok');
    expect(wit.text()).toMatch(/waiting/i);
  });

  it('escalates to actionable advice after waiting, naming the network', async () => {
    const w = await mountPanel();
    await w.vm.onGenerate();
    await flushPromises();

    // Advance the component's clock past the patience threshold.
    w.vm.now = Date.now() + 20_000;
    await w.vm.$nextTick();

    const wit = w.find('.pa-witness');
    expect(wit.classes()).toContain('warn');
    expect(wit.text()).toContain('Example Network 5G');
    expect(wit.text()).toMatch(/mobile data/i);
  });
});

// ---------------------------------------------------------------------------
// WHICH ADDRESS GOES IN THE QR
// ---------------------------------------------------------------------------
// The server can enumerate candidate addresses but cannot always know which one
// the phone has a route to (multi-homed host, VPN alongside Wi-Fi, split-horizon
// DNS). The user can. So the panel must offer the choice AND honour it.
// ---------------------------------------------------------------------------
describe('choosing the pairing address', () => {
  const CODE = 'b'.repeat(32);
  const multiHomed = {
    origins: [
      { origin: 'http://100.64.1.5:3333', source: 'request', label: 'The address you are using', external: true },
      { origin: 'http://192.168.40.208:3333', source: 'interface', label: 'This machine on Wi-Fi', external: true },
    ],
    urls: ['http://100.64.1.5:3333', 'http://192.168.40.208:3333'],
  };

  const mintFor = (origins) =>
    createCode.mockResolvedValue({
      code: CODE,
      url: `${origins[0].origin}/pair?c=${CODE}`,
      origin: origins[0].origin,
      origins: origins.map((o) => ({ ...o, url: `${o.origin}/pair?c=${CODE}` })),
      expiresAt: Date.now() + 120000,
      ttlMs: 120000,
    });

  it('lists every candidate and preselects the best one', async () => {
    const w = await mountPanel(multiHomed);
    const rows = w.findAll('.pa-url');
    expect(rows).toHaveLength(2);
    expect(rows[0].classes()).toContain('active');
    expect(rows[0].text()).toContain('100.64.1.5');
  });

  it('encodes the address the user picked, not the server\'s first guess', async () => {
    mintFor(multiHomed.origins);
    const w = await mountPanel(multiHomed);
    await w.vm.onGenerate();
    await flushPromises();
    expect(encodedUrl()).toBe(`http://100.64.1.5:3333/pair?c=${CODE}`);

    await w.findAll('.pa-url')[1].trigger('click');
    await flushPromises();
    expect(encodedUrl()).toBe(`http://192.168.40.208:3333/pair?c=${CODE}`);
  });

  it('keeps the user\'s choice across a status poll', async () => {
    // The panel polls every few seconds while a code is live. Resetting the
    // selection each time would silently swap the QR under the user's phone.
    const w = await mountPanel(multiHomed);
    await w.findAll('.pa-url')[1].trigger('click');
    await w.vm.refresh();
    await flushPromises();
    expect(w.findAll('.pa-url')[1].classes()).toContain('active');
  });

  it('still works against a backend that only sends flat urls', async () => {
    // Older backend, newer frontend: treating a missing `origins` as "no
    // candidates" would blank a panel that used to work.
    const w = await mountPanel({ origins: undefined, urls: ['http://192.168.40.208:3333'] });
    expect(w.findAll('.pa-url')).toHaveLength(1);
    expect(w.find('.pa-url').text()).toContain('192.168.40.208');
  });
});

describe('the prerequisite matches the chosen address', () => {
  it('drops the same-Wi-Fi demand for an address that does not need it', async () => {
    // Repeating "must be on the same Wi-Fi" for a public hostname sends the
    // user off to fix a network that was never the problem.
    const w = await mountPanel({
      origins: [{ origin: 'https://agnt.example.com', source: 'forwarded', label: 'Via reverse proxy', external: true }],
      urls: ['https://agnt.example.com'],
    });
    const req = w.find('.pa-req').text();
    expect(req).not.toMatch(/same Wi-Fi/i);
    expect(req).toContain('agnt.example.com');
  });

  it('tells a tailnet user the thing that actually matters', async () => {
    const w = await mountPanel({
      origins: [{ origin: 'http://100.64.1.5:3333', source: 'request', label: '', external: true }],
      urls: ['http://100.64.1.5:3333'],
    });
    expect(w.find('.pa-req').text()).toMatch(/VPN or tailnet/i);
  });

  it('keeps the Wi-Fi wording for a genuine LAN address', async () => {
    const w = await mountPanel();
    expect(w.find('.pa-req').text()).toContain('Example Network 5G');
  });
});
