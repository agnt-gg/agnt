import { describe, it, expect, vi } from 'vitest';
import { isPublicAddress, createDestinationGuard } from './destinationGuard.js';

/**
 * The address rule is scrape.agnt.gg's egress proxy rule (Python is_global, not multicast,
 * not reserved), applied on the desktop. Every case below is a way an agent-chosen URL has
 * been known to reach inside: literal private IPs, loopback spellings, IPv4 hidden in IPv6,
 * cloud metadata, *.localhost, and a public name whose record set includes a private address.
 */
describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8', '1.1.1.1', '93.184.215.14', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1',
    '2606:4700:4700::1111', '2001:4860:4860::8888',
  ])('%s is public', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['127.0.0.1', 'loopback'], ['127.255.255.254', 'loopback, anywhere in /8'], ['0.0.0.0', 'this host'],
    ['10.1.2.3', 'private'], ['172.16.0.1', 'private'], ['172.31.255.255', 'private'], ['192.168.1.1', 'a router'],
    ['169.254.169.254', 'cloud metadata'], ['100.64.0.1', 'CGNAT / Tailscale'], ['198.18.0.1', 'benchmarking'],
    ['192.0.2.1', 'documentation'], ['224.0.0.251', 'multicast (mDNS)'], ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'], ['::', 'unspecified'], ['fe80::1', 'link-local'], ['fd12:3456::1', 'unique local'],
    ['ff02::1', 'multicast'], ['::ffff:127.0.0.1', 'loopback inside IPv4-mapped IPv6'],
    ['::ffff:7f00:1', 'the same, as URL parsers write it'], ['::ffff:c0a8:101', '192.168.1.1, mapped'],
    ['::7f00:1', 'IPv4-compatible (deprecated, reserved)'],
  ])('%s is not public (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('treats anything that is not an IP address as not public', () => {
    expect(isPublicAddress('localhost')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });

  it('lets an IPv4-mapped PUBLIC address through', () => {
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });
});

describe('createDestinationGuard', () => {
  const answers = {
    'example.com': [{ address: '93.184.215.14', family: 4 }],
    'dual.example': [{ address: '2606:4700::1', family: 6 }, { address: '1.1.1.1', family: 4 }],
    'rebind.example': [{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }],
    'router.example': [{ address: '192.168.1.1', family: 4 }],
  };
  const lookup = vi.fn(async (host) => {
    if (!answers[host]) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return answers[host];
  });
  const guard = () => {
    lookup.mockClear();
    return createDestinationGuard({ lookup });
  };

  it.each([
    ['https://example.com/a', 'allow'],
    ['http://dual.example:8080/', 'allow'],
    ['https://router.example/admin', 'deny'],
    ['https://rebind.example/', 'deny'], // ONE private answer is enough: that is the one Chrome may pick
    ['http://192.168.1.1/', 'deny'],
    ['http://[::1]:11434/api', 'deny'],
    ['http://[::ffff:7f00:1]/', 'deny'],
    ['http://169.254.169.254/latest/meta-data/', 'deny'],
    ['http://localhost:5173/', 'deny'],
    ['http://app.localhost/', 'deny'],
    ['http://LOCALHOST./', 'deny'],
    ['https://nonexistent.example/', 'unresolved'],
    ['data:text/plain,hi', 'allow'],
    ['blob:https://example.com/uuid', 'allow'],
    ['about:blank', 'allow'],
    ['file:///C:/Windows/win.ini', 'deny'],
    ['ftp://example.com/', 'deny'],
    ['not a url', 'deny'],
  ])('%s -> %s', async (url, expected) => {
    expect(await guard().verdict(url)).toBe(expected);
  });

  it('never asks DNS about a literal address or a localhost name', async () => {
    const g = guard();
    await g.verdict('http://10.0.0.1/');
    await g.verdict('http://localhost/');
    await g.verdict('http://[fe80::1]/');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('looks each host up once per scrape, however many requests the page makes', async () => {
    const g = guard();
    await Promise.all([g.verdict('https://example.com/a'), g.verdict('https://example.com/b.png'), g.verdict('https://EXAMPLE.com/c.js')]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('a name that resolves to nothing is unresolved, not allowed', async () => {
    const g = createDestinationGuard({ lookup: async () => [] });
    expect(await g.verdict('https://empty.example/')).toBe('unresolved');
  });
});
