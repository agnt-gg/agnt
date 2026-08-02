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
import { clearAsyncResourceCache } from '@/composables/useAsyncResource.js';

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
  // The status resource outlives the component on purpose (see below). Without
  // this, one test's fixture seeds the next one's first frame.
  clearAsyncResourceCache();
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
      liteUrl: `${origins[0].origin}/m/pair?c=${CODE}`,
      origin: origins[0].origin,
      origins: origins.map((o) => ({
        ...o,
        url: `${o.origin}/pair?c=${CODE}`,
        liteUrl: `${o.origin}/m/pair?c=${CODE}`,
      })),
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
    // QR encodes the mobile-lite pair link (/m/pair), same as the copy Link row.
    expect(encodedUrl()).toBe(`http://100.64.1.5:3333/m/pair?c=${CODE}`);

    // Address chooser lives under .pa-urls; the copy-link row also uses .pa-url.
    await w.findAll('.pa-urls .pa-url')[1].trigger('click');
    await flushPromises();
    expect(encodedUrl()).toBe(`http://192.168.40.208:3333/m/pair?c=${CODE}`);
  });

  it('keeps the user\'s choice across a status poll', async () => {
    // The panel polls every few seconds while a code is live. Resetting the
    // selection each time would silently swap the QR under the user's phone.
    const w = await mountPanel(multiHomed);
    await w.findAll('.pa-urls .pa-url')[1].trigger('click');
    await w.vm.refresh();
    await flushPromises();
    expect(w.findAll('.pa-urls .pa-url')[1].classes()).toContain('active');
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

describe('which client the QR pairs', () => {
  // /pairing/code returns a full-app `url` and a lite `liteUrl` for every
  // origin. Encoding only one of them left no path to the other anywhere in the
  // UI: the API still returned it, nothing rendered it, and an existing user
  // scanning the same QR silently landed in a different client.
  const codeWithBoth = () => ({
    code: 'a'.repeat(32),
    url: 'http://192.168.40.208:3333/pair?c=' + 'a'.repeat(32),
    liteUrl: 'http://192.168.40.208:3333/m/pair?c=' + 'a'.repeat(32),
    expiresAt: Date.now() + 120000,
    ttlMs: 120000,
    origins: [
      {
        origin: 'http://192.168.40.208:3333',
        source: 'request',
        label: '',
        external: true,
        url: 'http://192.168.40.208:3333/pair?c=' + 'a'.repeat(32),
        liteUrl: 'http://192.168.40.208:3333/m/pair?c=' + 'a'.repeat(32),
      },
    ],
  });

  async function withCode() {
    createCode.mockResolvedValue(codeWithBoth());
    const w = await mountPanel();
    await w.find('.pa-btn').trigger('click');
    await flushPromises();
    return w;
  }

  it('offers both targets', async () => {
    const w = await withCode();
    const labels = w.findAll('.pa-target-btn').map((b) => b.text());
    expect(labels).toEqual(['Phone chat', 'Full app']);
  });

  it('encodes the lite link by default', async () => {
    const w = await withCode();
    expect(encodedUrl()).toBe('http://192.168.40.208:3333/m/pair?c=' + 'a'.repeat(32));
  });

  it('encodes the FULL-APP link once that target is chosen', async () => {
    const w = await withCode();
    await w.findAll('.pa-target-btn')[1].trigger('click');
    await flushPromises();
    const url = encodedUrl();
    expect(url).toBe('http://192.168.40.208:3333/pair?c=' + 'a'.repeat(32));
    expect(url).not.toContain('/m/pair');
  });

  it('switches back to lite', async () => {
    const w = await withCode();
    await w.findAll('.pa-target-btn')[1].trigger('click');
    await flushPromises();
    await w.findAll('.pa-target-btn')[0].trigger('click');
    await flushPromises();
    expect(encodedUrl()).toContain('/m/pair');
  });

  it('keeps the SAME code across both targets -- only the path differs', async () => {
    // One mint, two entry points. Re-minting per target would invalidate the
    // code the user is already looking at.
    const w = await withCode();
    const lite = encodedUrl();
    await w.findAll('.pa-target-btn')[1].trigger('click');
    await flushPromises();
    const full = encodedUrl();
    expect(createCode).toHaveBeenCalledTimes(1);
    expect(lite).toContain('a'.repeat(32));
    expect(full).toContain('a'.repeat(32));
  });

  it('the copy link follows the chosen target', async () => {
    const w = await withCode();
    await w.findAll('.pa-target-btn')[1].trigger('click');
    await flushPromises();
    // The copy row and the QR must never disagree; a user who cannot scan
    // reads the link instead and would otherwise get a different client.
    expect(w.find('.pa-copy-block code').text()).toBe(encodedUrl());
  });

  it('falls back to a constructed path when the backend omits the link', async () => {
    // Older backend: no url/liteUrl on the origin entry.
    createCode.mockResolvedValue({
      code: 'b'.repeat(32),
      expiresAt: Date.now() + 120000,
      ttlMs: 120000,
      origins: [
        { origin: 'http://192.168.40.208:3333', source: 'request', label: '', external: true },
      ],
    });
    const w = await mountPanel();
    await w.find('.pa-btn').trigger('click');
    await flushPromises();
    expect(encodedUrl()).toBe('http://192.168.40.208:3333/m/pair?c=' + 'b'.repeat(32));
    await w.findAll('.pa-target-btn')[1].trigger('click');
    await flushPromises();
    expect(encodedUrl()).toBe('http://192.168.40.208:3333/pair?c=' + 'b'.repeat(32));
  });
});

// ---------------------------------------------------------------------------
// NOTHING IS CLAIMED BEFORE IT IS MEASURED
// ---------------------------------------------------------------------------
// The panel used to declare its state as `ref(false)` and render immediately,
// so for one frame after every mount it asserted "AGNT is bound to 127.0.0.1",
// "Localhost only", an OFF toggle and an empty address list -- then replaced
// all four when the status request landed. Nothing was broken; the UI was
// answering a question it had not asked yet. And because Settings sections are
// a plain v-if chain that remounts them, the user paid it on every visit.
// ---------------------------------------------------------------------------
describe('the panel before it has measured anything', () => {
  /** Every negative claim this panel is capable of making. */
  const CLAIMS = ['127.0.0.1', 'Localhost only', 'No network address found', 'must be'];

  it('makes none of its claims while the status request is still in flight', async () => {
    let land;
    getStatus.mockReturnValue(new Promise((res) => { land = res; }));

    const w = mount(PhoneAccessSection);
    await w.vm.$nextTick();

    CLAIMS.forEach((claim) => expect(w.text()).not.toContain(claim));
    expect(w.attributes('aria-busy')).toBe('true');
    // A switch rendered OFF is itself a claim about a setting nobody has read.
    expect(w.find('input[type="checkbox"]').exists()).toBe(false);
    // ...and no skeleton yet either: the answer usually arrives in ~8ms, and a
    // placeholder that comes and goes inside a frame is just a flicker.
    expect(w.find('.pa-skeleton').exists()).toBe(false);

    // Once the wait is long enough for a human to notice, reserve the space.
    await new Promise((r) => setTimeout(r, 200));
    await w.vm.$nextTick();
    expect(w.find('.pa-skeleton').exists()).toBe(true);
    CLAIMS.forEach((claim) => expect(w.text()).not.toContain(claim));

    land(baseStatus());
    await flushPromises();

    expect(w.find('.pa-skeleton').exists()).toBe(false);
    expect(w.attributes('aria-busy')).toBe('false');
    expect(w.find('input[type="checkbox"]').element.checked).toBe(true);
  });

  it('never draws a skeleton at all when the answer is quick', async () => {
    // The common case now that /pairing/status no longer waits on the OS.
    const w = mount(PhoneAccessSection);
    const seen = [];
    for (let i = 0; i < 6; i++) {
      seen.push(w.find('.pa-skeleton').exists());
      await flushPromises();
    }
    expect(seen).not.toContain(true);
    expect(w.text()).toContain('192.168.40.208');
  });

  // Negative control: without this, the suite above would pass just as happily
  // against a panel that renders nothing at all, and the guarantee would
  // quietly degrade from "honest" to "empty".
  it('DOES show the loopback warnings once they are known to be true', async () => {
    const w = await mountPanel({
      lanEnabled: false,
      desiredLanEnabled: false,
      bindHost: '127.0.0.1',
      urls: [],
      addresses: [],
    });
    expect(w.text()).toContain('127.0.0.1');
    expect(w.text()).toContain('Localhost only');
    expect(w.find('input[type="checkbox"]').element.checked).toBe(false);
  });

  it('surfaces an error instead of an endless skeleton when status fails', async () => {
    getStatus.mockRejectedValue(new Error('Network Error'));
    const w = mount(PhoneAccessSection);
    await flushPromises();

    expect(w.find('.pa-note-error').text()).toContain('Network Error');
    expect(w.find('.pa-skeleton').exists()).toBe(false);
    CLAIMS.forEach((claim) => expect(w.text()).not.toContain(claim));
  });

  it('paints last-known-good on re-entry instead of a second skeleton', async () => {
    const first = await mountPanel();
    expect(first.text()).toContain('192.168.40.208');
    first.unmount();

    // Re-entering the tab remounts the component while revalidation is still
    // in flight. The answer has not changed since a moment ago; show it.
    getStatus.mockReturnValue(new Promise(() => {}));
    const second = mount(PhoneAccessSection);
    await second.vm.$nextTick();

    expect(second.find('.pa-skeleton').exists()).toBe(false);
    expect(second.text()).toContain('192.168.40.208');
  });

  it('keeps the last good status when a poll fails mid-session', async () => {
    // A failed poll must not blank a panel that was working a second ago.
    const w = await mountPanel();
    getStatus.mockRejectedValue(new Error('offline'));
    await w.vm.refresh();
    await flushPromises();

    expect(w.text()).toContain('192.168.40.208');
    expect(w.find('.pa-note-error').text()).toContain('offline');
  });

  it('does not tell a Windows or Linux user they are on a Mac', async () => {
    const w = await mountPanel({ lanEnabled: false, desiredLanEnabled: false, urls: [] });
    expect(w.text()).not.toMatch(/\bMac\b/);
  });
});
