import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyScan, emptyState, formatAlert, isRandomizedMac, parseKnownList, MAX_ALERTS_PER_HOUR } from '../../backend/plugins/dev/lan-watch-plugin/watch-state.js';
import { LanWatch, findLan, hostAddresses, parseArp, MAX_HOSTS } from '../../backend/plugins/dev/lan-watch-plugin/lan-watch.js';

const MIN = 60_000;
const opts = (now, known = new Set()) => ({ now, known, leftAfterMs: 10 * MIN });
const STRANGER = { mac: '6e-2d-36-18-1d-c4', ip: '192.168.4.28' };

test('unknown device alerts on first sight, not on every later scan', () => {
  let r = applyScan(emptyState(), [STRANGER], opts(0));
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].firstTime, true);
  assert.equal(r.events[0].type, 'joined');
  r = applyScan(r.state, [STRANGER], opts(MIN));
  assert.equal(r.alerts.length, 0);
  assert.equal(r.events.length, 0);
});

test('a device leaves only after the absence window, then alerts again on return with history', () => {
  let r = applyScan(emptyState(), [STRANGER], opts(0));
  r = applyScan(r.state, [], opts(5 * MIN));
  assert.equal(r.events.length, 0, 'brief absence is not a departure');
  r = applyScan(r.state, [], opts(10 * MIN));
  assert.deepEqual(r.events.map((e) => [e.type, e.connectedMs]), [['left', 0]]);
  r = applyScan(r.state, [STRANGER], opts(60 * MIN));
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].firstTime, false);
  assert.equal(r.alerts[0].previousLastSeen, 0);
  assert.equal(r.state.devices['6e:2d:36:18:1d:c4'].visits, 2);
});

test('known devices are logged but never alert', () => {
  const r = applyScan(emptyState(), [{ mac: '50:14:79:aa:bb:cc', ip: '192.168.4.9' }], opts(0, parseKnownList('50-14-79-AA-BB-CC')));
  assert.equal(r.alerts.length, 0);
  assert.equal(r.events[0].known, true);
});

test('alerts are capped per hour and the cap window slides', () => {
  let state = emptyState();
  const burst = Array.from({ length: MAX_ALERTS_PER_HOUR + 3 }, (_, i) => ({ mac: `02:00:00:00:00:${String(i).padStart(2, '0')}`, ip: `10.0.0.${i + 2}` }));
  let r = applyScan(state, burst, opts(0));
  assert.equal(r.alerts.length, MAX_ALERTS_PER_HOUR);
  assert.equal(r.suppressedAlerts, 3);
  r = applyScan(r.state, [{ mac: '02:00:00:00:01:00', ip: '10.0.0.99' }], opts(61 * MIN));
  assert.equal(r.alerts.length, 1, 'cap resets after an hour');
});

test('state is not mutated and duplicate MACs in one scan count once', () => {
  const before = emptyState();
  const r = applyScan(before, [STRANGER, STRANGER], opts(0));
  assert.deepEqual(before, emptyState());
  assert.equal(r.events.length, 1);
});

test('known list parsing, randomized-MAC detection and alert text', () => {
  assert.deepEqual([...parseKnownList('AA-BB-CC-DD-EE-FF, nonsense\n11:22:33:44:55:66')], ['aa:bb:cc:dd:ee:ff', '11:22:33:44:55:66']);
  assert.equal(isRandomizedMac('6e:2d:36:18:1d:c4'), true);
  assert.equal(isRandomizedMac('80:af:9f:92:95:52'), false);
  const { alerts } = applyScan(emptyState(), [STRANGER], opts(Date.UTC(2026, 9, 10, 21, 0)));
  const text = formatAlert(alerts, { timeZone: 'UTC' });
  assert.match(text, /6E:2D:36:18:1D:C4 at 192\.168\.4\.28/);
  assert.match(text, /private address/);
  assert.match(text, /first time seen/);
  assert.equal(formatAlert([]), '');
});

