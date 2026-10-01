/**
 * Keeps the web scraper off this computer and the user's private network unless the caller
 * asks for it (allowLocal).
 *
 * WHY. The scraper runs as the user, so it can reach what the user can: dev servers on
 * localhost, Ollama, the router's admin page, a NAS, the cloud metadata address. An agent
 * chooses the URLs, and a web page can tell an agent which URL to read next. Blocked by
 * default, a prompt-injected "now scrape http://192.168.1.1/" fails instead of handing the
 * router's page to whoever wrote the injection. In nine months of history (2026-10-01) the
 * chat tool scraped an internal address twice in 8,886 calls, both deliberate.
 *
 * WHAT. The rule is scrape.agnt.gg's egress proxy (agnt-server infra/hetzner/scrape/egress.py):
 * a destination is allowed only if EVERY address its name resolves to is globally routable
 * (Python's ipaddress is_global, not multicast, not reserved). Every answer, because a mixed
 * record set is how a public name reaches inside.
 *
 * LIMIT. Chrome resolves names itself, after this check. A domain whose DNS deliberately
 * answers differently on the second lookup (rebinding) can still slip past; the hosted proxy
 * closes that by connecting to the address it checked. Literal IPs, localhost names,
 * redirects and ordinary names that resolve inside are all caught.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

// One list per family, never one shared list: BlockList also checks an IPv4 address against
// its IPv6 rules as ::ffff:a.b.c.d, which ::/8 covers, so a shared list blocks every IPv4.
const NON_PUBLIC_V4 = new net.BlockList();
const NON_PUBLIC_V6 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT, Tailscale
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
]) NON_PUBLIC_V4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 8], // unspecified, loopback, IPv4-compatible (reserved)
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (private)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
]) NON_PUBLIC_V6.addSubnet(address, prefix, 'ipv6');

/** The IPv4 address inside an IPv4-mapped IPv6 address (::ffff:a.b.c.d), else null. */
function mappedIPv4(address) {
  let canonical;
  try {
    // WHATWG serialises every IPv6 form to one compressed lowercase hex form.
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!match) return null;
  const [high, low] = [parseInt(match[1], 16), parseInt(match[2], 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Is this IP address globally routable? Anything that is not an IP address is not. */
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !NON_PUBLIC_V4.check(address, 'ipv4');
  if (family === 6) {
    const mapped = mappedIPv4(address);
    if (mapped) return isPublicAddress(mapped);
    return !NON_PUBLIC_V6.check(address, 'ipv6');
  }
  return false;
}

const systemLookup = (host) => dns.lookup(host, { all: true, verbatim: true });

// Schemes that never leave the page: nothing to resolve, nothing to reach.
const IN_PAGE_SCHEMES = new Set(['data:', 'blob:', 'about:']);

/**
 * A per-scrape guard. verdict(url) resolves to:
 *   'allow'      public, or content the page already holds (data:, blob:, about:)
 *   'deny'       this computer, a private network, or any other scheme (file:, ftp:...)
 *   'unresolved' the name does not resolve; Chrome could not reach it either
 * Each host is looked up once per guard.
 */
export function createDestinationGuard({ lookup = systemLookup } = {}) {
  const verdicts = new Map();

  async function decide(host) {
    if (!host) return 'deny';
    if (net.isIP(host)) return isPublicAddress(host) ? 'allow' : 'deny';
    // RFC 6761: every *.localhost name is loopback, whatever DNS says.
    if (host === 'localhost' || host.endsWith('.localhost')) return 'deny';
    let answers;
    try {
      answers = await lookup(host);
    } catch {
      return 'unresolved';
    }
    if (!answers?.length) return 'unresolved';
    return answers.every(({ address }) => isPublicAddress(address)) ? 'allow' : 'deny';
  }

  return {
    verdict(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return Promise.resolve('deny');
      }
      if (IN_PAGE_SCHEMES.has(parsed.protocol)) return Promise.resolve('allow');
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return Promise.resolve('deny');
      const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
      if (!verdicts.has(host)) verdicts.set(host, decide(host));
      return verdicts.get(host);
    },
  };
}
