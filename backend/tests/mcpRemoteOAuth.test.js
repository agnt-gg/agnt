/**
 * Remote MCP + OAuth 2.1 support.
 *
 * Covers the three defects this branch fixes and the new behaviour it adds:
 *   - `http-post` was supported by MCPClient but rejected by config validation,
 *     so it could never be configured
 *   - remote transport headers were dropped, turning a 401 into "no tools"
 *   - Streamable HTTP responses arrive SSE-framed and were unparseable
 */
import { describe, it, expect, beforeEach } from 'vitest';
import MCPDiscovery from '../src/tools/library/mcp/MCPDiscovery.js';
import MCPService from '../src/services/MCPService.js';
import StreamableHTTPTransport, { parseSseEvents } from '../src/tools/library/mcp/transports/StreamableHTTPTransport.js';

describe('parseSseEvents', () => {
  it('extracts a JSON-RPC reply from an SSE frame', () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
    expect(parseSseEvents(body)).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }]);
  });

  it('handles CRLF line endings', () => {
    const body = 'event: message\r\ndata: {"id":7,"result":{}}\r\n\r\n';
    expect(parseSseEvents(body)[0].id).toBe(7);
  });

  it('joins multi-line data fields', () => {
    const body = 'data: {"id":1,\ndata: "result":{"a":1}}\n\n';
    expect(parseSseEvents(body)[0]).toEqual({ id: 1, result: { a: 1 } });
  });

  it('skips keep-alive comments and malformed frames without throwing', () => {
    const body = ': keep-alive\n\ndata: not json\n\ndata: {"id":2,"result":{}}\n\n';
    const events = parseSseEvents(body);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(2);
  });

  it('returns an empty list for an empty body', () => {
    expect(parseSseEvents('')).toEqual([]);
  });
});

describe('StreamableHTTPTransport', () => {
  it('requires an endpoint', async () => {
    await expect(new StreamableHTTPTransport({}).connect()).rejects.toThrow(/requires an endpoint/);
  });

  it('sends the negotiated session id and protocol version on later requests', async () => {
    const seen = [];
    const transport = new StreamableHTTPTransport({ endpoint: 'https://example.test/mcp' });
    globalThis.fetch = async (_url, init) => {
      seen.push(init.headers);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: init.body.match(/"id":"?([^,"]+)/)[1], result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-123' },
      });
    };
    await transport.connect();
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect(seen[0]['Mcp-Session-Id']).toBeUndefined();
    expect(seen[1]['Mcp-Session-Id']).toBe('sess-123');
    expect(seen[1]['MCP-Protocol-Version']).toBeTruthy();
  });

  it('refreshes and retries exactly once on 401', async () => {
    let calls = 0;
    let refreshes = 0;
    const transport = new StreamableHTTPTransport({
      endpoint: 'https://example.test/mcp',
      getAuthHeader: async () => 'Bearer t',
      onUnauthorized: async () => { refreshes++; return true; },
    });
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    await transport.connect();
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(refreshes).toBe(1);
    expect(calls).toBe(2);
  });

  it('does not retry forever when refresh keeps succeeding but auth keeps failing', async () => {
    let calls = 0;
    const transport = new StreamableHTTPTransport({
      endpoint: 'https://example.test/mcp',
      getAuthHeader: async () => 'Bearer t',
      onUnauthorized: async () => true,
    });
    globalThis.fetch = async () => { calls++; return new Response('nope', { status: 401 }); };
    await transport.connect();
    await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).rejects.toThrow();
    expect(calls).toBe(2); // original + one retry, never more
  });

  it('parses an SSE-framed response body', async () => {
    const transport = new StreamableHTTPTransport({ endpoint: 'https://example.test/mcp' });
    globalThis.fetch = async () => new Response(
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
    await transport.connect();
    const res = await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.result.tools).toEqual([]);
  });
});

describe('MCPDiscovery normalization', () => {
  let discovery;
  beforeEach(() => { discovery = new MCPDiscovery(); });

  it('accepts the `url` key used by every other MCP client', () => {
    discovery._addServer(
      { name: 'upwork', transport: { type: 'streamable-http', url: 'https://mcp.upwork.com/mcp' } },
      'test',
    );
    const server = discovery.getServer('upwork');
    expect(server.transport).toBe('streamable-http');
    expect(server.http.endpoint).toBe('https://mcp.upwork.com/mcp');
  });

  it('treats a bare `url` shorthand as streamable-http, not legacy SSE', () => {
    discovery._addServer({ name: 'remote', url: 'https://example.test/mcp' }, 'test');
    expect(discovery.getServer('remote').transport).toBe('streamable-http');
  });

  it('keeps an explicit `endpoint` shorthand on the legacy http transport', () => {
    discovery._addServer({ name: 'legacy', endpoint: 'https://example.test/sse' }, 'test');
    expect(discovery.getServer('legacy').transport).toBe('http');
  });

  it('carries the OAuth marker but never credentials', () => {
    discovery._addServer(
      { name: 'upwork', transport: { type: 'streamable-http', url: 'https://x.test/mcp' }, auth: { type: 'oauth2' } },
      'test',
    );
    const server = discovery.getServer('upwork');
    expect(server.auth).toEqual({ type: 'oauth2', identity: 'upwork' });
    expect(JSON.stringify(server)).not.toMatch(/token|secret/i);
  });

  it('defaults the auth identity to the server name and allows an override', () => {
    discovery._addServer(
      { name: 'a', transport: { type: 'streamable-http', url: 'https://x.test/mcp' }, auth: { type: 'oauth2', identity: 'shared' } },
      'test',
    );
    expect(discovery.getServer('a').auth.identity).toBe('shared');
  });
});

