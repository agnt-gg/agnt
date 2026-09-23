import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Hosted webhook events carry the whole inbound request, and the workflow sees
 * it the way it did on the api.agnt.gg relay: the real method, the query as an
 * object, lower-cased headers, and a body that is parsed JSON, a parsed form, or
 * `{}` for a bodyless request.
 */
vi.mock('./agntServices.js', () => ({ callService: vi.fn() }));
const { eventToTrigger } = await import('./agntWebhooks.js');

describe('eventToTrigger', () => {
  it('keeps the method, parses the query and lower-cases headers', () => {
    const t = eventToTrigger({
      id: 'e1', method: 'delete', query: 'id=42&tag=a&tag=b&q=hello%20world',
      headers: { Authorization: 'Bearer x', 'X-Custom': 'v' }, body: '', contentType: null,
    });
    expect(t.method).toBe('DELETE');
    expect(t.query).toEqual({ id: '42', tag: ['a', 'b'], q: 'hello world' });
    expect(t.headers).toEqual({ authorization: 'Bearer x', 'x-custom': 'v' });
    expect(t.body).toEqual({});
  });

  it('parses JSON and form bodies', () => {
    expect(eventToTrigger({ method: 'PUT', body: '{"a":1}', contentType: 'application/json' }).body).toEqual({ a: 1 });
    expect(eventToTrigger({ method: 'PATCH', body: 'a=1&b=two', contentType: 'application/x-www-form-urlencoded' }).body).toEqual({ a: '1', b: 'two' });
  });

  it('wraps non-object bodies the way the relay did', () => {
    expect(eventToTrigger({ method: 'POST', body: 'plain text', contentType: 'text/plain' }).body).toEqual({ data: 'plain text' });
    expect(eventToTrigger({ method: 'POST', body: '[1,2]', contentType: 'application/json' }).body).toEqual({ data: [1, 2] });
    expect(eventToTrigger({ method: 'POST', body: '{bad', contentType: 'application/json' }).body).toEqual({ data: '{bad' });
  });

  it('reads an event stored before the envelope existed as a bare POST', () => {
    const t = eventToTrigger({ id: 'old', body: '{"x":1}', contentType: 'application/json' });
    expect(t).toMatchObject({ method: 'POST', query: {}, headers: {}, body: { x: 1 } });
  });
});

/** The receiver's existing method filter and header auth now see real data. */
const hooks = { pullEvents: vi.fn(), createEndpoint: vi.fn(), retireEndpoint: vi.fn(), eventToTrigger };
vi.mock('./agntWebhooks.js', async (orig) => ({ ...(await orig()), pullEvents: (...a) => hooks.pullEvents(...a) }));
vi.mock('../models/WebhookModel.js', () => ({ default: { saveCursor: vi.fn(async () => ({})), attachEndpoint: vi.fn(), findByWorkflowId: vi.fn(async () => null), loadAll: vi.fn(async () => []), create: vi.fn(), deleteByWorkflowId: vi.fn(), findOwnerId: vi.fn() } }));
vi.mock('../models/WorkflowModel.js', () => ({ default: { findByStatusBatch: vi.fn(async () => []) } }));

describe('WebhookReceiver with hosted request envelopes', () => {
  // Polling enabled so pollForTriggers runs; the constructor starts no interval (see startPolling), the test drives each poll.
  beforeEach(() => { hooks.pullEvents.mockReset(); process.env.IS_WORKFLOW_PROCESS = 'true'; delete process.env.AGNT_DISABLE_EXTERNAL_POLLING; });

  async function receiverWith(config) {
    const { default: Receiver } = await import('../tools/triggers/WebhookReceiver.js');
    const engine = { isListening: true, processWorkflowTrigger: vi.fn(async () => ({})) };
    const receiver = new Receiver({ activeWorkflows: new Map([['wf', engine]]) });
    receiver.webhooks.set('wf', { endpointId: 'ep', since: 0, workflowId: 'wf', ...config });
    return { receiver, engine };
  }
  const event = (id, t, method, headers = {}) => ({ id, receivedAt: t, method, headers, query: 'k=v', body: '', contentType: null });

  it('fires only the configured method, with the query intact', async () => {
    const { receiver, engine } = await receiverWith({ method: 'GET' });
    hooks.pullEvents.mockResolvedValueOnce([event('a', 1, 'POST'), event('b', 2, 'GET')]);
    await receiver.pollForTriggers();
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(engine.processWorkflowTrigger.mock.calls[0][0]).toMatchObject({ id: 'b', method: 'GET', query: { k: 'v' } });
  });

  it('accepts a correct Bearer token and refuses a wrong or missing one', async () => {
    const { receiver, engine } = await receiverWith({ method: 'POST', authType: 'Bearer', authToken: 's3cret' });
    hooks.pullEvents.mockResolvedValueOnce([
      event('ok', 1, 'POST', { Authorization: 'Bearer s3cret' }),
      event('wrong', 2, 'POST', { authorization: 'Bearer nope' }),
      event('none', 3, 'POST'),
      event('xhdr', 4, 'POST', { 'X-Webhook-Token': 'Bearer s3cret' }),
    ]);
    await receiver.pollForTriggers();
    expect(engine.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['ok', 'xhdr']);
  });

  it('accepts correct Basic credentials', async () => {
    const { receiver, engine } = await receiverWith({ method: 'PUT', authType: 'Basic', username: 'u', password: 'p:w' });
    const basic = 'Basic ' + Buffer.from('u:p:w').toString('base64');
    hooks.pullEvents.mockResolvedValueOnce([event('ok', 1, 'PUT', { authorization: basic }), event('bad', 2, 'PUT', { authorization: 'Basic ' + Buffer.from('u:x').toString('base64') })]);
    await receiver.pollForTriggers();
    expect(engine.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['ok']);
  });
});
