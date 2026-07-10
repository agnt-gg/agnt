/**
 * DomainInterceptor — trust system W7: best-effort runtime domain interception.
 *
 * HONESTY CONTRACT (honesty contract — do not soften or strengthen):
 * plugins run in-process via dynamic import(), so wrapping global fetch is
 * INTERCEPTION, NOT CONTAINMENT. A malicious plugin bypasses this trivially
 * (child_process, raw sockets, undici, restoring the global). This exists to
 * keep honest plugins honest, surface undeclared network use on the plugin
 * card, and feed the trust badge. Real containment is the planned plugin sandbox.
 *
 * Mechanics:
 *   - installGlobalFetchWrapper() patches globalThis.fetch ONCE at boot
 *   - runWithPluginContext(name, domains, fn) runs fn inside an
 *     AsyncLocalStorage context carrying the plugin's declared domains
 *   - inside a context: undeclared hostname → violation recorded + WARN
 *     (set AGNT_DOMAIN_ENFORCE=block to actually reject — off by default)
 *   - outside any context (core app code): zero behavior change
 */

import { AsyncLocalStorage } from 'async_hooks';

const als = new AsyncLocalStorage();
const violations = []; // ring buffer, newest last
const MAX_VIOLATIONS = 500;

let installed = false;
let originalFetch = null;

/** Does `hostname` match a declared domain (exact or *.suffix)? */
export function hostnameAllowed(hostname, domains) {
  if (!domains || domains.size === 0) return true; // nothing declared → no restriction claimed
  const h = String(hostname).toLowerCase();
  for (const d of domains) {
    const dom = d.toLowerCase();
    if (dom.startsWith('*.')) {
      const suffix = dom.slice(1); // ".example.com"
      if (h.endsWith(suffix) || h === dom.slice(2)) return true;
    } else if (h === dom) {
      return true;
    }
  }
  return false;
}

function recordViolation(pluginName, hostname, url) {
  const existing = violations.find((v) => v.plugin === pluginName && v.hostname === hostname);
  if (existing) {
    existing.count++;
    existing.lastAt = new Date().toISOString();
  } else {
    violations.push({ plugin: pluginName, hostname, sampleUrl: String(url).slice(0, 200), count: 1, lastAt: new Date().toISOString() });
    if (violations.length > MAX_VIOLATIONS) violations.shift();
  }
  console.warn(`[DomainInterceptor] ${pluginName}: undeclared network access to ${hostname} (declared domains do not include it)`);
}

export function installGlobalFetchWrapper() {
  if (installed || typeof globalThis.fetch !== 'function') return;
  originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = function agntInterceptedFetch(input, init) {
    const ctx = als.getStore();
    if (ctx && ctx.domains && ctx.domains.size > 0) {
      let hostname = null;
      try {
        const url = typeof input === 'string' || input instanceof URL ? new URL(String(input)) : new URL(input.url);
        hostname = url.hostname;
      } catch {
        /* relative/opaque URL — let it through */
      }
      if (hostname && !hostnameAllowed(hostname, ctx.domains)) {
        recordViolation(ctx.pluginName, hostname, input);
        if (process.env.AGNT_DOMAIN_ENFORCE === 'block') {
          return Promise.reject(
            new Error(
              `[DomainInterceptor] ${ctx.pluginName} attempted fetch to undeclared domain "${hostname}". Declared: ${[...ctx.domains].join(', ')}`
            )
          );
        }
      }
    }
    return originalFetch(input, init);
  };
  installed = true;
  console.log(`[DomainInterceptor] Global fetch wrapper installed (mode: ${process.env.AGNT_DOMAIN_ENFORCE === 'block' ? 'BLOCK' : 'warn-only'})`);
}

/**
 * Run fn attributed to a plugin. `domains` is an array of declared domain
 * strings (from manifest.permissions.domains); empty/undefined = attribution
 * only, no restriction claimed.
 */
export function runWithPluginContext(pluginName, domains, fn) {
  const set = new Set((domains || []).filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim()));
  return als.run({ pluginName, domains: set }, fn);
}

export function getViolations() {
  return [...violations];
}

export function _resetForTests() {
  violations.length = 0;
}

export default { installGlobalFetchWrapper, runWithPluginContext, getViolations, hostnameAllowed, _resetForTests };
