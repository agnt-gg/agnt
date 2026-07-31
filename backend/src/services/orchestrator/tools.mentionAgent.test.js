import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * mention_agent tool behaviour: resolves agents by id, exact name, and
 * partial name; refuses unknowns with the available list; carries the
 * handoff note through to the result the frontend floor queue consumes.
 *
 * NOTE: tools.js does `import fetch from 'node-fetch'` (module-scoped), so
 * vi.stubGlobal('fetch') can NEVER intercept it — the module import must be
 * mocked. (Measured: with stubGlobal the tests hit the real running backend
 * and came back 401.)
 */

const AGENTS = [
  { id: 'agent-uuid-1', name: 'Researcher', icon: '🔬' },
  { id: 'agent-uuid-2', name: 'Code Reviewer', icon: '🧐' },
];

const fetchMock = vi.fn();

vi.mock('node-fetch', () => ({
  default: (...args) => fetchMock(...args),
}));

const { TOOLS } = await import('./tools.js');

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ agents: AGENTS }),
  });
});

describe('mention_agent tool', () => {
  it('is registered with schema and execute', () => {
    expect(TOOLS.mention_agent).toBeDefined();
    expect(TOOLS.mention_agent.schema.function.name).toBe('mention_agent');
    expect(TOOLS.mention_agent.schema.function.parameters.required).toEqual(['agentId']);
    expect(typeof TOOLS.mention_agent.execute).toBe('function');
  });

  it('resolves by UUID', async () => {
    const out = JSON.parse(await TOOLS.mention_agent.execute({ agentId: 'agent-uuid-1' }, 'Bearer t'));
    expect(out.success).toBe(true);
    expect(out.agentId).toBe('agent-uuid-1');
    expect(out.agentName).toBe('Researcher');
  });

  it('resolves by exact display name (case-insensitive)', async () => {
    const out = JSON.parse(await TOOLS.mention_agent.execute({ agentId: 'researcher' }, 'Bearer t'));
    expect(out.success).toBe(true);
    expect(out.agentId).toBe('agent-uuid-1');
  });

  it('resolves by partial name', async () => {
    const out = JSON.parse(await TOOLS.mention_agent.execute({ agentId: 'reviewer' }, 'Bearer t'));
    expect(out.success).toBe(true);
    expect(out.agentId).toBe('agent-uuid-2');
  });

  it('carries the handoff note through', async () => {
    const out = JSON.parse(await TOOLS.mention_agent.execute(
      { agentId: 'Researcher', note: 'focus on the benchmark numbers' }, 'Bearer t'));
    expect(out.note).toBe('focus on the benchmark numbers');
  });

  it('sends the caller authToken to the agents API', async () => {
    await TOOLS.mention_agent.execute({ agentId: 'Researcher' }, 'Bearer real-token');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agents'),
      expect.objectContaining({ headers: { Authorization: 'Bearer real-token' } }),
    );
  });

  it('refuses unknown agents and names the available ones', async () => {
    const out = JSON.parse(await TOOLS.mention_agent.execute({ agentId: 'nobody-here' }, 'Bearer t'));
    expect(out.success).toBe(false);
    expect(out.error).toContain('Researcher');
  });

  it('refuses a missing agentId', async () => {
    const out = JSON.parse(await TOOLS.mention_agent.execute({}, 'Bearer t'));
    expect(out.success).toBe(false);
  });

  it('fails cleanly when the agents API is down', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = JSON.parse(await TOOLS.mention_agent.execute({ agentId: 'Researcher' }, 'Bearer t'));
    expect(out.success).toBe(false);
    expect(out.error).toContain('ECONNREFUSED');
  });
});
