import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { applyScan, emptyState, formatAlert, normalizeMac, parseKnownList } from './watch-state.js';

const run = promisify(execFile);
export const MAX_HOSTS = 1024;          // never sweep more than a /22
export const MAX_LOG_BYTES = 1024 * 1024;

const ipToInt = (ip) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/** The private IPv4 LAN this machine is on (skips VPN/virtual adapters with no real subnet). */
export function findLan(interfaces = os.networkInterfaces()) {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (/vethernet|virtual|vmware|vbox|tailscale|loopback|wsl/i.test(name)) continue;
    for (const a of addresses || []) {
      if (a.family !== 'IPv4' || a.internal || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      const mask = ipToInt(a.netmask);
      // `&` yields a SIGNED 32-bit int; for 128.0.0.0 and up that is negative,
      // which would put every real address outside the range check.
      const network = (ipToInt(a.address) & mask) >>> 0;
      const size = (~mask >>> 0) + 1;
      if (size < 4) continue;
      return { name, address: a.address, mac: normalizeMac(a.mac), network, size };
    }
  }
  return null;
}

/** Every host address in the LAN, capped at MAX_HOSTS around our own address. */
export function hostAddresses(lan) {
  const count = Math.min(lan.size - 2, MAX_HOSTS);
  let start = lan.network + 1;
  if (lan.size - 2 > MAX_HOSTS) start = Math.max(start, (ipToInt(lan.address) - MAX_HOSTS / 2) >>> 0);
  return Array.from({ length: count }, (_, i) => intToIp(start + i));
}

// Sending one UDP datagram to each address makes the OS ARP for it, so every
// device that is awake has to answer — including phones that ignore ping.
// One socket, no child processes; the payload goes to the discard port.
async function nudge(addresses, localAddress) {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => socket.bind(0, localAddress, resolve).once('error', reject));
  const payload = Buffer.from([0]);
  for (const ip of addresses) socket.send(payload, 9, ip, () => {});
  await new Promise((resolve) => setTimeout(resolve, 2500));
  socket.close();
}

export function parseArp(output, lan) {
  const devices = [];
  for (const match of String(output).matchAll(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+dynamic/gi)) {
    const ip = match[1];
    const n = ipToInt(ip);
    if (n < lan.network || n >= lan.network + lan.size) continue;
    devices.push({ ip, mac: normalizeMac(match[2]) });
  }
  return devices;
}

async function reverseName(ip) {
  try {
    const names = await Promise.race([dns.promises.reverse(ip), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 800))]);
    return names[0] || null;
  } catch { return null; }
}

async function scanNetwork() {
  const lan = findLan();
  if (!lan) throw new Error('Not connected to a private IPv4 network');
  await nudge(hostAddresses(lan), lan.address);
  const { stdout } = await run('arp', ['-a', '-N', lan.address], { windowsHide: true, timeout: 15_000 });
  const seen = parseArp(stdout, lan);
  seen.push({ ip: lan.address, mac: lan.mac, name: os.hostname() });
  await Promise.all(seen.map(async (d) => { if (!d.name) d.name = await reverseName(d.ip); }));
  return { lan, seen };
}

function dataDir(env) {
  const base = env.USER_DATA_PATH || path.join(env.APPDATA || os.homedir(), 'AGNT');
  return path.join(base, 'plugin-data', 'lan-watch');
}

async function readState(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw new Error(`State file is unreadable (${error.message}); delete ${file} to reset`);
  }
}

async function appendLog(file, events) {
  if (!events.length) return;
  const lines = events.map((e) => JSON.stringify({ ...e, time: new Date(e.at).toISOString() })).join('\n') + '\n';
  await fs.appendFile(file, lines);
  const { size } = await fs.stat(file);
  if (size > MAX_LOG_BYTES) {
    const text = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, text.slice(text.indexOf('\n', text.length / 2) + 1));
  }
}

const result = (fields) => ({ alert: false, message: '', onlineCount: 0, unknownOnline: [], events: [], logPath: null, error: null, ...fields });

export class LanWatch {
  constructor({ scan = scanNetwork, env = process.env, now = Date.now } = {}) {
    this.name = 'lan-watch';
    this.scan = scan;
    this.env = env;
    this.now = now;
  }

  async execute(params = {}) {
    const leftAfterMinutes = Number(params.leftAfterMinutes ?? 10);
    if (!Number.isFinite(leftAfterMinutes) || leftAfterMinutes < 1 || leftAfterMinutes > 1440) {
      return result({ error: 'leftAfterMinutes must be between 1 and 1440' });
    }
    const dir = dataDir(this.env);
    const statePath = path.join(dir, 'state.json');
    const logPath = path.join(dir, 'events.jsonl');
    try {
      await fs.mkdir(dir, { recursive: true });
      const { lan, seen } = await this.scan();
      const known = parseKnownList(params.knownDevices);
      const gateway = seen.find((d) => d.ip === intToIp(lan.network + 1));
      if (gateway) known.add(gateway.mac);   // the router
      known.add(lan.mac);                     // this computer

      const now = this.now();
      const previous = await readState(statePath);
      const { state, events, alerts, suppressedAlerts } = applyScan(previous, seen, { now, known, leftAfterMs: leftAfterMinutes * 60_000 });
      // Write state atomically: a crash mid-write must not corrupt history.
      await fs.writeFile(statePath + '.tmp', JSON.stringify(state));
      await fs.rename(statePath + '.tmp', statePath);
      await appendLog(logPath, events);

      const unknownOnline = Object.values(state.devices).filter((d) => d.online && !known.has(d.mac)).map((d) => ({ mac: d.mac, ip: d.ip, name: d.name, since: new Date(d.sessionStart).toISOString() }));
      let message = formatAlert(alerts, { timeZone: params.timeZone || undefined });
      if (message && suppressedAlerts) message += `\n(+${suppressedAlerts} more; alert limit reached, see the log)`;
      return result({ alert: alerts.length > 0, message, onlineCount: seen.length, unknownOnline, events, logPath });
    } catch (error) {
      console.error('[lan-watch] scan failed:', error);
      return result({ error: error.message, logPath });
    }
  }
}

export default new LanWatch();
