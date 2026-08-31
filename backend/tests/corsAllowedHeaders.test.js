// The CORS allow-list must cover every custom header the frontend sends.
//
// These two lists are one contract written in two files, and they drift in
// total silence. When the frontend started sending X-AGNT-Client-Id and
// server.js still allowed only Content-Type and Authorization, the browser
// refused the preflight and every chat send from http://localhost:5173 failed
// with "Failed to fetch":
//
//   - the request is blocked CLIENT-side, so it never reaches the server and
//     nothing appears in any backend log;
//   - the desktop app is same-origin, sends no preflight, and stayed fine, so
//     the breakage was invisible from the surface most people use;
//   - the frontend already had a spec pinning that the header IS sent, which
//     passed the whole time — it tests one end of the contract.
//
// Node's fetch does not enforce CORS, so no amount of scripted probing from a
// test finds this either. Comparing the two source lists is what catches it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const serverSrc = read('../server.js');
const chatServiceSrc = read('../../frontend/src/services/chatService.js');

/** Header names in `allowedHeaders: [...]` of the CORS config. */
function allowedHeaders() {
  const block = serverSrc.match(/allowedHeaders:\s*\[([^\]]*)\]/);
  if (!block) return null;
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase());
}

/**
 * Custom (X-…) headers the frontend attaches to a request. Content-Type and
 * Authorization are CORS-safelisted or already allowed; an X- header is the
 * kind that needs explicit permission.
 */
function customHeadersSentByChat() {
  return [...chatServiceSrc.matchAll(/headers\[['"](x-[\w-]+)['"]\]/gi)].map((m) => m[1].toLowerCase());
}

describe('CORS allow-list vs. what the frontend actually sends', () => {
  it('parsed both lists (guards against silent regex rot)', () => {
    // Without this, a refactor that changes either shape makes the real
    // assertion below pass vacuously against two empty arrays.
    expect(allowedHeaders()).not.toBeNull();
    expect(allowedHeaders().length).toBeGreaterThanOrEqual(2);
    expect(customHeadersSentByChat().length).toBeGreaterThanOrEqual(1);
  });

  it('allows every custom header chatService sends', () => {
    const allowed = allowedHeaders();
    const missing = customHeadersSentByChat().filter((h) => !allowed.includes(h));
    expect(missing).toEqual([]);
  });

  it('still allows Content-Type and Authorization', () => {
    const allowed = allowedHeaders();
    expect(allowed).toContain('content-type');
    expect(allowed).toContain('authorization');
  });
});
