// Live-URL security recon. Non-destructive: HEAD/GET only. Checks:
//   - Security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
//   - Cookie flags (Secure, HttpOnly, SameSite)
//   - TLS: whether https is used/enforced, cert validity (via connection success)
//   - Server/tech disclosure (Server, X-Powered-By)
//   - Exposed sensitive paths (.git/config, .env, backups) — GET, first bytes only
//
// Every finding here is tool-verified: it reports the ACTUAL header/response observed.
// No exploitation, no auth bypass, no fuzzing.

import https from 'https';
import http from 'http';
import { URL } from 'url';
import { makeFinding, PROVENANCE } from '../core/findings.js';

function fetchRaw(urlStr, { method = 'GET', timeout = 12000, maxBytes = 65536 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch { return resolve({ error: 'bad url' }); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method,
      timeout,
      rejectUnauthorized: false, // we WANT to observe bad certs, not fail on them
      headers: { 'User-Agent': 'Sentinel-Security-Scanner/1.0 (+authorized-audit)' },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { if (body.length < maxBytes) body += d.toString('latin1'); });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body,
        tlsAuthorized: res.socket?.authorized,
        tlsProtocol: res.socket?.getProtocol?.(),
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

export async function runWebRecon(urlStr, opts = {}) {
  const { activeProbe = true, onProgress } = opts;
  const log = (m) => onProgress && onProgress(m);
  const findings = [];
  const u = new URL(urlStr);

  log(`Probing ${u.origin} …`);
  const main = await fetchRaw(urlStr, { method: 'GET' });
  if (main.error) {
    return { findings: [], ran: false, error: `Could not reach ${urlStr}: ${main.error}`, meta: {} };
  }

  const h = lowerHeaders(main.headers);

  // --- TLS enforcement ---
  if (u.protocol === 'http:') {
    findings.push(mk('Site served over plaintext HTTP', 'high', 'CWE-319',
      `The target responded over http:// (no TLS). Traffic including credentials and session cookies can be read or modified in transit.`,
      urlStr, 'Serve the site exclusively over HTTPS and redirect all HTTP traffic to HTTPS.', 'web',
      `Request to ${urlStr} succeeded over plaintext HTTP (status ${main.status}).`));
  } else {
    if (main.tlsAuthorized === false) {
      findings.push(mk('Invalid or untrusted TLS certificate', 'high', 'CWE-295',
        `The server's TLS certificate did not validate against trusted roots (expired, self-signed, or wrong host).`,
        urlStr, 'Install a valid certificate from a trusted CA that matches the hostname.', 'web',
        `TLS handshake completed but certificate authorization failed (protocol ${main.tlsProtocol || '?'}).`));
    }
    // HSTS
    if (!h['strict-transport-security']) {
      findings.push(mk('Missing HTTP Strict-Transport-Security (HSTS) header', 'medium', 'CWE-319',
        'Without HSTS, an initial request or a downgrade attack can occur over HTTP, exposing the session to interception.',
        urlStr, 'Add: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload', 'web',
        'Response headers did not include Strict-Transport-Security.'));
    }
  }

  // --- Security headers ---
  const headerChecks = [
    ['content-security-policy', 'Missing Content-Security-Policy (CSP)', 'medium', 'CWE-1021',
      'No CSP header. A strong CSP is the primary defense-in-depth control against cross-site scripting (XSS) and data injection.',
      "Define a restrictive Content-Security-Policy (e.g. default-src 'self'; object-src 'none'; base-uri 'self')."],
    ['x-frame-options', 'Missing X-Frame-Options / frame-ancestors', 'low', 'CWE-1021',
      'The page can be embedded in a frame on another origin, enabling clickjacking (unless CSP frame-ancestors is set).',
      "Add X-Frame-Options: DENY, or CSP frame-ancestors 'none'."],
    ['x-content-type-options', 'Missing X-Content-Type-Options: nosniff', 'low', 'CWE-16',
      'Browsers may MIME-sniff responses, which can turn a benign upload into executable script.',
      'Add X-Content-Type-Options: nosniff.'],
    ['referrer-policy', 'Missing Referrer-Policy header', 'info', 'CWE-200',
      'Without a Referrer-Policy, full URLs (which may contain tokens) can leak to third parties via the Referer header.',
      'Add Referrer-Policy: strict-origin-when-cross-origin (or stricter).'],
    ['permissions-policy', 'Missing Permissions-Policy header', 'info', 'CWE-16',
      'No Permissions-Policy to restrict powerful browser features (camera, geolocation, etc.).',
      'Add a Permissions-Policy that disables features the site does not use.'],
  ];
  for (const [key, title, sev, cwe, desc, rec] of headerChecks) {
    if (!h[key] && !(key === 'x-frame-options' && /frame-ancestors/i.test(h['content-security-policy'] || ''))) {
      findings.push(mk(title, sev, cwe, desc, urlStr, rec, 'web', `Response from ${urlStr} did not include the ${key} header.`));
    }
  }

  // --- Info disclosure ---
  for (const key of ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version']) {
    if (h[key]) {
      findings.push(mk(`Technology/version disclosure via "${key}" header`, 'info', 'CWE-200',
        `The response advertises "${key}: ${h[key]}", helping an attacker fingerprint the stack and target known CVEs.`,
        urlStr, `Remove or obfuscate the ${key} header.`, 'web',
        `${key}: ${h[key]}`));
    }
  }

  // --- Cookie flags ---
  const setCookies = main.headers['set-cookie'] || [];
  for (const c of (Array.isArray(setCookies) ? setCookies : [setCookies])) {
    const name = c.split('=')[0];
    const lc = c.toLowerCase();
    const missing = [];
    if (!/;\s*secure/i.test(lc) && u.protocol === 'https:') missing.push('Secure');
    if (!/;\s*httponly/i.test(lc)) missing.push('HttpOnly');
    if (!/;\s*samesite/i.test(lc)) missing.push('SameSite');
    if (missing.length) {
      findings.push(mk(`Cookie "${name}" missing ${missing.join(', ')} flag(s)`, missing.includes('HttpOnly') ? 'medium' : 'low', 'CWE-1004',
        `The Set-Cookie for "${name}" is missing: ${missing.join(', ')}. Missing HttpOnly exposes the cookie to XSS theft; missing Secure allows transmission over HTTP; missing SameSite enables CSRF.`,
        urlStr, `Set the ${missing.join(', ')} attribute(s) on the "${name}" cookie.`, 'web',
        `Set-Cookie: ${c.slice(0, 120)}`));
    }
  }

  // --- Active probe: exposed sensitive files ---
  if (activeProbe) {
    log('Probing for exposed sensitive files …');
    const probes = [
      ['/.git/config', 'Exposed .git repository', 'high', 'CWE-527', /\[core\]|repositoryformatversion/i],
      ['/.env', 'Exposed .env file', 'critical', 'CWE-538', /=[^\n]/],
      ['/.env.local', 'Exposed .env.local file', 'critical', 'CWE-538', /=[^\n]/],
      ['/config.json', 'Exposed config.json', 'medium', 'CWE-538', /[{]/],
      ['/backup.zip', 'Exposed backup archive', 'high', 'CWE-538', /PK\x03\x04/],
      ['/phpinfo.php', 'Exposed phpinfo()', 'medium', 'CWE-200', /phpinfo\(\)|PHP Version/i],
      ['/.aws/credentials', 'Exposed AWS credentials', 'critical', 'CWE-538', /aws_access_key_id/i],
    ];
    for (const [path, title, sev, cwe, sig] of probes) {
      const probeUrl = u.origin + path;
      const res = await fetchRaw(probeUrl, { method: 'GET', maxBytes: 8192 });
      if (res.error) continue;
      if (res.status === 200 && sig.test(res.body || '')) {
        findings.push(mk(title, sev, cwe,
          `The path ${path} is publicly accessible and returned content matching a sensitive-file signature. This can leak source code, credentials, or configuration.`,
          probeUrl, `Block public access to ${path} at the web server / CDN, and remove the file from the web root.`, 'web',
          `GET ${probeUrl} → 200, body matched ${sig}.`));
      }
    }
  }

  log(`web recon: ${findings.length} finding(s).`);
  return { findings, ran: true, meta: { status: main.status, server: h['server'] || null } };
}

function lowerHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  return out;
}

function mk(title, severity, cwe, description, file, recommendation, category, evidence) {
  return makeFinding({
    tool: 'web-recon', ruleId: title.replace(/\s+/g, '-').toLowerCase().slice(0, 40),
    title, severity, cwe, description, file, line: null,
    recommendation, category, evidence,
    provenance: PROVENANCE.TOOL_VERIFIED, confidence: 0.9,
  });
}
