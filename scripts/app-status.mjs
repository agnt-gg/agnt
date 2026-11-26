#!/usr/bin/env node
/** Read-only status client for a local AGNT backend; no credentials or supervision. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `AGNT backend status (read-only, Node 20+)
  npm run app:status -- [--json] [--url http://127.0.0.1:3333] [--timeout-ms 3000]

Reads /api/system/status and /api/health without credentials.
Exit 0 means running with matching healthy PID; otherwise exit 1.
This does not verify checkout ownership, frontend readiness, or restart capability.
`;

export function parseOptions(args) {
  const options = { url: 'http://127.0.0.1:3333', timeoutMs: 3000, json: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error('Duplicate option; use --help');
    seen.add(flag);
    if (flag === '--json') options.json = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--url') {
      const value = args[++i] || '';
      // Validate before URL canonicalization accepts alternate IP spellings.
      if (!/^http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/?$/.test(value)) throw new Error('Expected http://127.0.0.1[:port]');
      try {
        const url = new URL(value);
        if (url.port === '0') throw new Error();
        options.url = url.origin;
      } catch { throw new Error('Invalid loopback port'); }
    } else if (flag === '--timeout-ms') {
      const value = args[++i] || '';
      if (!/^\d+$/.test(value) || +value < 100 || +value > 30000) throw new Error('Timeout must be 100-30000 integer milliseconds');
      options.timeoutMs = +value;
    } else throw new Error('Unknown option; use --help');
  }
  return options;
}

async function requestJSON(url, route, signal) {
  let response;
  try { response = await fetch(url + route, { method: 'GET', redirect: 'manual', signal }); }
  catch { throw new Error(signal.aborted ? 'Status request timed out' : 'Backend connection unavailable'); }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`${route}: HTTP ${response.status}`);
  }
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 16384) {
        throw new Error('Oversized status response');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.message === 'Oversized status response') throw error;
    throw new Error(signal.aborted ? 'Status request timed out' : 'Status response interrupted');
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON status response'); }
}

export async function readStatus(options) {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const status = await requestJSON(options.url, '/api/system/status', signal);
  if (!status || !['running', 'draining'].includes(status.state) || !Number.isSafeInteger(status.pid) || status.pid <= 0 || !Number.isFinite(status.uptimeMs) || status.uptimeMs < 0) {
    throw new Error('Invalid system status response');
  }
  const health = await requestJSON(options.url, '/api/health', signal);
  if (health?.status !== 'OK' || health.pid !== status.pid) throw new Error('Health is unhealthy or disagrees with status PID');
  return { success: status.state === 'running', url: options.url, state: status.state, pid: status.pid, uptimeMs: status.uptimeMs, healthy: true };
}

async function main() {
  // JSON errors also work when parsing fails, without echoing arbitrary arguments.
  const json = process.argv.slice(2).includes('--json');
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) { console.log(HELP); return; }
    const result = await readStatus(options);
    console.log(json ? JSON.stringify(result) : `Backend: ${result.state}, PID ${result.pid}, uptime ${result.uptimeMs} ms\nTarget: ${result.url}\nHealth: OK`);
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    if (json) console.log(JSON.stringify({ success: false, error: error.message }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
