import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * pullEvents must return only events AFTER the cursor.
 *
 * The service filters on `?after=` and silently ignores any other parameter
 * name. Asking with `?since=` returned the endpoint's whole retention window on
 * every poll, so each stored event re-triggered its workflow every ten seconds
 * for as long as the workflow listened.
 */
const callService = vi.fn();
vi.mock('./agntServices.js', () => ({ callService: (...args) => callService(...args) }));

describe('pullEvents asks the service for events after the cursor', () => {
  beforeEach(() => {
    callService.mockReset();
  });

  it('sends the cursor as `after`, the parameter the service honours', async () => {
    callService.mockResolvedValueOnce({ events: [] });
    const { pullEvents } = await import('./agntWebhooks.js');

    await pullEvents('ep-1', 1000);

    const [, path, options] = callService.mock.calls[0];
    expect(path).toBe('/endpoints/ep-1/events');
    expect(options.query).toMatchObject({ after: 1000 });
    expect(options.query).not.toHaveProperty('since');
  });

  it('drops rows at or before the cursor even if the service returns them, without fetching their bodies', async () => {
    // Defence in depth: a service that ignores the filter must not turn into
    // a re-delivery loop again.
    callService.mockImplementation(async (_svc, path) => {
      if (path.endsWith('/events')) {
        return {
          events: [
            { id: 'old', received_at: 900 },
            { id: 'edge', received_at: 1000 },
            { id: 'new', received_at: 1001 },
          ],
        };
      }
      return { id: path.split('/').pop(), receivedAt: 1001, body: '{}' };
    });
    const { pullEvents } = await import('./agntWebhooks.js');

    const events = await pullEvents('ep-1', 1000);

    expect(events.map((e) => e.id)).toEqual(['new']);
    const detailFetches = callService.mock.calls.filter(([, path]) => path.startsWith('/events/'));
    expect(detailFetches.map(([, path]) => path)).toEqual(['/events/new']);
  });
});
