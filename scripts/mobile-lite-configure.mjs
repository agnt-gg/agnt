#!/usr/bin/env node
/**
 * Write mobile/mobile-lite/capacitor.config.json
 *
 * Default mode (recommended): local `www` bootstrap — no fixed server.url.
 * The user pastes a pair *link* (host is in the URL: LAN or Tailscale). The
 * WebView then navigates to that host's /m/pair and claims same-origin.
 *
 * Optional pin (simulator / fixed host):
 *   AGNT_SERVER_URL=http://127.0.0.1:3333 make mobile-lite-ios-sync
 *   AGNT_SERVER_MODE=fixed  (default when AGNT_SERVER_URL is set)
 *   AGNT_SERVER_MODE=local  force local bootstrap even if URL is set (URL
 *                           becomes the bootstrap "suggested" origin only)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'mobile', 'mobile-lite');

const rawEnv = (process.env.AGNT_SERVER_URL || '').trim().replace(/\/$/, '');
const modeEnv = (process.env.AGNT_SERVER_MODE || '').trim().toLowerCase();

let suggestedOrigin = null;
if (rawEnv) {
  try {
    suggestedOrigin = new URL(rawEnv).origin;
  } catch {
    console.error(`Invalid AGNT_SERVER_URL: ${rawEnv}`);
    process.exit(1);
  }
}

// fixed = Capacitor always opens {origin}/m (optional pin)
// local = shell opens www; pair link supplies host (default)
const mode =
  modeEnv === 'fixed' || modeEnv === 'local'
    ? modeEnv
    : suggestedOrigin
      ? 'fixed'
      : 'local';

const config = {
  appId: 'gg.agnt.chat',
  appName: 'AGNT Chat',
  webDir: 'www',
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    // URL scheme must be a valid identifier (no spaces). "AGNT Chat" produced
    // a blank/white WKWebView on cold start in the Simulator.
    scheme: 'agntchat',
  },
  plugins: {},
};

// Host patterns (NOT full URL globs). Capacitor opens non-matching navigations
// in Safari — wrong patterns are why Save & open / pair links left the app.
// Thin client must load arbitrary LAN / Tailscale AGNT hosts in-WebView.
const allowNavigation = [
  '*', // any host (user-entered Server URL / pair link)
  'localhost',
  '127.0.0.1',
  '::1',
];

if (mode === 'fixed') {
  // Prefer localhost over 127.0.0.1 for iOS Simulator WKWebView (more reliable).
  let origin = suggestedOrigin || 'http://localhost:3333';
  try {
    const u = new URL(origin);
    if (u.hostname === '127.0.0.1') {
      u.hostname = 'localhost';
      origin = u.origin;
    }
  } catch {
    /* keep origin */
  }
  const isHttp = origin.startsWith('http://');
  config.server = {
    // Load lite home; trailing path is fine for SPA fallback.
    url: `${origin}/m`,
    cleartext: isHttp,
    allowNavigation,
  };
} else {
  // Local bootstrap → window.location to http(s)://host/m must stay in WebView.
  // Always cleartext so http:// LAN / Tailscale / localhost works.
  config.server = {
    cleartext: true,
    allowNavigation,
  };
}

const bootConfig = {
  mode,
  suggestedOrigin,
  generatedAt: new Date().toISOString(),
};
fs.mkdirSync(path.join(dir, 'www'), { recursive: true });
fs.writeFileSync(
  path.join(dir, 'www', 'boot-config.json'),
  `${JSON.stringify(bootConfig, null, 2)}\n`,
);

const out = path.join(dir, 'capacitor.config.json');
fs.writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, out)}`);
console.log(`  mode = ${mode}`);
if (mode === 'fixed') {
  console.log(`  server.url = ${config.server.url}`);
} else {
  console.log('  server.url = (none — paste pair link provides host)');
  if (suggestedOrigin) console.log(`  suggestedOrigin = ${suggestedOrigin}`);
}
