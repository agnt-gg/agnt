import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({ Authorization: 'Bearer session' }) }));
const { legacyWebhooks, legacyMail, RETIRED_RETRY_MS, __resetLegacyRelayForTests } = await import('./legacyRelay.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('legacy relay client', () => {
  beforeEach(() => {
    __resetLegacyRelayForTests();
    process.env.REMOTE_URL = 'https://api.agnt.gg';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('identifies itself and never sends an owner id (the server takes it from the token)', async () => {
    const fetch = vi.fn(async () => json(200, { success: true }));
    vi.stubGlobal('fetch', fetch);
    await legacyWebhooks.register({ workflowId: 'wf-1', userId: 'someone-else', method: 'POST' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.agnt.gg/webhooks/register');
    expect(init.headers.Authorization).toBe('Bearer session');
    expect(JSON.parse(init.body)).not.toHaveProperty('userId');
  });

  it('a retired route (410) is skipped for 15 minutes, then tried again', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(410, { error: 'retired' }));
    vi.stubGlobal('fetch', fetch);

    await expect(legacyWebhooks.poll(['wf-1'])).rejects.toMatchObject({ code: 'retired' });
    await expect(legacyWebhooks.poll(['wf-1'])).rejects.toMatchObject({ code: 'paused' });
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RETIRED_RETRY_MS + 1);
    fetch.mockResolvedValueOnce(json(200, { success: true, triggers: [{ id: 't' }] }));
    await expect(legacyWebhooks.poll(['wf-1'])).resolves.toEqual([{ id: 't' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a pause on one source does not pause the other', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).includes('/webhooks/') ? json(410, {}) : json(200, { success: true, messageId: 'm' }))));
    await expect(legacyWebhooks.poll(['wf-1'])).rejects.toMatchObject({ code: 'retired' });
    await expect(legacyMail.send({ to: 'a@b.com', subject: 'S', text: 'T' })).resolves.toMatchObject({ messageId: 'm' });
  });

  it('legacy send posts the 0.6.6 body shape', async () => {
    const fetch = vi.fn(async () => json(200, { success: true }));
    vi.stubGlobal('fetch', fetch);
    await legacyMail.send({ to: 'a@b.com', subject: 'S', html: '<b>x</b>', workflowId: 'wf-9' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ params: { to: 'a@b.com', subject: 'S', body: '<b>x</b>', isHtml: true }, workflowId: 'wf-9' });
  });
});