describe('MCPService.validateServerConfig', () => {
  const base = { name: 'x' };

  it('accepts http-post, which was previously unconfigurable', () => {
    const result = MCPService.validateServerConfig({
      ...base, transport: { type: 'http-post', endpoint: 'https://example.test/mcp' },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts streamable-http with a url', () => {
    expect(MCPService.validateServerConfig({
      ...base, transport: { type: 'streamable-http', url: 'https://example.test/mcp' },
    }).valid).toBe(true);
  });

  it('rejects an unknown transport', () => {
    expect(MCPService.validateServerConfig({ ...base, transport: { type: 'carrier-pigeon' } }).valid).toBe(false);
  });

  it('rejects a remote transport with no endpoint or url', () => {
    expect(MCPService.validateServerConfig({ ...base, transport: { type: 'streamable-http' } }).valid).toBe(false);
  });

  it('refuses to send a bearer token over cleartext http', () => {
    const result = MCPService.validateServerConfig({
      ...base,
      transport: { type: 'streamable-http', url: 'http://evil.test/mcp' },
      auth: { type: 'oauth2' },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/https/i);
  });

  it('permits cleartext on loopback, which never leaves the machine', () => {
    expect(MCPService.validateServerConfig({
      ...base,
      transport: { type: 'streamable-http', url: 'http://localhost:9000/mcp' },
      auth: { type: 'oauth2' },
    }).valid).toBe(true);
  });

  it('rejects an unsupported auth type', () => {
    expect(MCPService.validateServerConfig({
      ...base,
      transport: { type: 'streamable-http', url: 'https://example.test/mcp' },
      auth: { type: 'basic' },
    }).valid).toBe(false);
  });

  it('still accepts a plain stdio server', () => {
    expect(MCPService.validateServerConfig({
      ...base, transport: { type: 'stdio', command: 'node', args: ['x.js'] },
    }).valid).toBe(true);
  });
});

describe('MCPOAuthService', () => {
  it('refuses an unknown authorization state (replay / CSRF defence)', async () => {
    const { default: MCPOAuthService } = await import('../src/services/MCPOAuthService.js');
    await expect(
      MCPOAuthService.completeAuthorization({ state: 'never-issued', code: 'abc' }),
    ).rejects.toThrow(/Unknown or expired/);
  });

  it('reports a disconnected server without throwing', async () => {
    const { default: MCPOAuthService } = await import('../src/services/MCPOAuthService.js');
    expect(MCPOAuthService.status('definitely-not-configured')).toEqual({ connected: false });
    expect(MCPOAuthService.authProviderFor('definitely-not-configured')).toBeNull();
  });

  it('refuses a state that has outlived its TTL', async () => {
    const { default: MCPOAuthService } = await import('../src/services/MCPOAuthService.js');
    // Plant an entry that is older than the 10-minute window. The sweep only
    // runs when a NEW authorization begins, so redemption must check age too.
    MCPOAuthService._pending.set('stale-state', {
      serverName: 'x', verifier: 'v', authServer: {}, client: {}, resource: 'r',
      redirectUri: 'http://localhost/cb', createdAt: Date.now() - 11 * 60 * 1000,
    });
    await expect(
      MCPOAuthService.completeAuthorization({ state: 'stale-state', code: 'abc' }),
    ).rejects.toThrow(/expired/i);
  });

  it('consumes a state atomically so a replayed callback cannot retry', async () => {
    const { default: MCPOAuthService } = await import('../src/services/MCPOAuthService.js');
    MCPOAuthService._pending.set('once-only', {
      serverName: 'x', verifier: 'v', authServer: {}, client: {}, resource: 'r',
      redirectUri: 'http://localhost/cb', createdAt: Date.now() - 11 * 60 * 1000,
    });
    await expect(MCPOAuthService.completeAuthorization({ state: 'once-only', code: 'a' }))
      .rejects.toThrow(/expired/i);
    // Second attempt sees no entry at all — the first consumed it.
    await expect(MCPOAuthService.completeAuthorization({ state: 'once-only', code: 'a' }))
      .rejects.toThrow(/Unknown or expired/);
    expect(MCPOAuthService._pending.has('once-only')).toBe(false);
  });
});
