import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A new hosted endpoint answers 404 at its public URL while `provisioning`
 * (measured ~3s on webhooks.agnt.gg). createEndpoint must not hand the URL
 * out until it is `active`, or a sender that fires at once loses its event.
 */
const callService = vi.fn();
vi.mock('./agntServices.js', () => ({ callService: (...args) => callService(...args) }));
const { createEndpoint } = await import('./agntWebhooks.js');

const ep = (state) => ({ id: 'ep-1', slug: 's1', name: 'workflow-abcdef12', url: 'https://webhooks.agnt.gg/in/s1', state });

describe('createEndpoint waits for activation', () => {
  beforeEach(() => {
    callService.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('returns only once the new endpoint is active', async () => {
    callService
      .mockResolvedValueOnce({ endpoints: [] }) // no existing endpoint by name
      .mockResolvedValueOnce(ep('provisioning')) // POST /endpoints
      .mockResolvedValueOnce({ endpoints: [ep('provisioning')] })
      .mockResolvedValueOnce({ endpoints: [ep('active')] });
    let settled = null;
    const pending = createEndpoint('abcdef12-0000').then((value) => (settled = value));

    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBeNull(); // still provisioning: not handed out yet
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(settled).toMatchObject({ id: 'ep-1', state: 'active', url: 'https://webhooks.agnt.gg/in/s1' });
    expect(callService.mock.calls.filter(([, path, o]) => path === '/endpoints' && o?.method === 'POST')).toHaveLength(1);
  });

  it('adopts an endpoint left provisioning by an earlier crash instead of minting another', async () => {
    callService.mockResolvedValueOnce({ endpoints: [ep('provisioning')] }).mockResolvedValueOnce({ endpoints: [ep('active')] });
    const pending = createEndpoint('abcdef12-0000');
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ id: 'ep-1', state: 'active' });
    expect(callService.mock.calls.some(([, , o]) => o?.method === 'POST')).toBe(false);
  });

  it('an already active endpoint returns at once', async () => {
    callService.mockResolvedValueOnce({ endpoints: [ep('active')] });
    expect(await createEndpoint('abcdef12-0000')).toMatchObject({ state: 'active' });
    expect(callService).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting after the deadline and still returns the endpoint', async () => {
    callService.mockResolvedValueOnce({ endpoints: [] }).mockResolvedValueOnce(ep('provisioning')).mockResolvedValue({ endpoints: [ep('provisioning')] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pending = createEndpoint('abcdef12-0000');
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await pending).toMatchObject({ state: 'provisioning' });
    expect(warn).toHaveBeenCalled();
  });
});
