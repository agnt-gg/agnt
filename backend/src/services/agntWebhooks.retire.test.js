import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let endpoints = [];
vi.mock('./agntServices.js', () => ({
  callService: vi.fn(async (service, path, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${path}`);
    if (path === '/endpoints' && !opts.method) return { endpoints };
    return {};
  }),
}));

describe('retireEndpointsFor', () => {
  beforeEach(() => { calls.length = 0; });

  it('retires every live endpoint named for the workflow, and nothing else', async () => {
    const { retireEndpointsFor } = await import('./agntWebhooks.js');
    endpoints = [
      { id: 'a', name: 'workflow-1c9c8b09', state: 'active' },
      { id: 'b', name: 'workflow-1c9c8b09', state: 'provisioning' },
      { id: 'c', name: 'workflow-1c9c8b09', state: 'retired' },
      { id: 'd', name: 'workflow-77f8ce90', state: 'active' },
    ];
    const count = await retireEndpointsFor('1c9c8b09-6455-4309-a9dd-d6aa58154a94');
    expect(count).toBe(2);
    expect(calls.filter((c) => c.startsWith('DELETE')).sort()).toEqual(['DELETE /endpoints/a', 'DELETE /endpoints/b']);
  });

  it('also retires the recorded endpoint even if the list no longer shows it, once', async () => {
    const { retireEndpointsFor } = await import('./agntWebhooks.js');
    endpoints = [{ id: 'a', name: 'workflow-1c9c8b09', state: 'active' }];
    const count = await retireEndpointsFor('1c9c8b09-x', 'a');
    expect(count).toBe(1);
    expect(calls.filter((c) => c.startsWith('DELETE'))).toEqual(['DELETE /endpoints/a']);
  });
});
