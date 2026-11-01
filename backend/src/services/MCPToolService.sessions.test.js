import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPToolService, MCP_SESSION_IDLE_MS, MAX_MCP_SESSIONS } from './MCPToolService.js';
import { withToolActor } from './security/toolRunAuthority.js';

/**
 * Bravo, 2026-10-31: the Chrome DevTools MCP server opened pages that were gone by the next call ("No
 * page found"). executeTool spawned the server per call and closed it, taking its Chrome with it.
 */

const SERVER = { name: 'chrome-devtools', transport: 'stdio', stdio: { command: 'npx', args: ['chrome-devtools-mcp'] } };
let service; let clients;

function fakeClient() {
  const client = {
    transport: { connected: true },
    initialize: vi.fn(async () => ({})),
    callTool: vi.fn(async (name) => ({ content: [{ type: 'text', text: `${name} ok` }] })),
    close: vi.fn(async () => { client.transport.connected = false; }),
  };
  clients.push(client);
  return client;
}

beforeEach(() => {
  vi.useFakeTimers();
  clients = [];
  service = new MCPToolService();
  service.resolve = vi.fn(async (name) => ({ server: SERVER, originalToolName: name.split('__').pop() }));
  service._buildClient = vi.fn(fakeClient);
});
afterEach(() => { service.closeSessions(); vi.useRealTimers(); });

const call = (tool, actor = 'owner') => withToolActor(actor, () => service.executeTool(`mcp__chrome-devtools__${tool}`, {}));

describe('MCP tool sessions', () => {
  it('two calls in a row use one server, so state such as open pages survives between them', async () => {
    await call('new_page');
    await call('take_snapshot');
    expect(service._buildClient).toHaveBeenCalledTimes(1);
    expect(clients[0].initialize).toHaveBeenCalledTimes(1);
    expect(clients[0].callTool.mock.calls.map(([name]) => name)).toEqual(['new_page', 'take_snapshot']);
    expect(clients[0].close).not.toHaveBeenCalled();
  });

  it('accounts never share a server', async () => {
    await call('new_page', 'owner');
    await call('list_pages', 'member-2');
    expect(clients).toHaveLength(2);
  });

  it('closes after the idle window, and the next call starts a fresh server', async () => {
    await call('new_page');
    vi.advanceTimersByTime(MCP_SESSION_IDLE_MS - 1);
    expect(clients[0].close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    await call('new_page');
    expect(clients).toHaveLength(2);
  });

  it('a server that died between calls is replaced, not reused', async () => {
    await call('new_page');
    clients[0].transport.connected = false;
    await call('take_snapshot');
    expect(clients).toHaveLength(2);
    expect(clients[1].callTool).toHaveBeenCalledWith('take_snapshot', {});
  });

  it('a failed call closes its session; a failed start is not kept either', async () => {
    service._buildClient = vi.fn(() => { const c = fakeClient(); c.callTool = vi.fn(async () => { throw new Error('transport closed'); }); return c; });
    await expect(call('new_page')).rejects.toThrow('transport closed');
    expect(clients[0].close).toHaveBeenCalled();
    service._buildClient = vi.fn(() => { const c = fakeClient(); c.initialize = vi.fn(async () => { throw new Error('spawn failed'); }); return c; });
    await expect(call('new_page')).rejects.toThrow('spawn failed');
    expect(service._sessions.size).toBe(0);
  });

  it('a config change closes every session', async () => {
    service.refreshSchemas = vi.fn(async () => {});
    await call('new_page');
    service.invalidate();
    expect(clients[0].close).toHaveBeenCalled();
    expect(service._sessions.size).toBe(0);
  });

  it('holds at most MAX_MCP_SESSIONS, closing the least recently used idle one first', async () => {
    for (let i = 0; i <= MAX_MCP_SESSIONS; i += 1) {
      vi.advanceTimersByTime(10);
      await call('list_pages', `account-${i}`);
    }
    expect(service._sessions.size).toBe(MAX_MCP_SESSIONS);
    expect(clients[0].close).toHaveBeenCalled();
    expect(clients[1].close).not.toHaveBeenCalled();
  });
});
