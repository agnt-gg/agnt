// Pure state machine for the LAN watcher: no I/O, so every rule is testable.
//
// A device is identified by MAC (IPs move around under DHCP). It is "online"
// while it keeps showing up in scans, and "left" once it has been absent for
// `leftAfterMs`. An UNKNOWN device produces an alert when it appears for the
// first time or comes back after having left — never on every scan — and
// alerts are capped per hour so a flapping device cannot drain the text
// allowance.

export const MAX_DEVICES = 500;
export const MAX_ALERTS_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;

export const normalizeMac = (mac) => String(mac || '').trim().toLowerCase().replace(/-/g, ':');

export function parseKnownList(text) {
  return new Set(String(text || '').split(/[\s,;]+/).map(normalizeMac).filter((m) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)));
}

// Locally administered bit: phones, tablets, laptops and watches use these
// "private" addresses; most smart-home gadgets do not.
export const isRandomizedMac = (mac) => /^[0-9a-f][26ae]:/.test(normalizeMac(mac));

export function emptyState() {
  return { devices: {}, alertTimes: [] };
}

/**
 * @param state   previous state (not mutated)
 * @param seen    [{ mac, ip, name? }] devices present in this scan
 * @param options { now, known:Set, leftAfterMs }
 * @returns { state, events, alerts }
 */
export function applyScan(state, seen, { now, known, leftAfterMs }) {
  const next = { devices: structuredClone(state.devices || {}), alertTimes: (state.alertTimes || []).filter((t) => now - t < HOUR_MS) };
  const events = [];
  const alerts = [];
  const seenNow = new Set();

  for (const { mac: rawMac, ip, name } of seen) {
    const mac = normalizeMac(rawMac);
    if (!mac || seenNow.has(mac)) continue;
    seenNow.add(mac);
    const prior = next.devices[mac];
    const isKnown = known.has(mac);
    if (!prior || !prior.online) {
      const device = {
        mac, ip, name: name || prior?.name || null,
        firstSeen: prior?.firstSeen ?? now,
        sessionStart: now, lastSeen: now, online: true,
        visits: (prior?.visits || 0) + 1,
      };
      next.devices[mac] = device;
      events.push({ type: 'joined', at: now, mac, ip, name: device.name, known: isKnown, firstTime: !prior });
      if (!isKnown) alerts.push({ ...device, firstTime: !prior, previousLastSeen: prior?.lastSeen ?? null });
    } else {
      next.devices[mac] = { ...prior, ip, name: name || prior.name, lastSeen: now };
    }
  }

  for (const device of Object.values(next.devices)) {
    if (device.online && !seenNow.has(device.mac) && now - device.lastSeen >= leftAfterMs) {
      device.online = false;
      events.push({ type: 'left', at: now, mac: device.mac, ip: device.ip, name: device.name, known: known.has(device.mac), connectedMs: device.lastSeen - device.sessionStart });
    }
  }

  // Bound growth: forget the longest-gone offline devices first.
  const all = Object.values(next.devices);
  if (all.length > MAX_DEVICES) {
    all.filter((d) => !d.online).sort((a, b) => a.lastSeen - b.lastSeen)
      .slice(0, all.length - MAX_DEVICES).forEach((d) => delete next.devices[d.mac]);
  }

  const allowed = Math.max(0, MAX_ALERTS_PER_HOUR - next.alertTimes.length);
  const sent = alerts.slice(0, allowed);
  sent.forEach(() => next.alertTimes.push(now));
  return { state: next, events, alerts: sent, suppressedAlerts: alerts.length - sent.length };
}

const clock = (ms, timeZone) => new Date(ms).toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatAlert(alerts, { timeZone } = {}) {
  if (!alerts.length) return '';
  const lines = alerts.map((d) => {
    const mac = d.mac.toUpperCase();
    const kind = isRandomizedMac(d.mac) ? 'private address (phone/tablet/laptop)' : 'hardware address';
    const history = d.firstTime ? 'first time seen' : `back after being away; last seen ${clock(d.previousLastSeen, timeZone)}, first seen ${clock(d.firstSeen, timeZone)}`;
    return `${mac} at ${d.ip}${d.name ? ` (${d.name})` : ''}, ${kind}, ${history}`;
  });
  return `Unknown device on your Wi-Fi at ${clock(alerts[0].sessionStart, timeZone)}:\n${lines.join('\n')}`;
}
