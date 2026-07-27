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

vi.mock('@/utils/qrcode.js', () => ({ toSvg: () => '<svg id="stub-qr"></svg>' }));

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