test('LAN discovery skips virtual adapters and the sweep is bounded', () => {
  const lan = findLan({
    'vEthernet (Wi-Fi)': [{ family: 'IPv4', address: '172.30.176.1', netmask: '255.255.240.0', internal: false, mac: '00:15:5d:60:14:16' }],
    Tailscale: [{ family: 'IPv4', address: '100.119.81.89', netmask: '255.255.255.255', internal: false, mac: '00:00:00:00:00:00' }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.4.22', netmask: '255.255.252.0', internal: false, mac: '70:9c:d1:16:c4:d9' }],
  });
  assert.equal(lan.address, '192.168.4.22');
  const hosts = hostAddresses(lan);
  assert.equal(hosts.length, 1022);
  assert.equal(hosts[0], '192.168.4.1');
  assert.equal(hosts.at(-1), '192.168.7.254');
  const huge = hostAddresses({ network: 0x0a000000, size: 1 << 24, address: '10.1.2.3' });
  assert.equal(huge.length, MAX_HOSTS);
  assert.ok(huge.includes('10.1.2.3'));
});

test('regression: a 192.168.x LAN found from adapters keeps its devices (unsigned network math)', () => {
  const lan = findLan({ 'Wi-Fi': [{ family: 'IPv4', address: '192.168.4.22', netmask: '255.255.252.0', internal: false, mac: '70:9c:d1:16:c4:d9' }] });
  assert.ok(lan.network > 0, `network must be unsigned, got ${lan.network}`);
  assert.deepEqual(parseArp('  192.168.4.1   80-af-9f-92-95-52   dynamic', lan), [{ ip: '192.168.4.1', mac: '80:af:9f:92:95:52' }]);
});

test('ARP parsing keeps dynamic in-subnet entries only', () => {
  const arp = `Interface: 192.168.4.22 --- 0x18
  192.168.4.1           80-af-9f-92-95-52     dynamic
  192.168.4.28          6e-2d-36-18-1d-c4     dynamic
  192.168.7.255         ff-ff-ff-ff-ff-ff     static
  10.9.9.9              aa-aa-aa-aa-aa-aa     dynamic`;
  assert.deepEqual(parseArp(arp, { network: 0xc0a80400, size: 1024 }), [
    { ip: '192.168.4.1', mac: '80:af:9f:92:95:52' },
    { ip: '192.168.4.28', mac: '6e:2d:36:18:1d:c4' },
  ]);
});

test('end to end: state and log persist across runs; router and this PC are trusted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-watch-'));
  try {
    const lan = { network: 0xc0a80400, size: 1024, address: '192.168.4.22', mac: '70:9c:d1:16:c4:d9' };
    const router = { ip: '192.168.4.1', mac: '80:af:9f:92:95:52' };
    const me = { ip: lan.address, mac: lan.mac };
    let now = 0;
    let seen = [router, me, STRANGER];
    const watch = new LanWatch({ env: { USER_DATA_PATH: dir }, now: () => now, scan: async () => ({ lan, seen: [...seen] }) });

    let out = await watch.execute({});
    assert.equal(out.error, null);
    assert.equal(out.alert, true);
    assert.deepEqual(out.unknownOnline.map((d) => d.mac), ['6e:2d:36:18:1d:c4']);

    now = MIN;
    out = await watch.execute({});
    assert.equal(out.alert, false, 'state persisted, so no repeat alert');

    seen = [router, me];
    now = 20 * MIN;
    out = await watch.execute({});
    assert.deepEqual(out.events.map((e) => e.type), ['left']);

    const log = fs.readFileSync(out.logPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(log.map((e) => `${e.type}:${e.mac}`), ['joined:80:af:9f:92:95:52', 'joined:70:9c:d1:16:c4:d9', 'joined:6e:2d:36:18:1d:c4', 'left:6e:2d:36:18:1d:c4']);
    assert.ok(log.every((e) => e.time));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bad settings and scan failures return an error instead of throwing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-watch-'));
  try {
    assert.match((await new LanWatch({ env: { USER_DATA_PATH: dir } }).execute({ leftAfterMinutes: 0 })).error, /between 1 and 1440/);
    const failed = await new LanWatch({ env: { USER_DATA_PATH: dir }, scan: async () => { throw new Error('no wifi'); } }).execute({});
    assert.equal(failed.alert, false);
    assert.equal(failed.error, 'no wifi');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
