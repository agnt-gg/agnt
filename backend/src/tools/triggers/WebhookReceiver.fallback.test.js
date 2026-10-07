import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The old api.agnt.gg/webhook/<id> URL keeps delivering alongside
 * webhooks.agnt.gg, and neither source failing stops the other.
 */
const hooks = { pullEvents: vi.fn(async () => []), createEndpoint: vi.fn(), retireEndpointsFor: vi.fn(async () => 1), eventToTrigger: (e) => e };
vi.mock('../../services/agntWebhooks.js', () => hooks);
const legacy = {
  url: (id) => 'https://api.agnt.gg/webhook/' + id,
  register: vi.fn(async () => ({ success: true })),
  unregister: vi.fn(async () => ({ success: true })),
  poll: vi.fn(async () => []),
  confirm: vi.fn(async () => ({})),
  release: vi.fn(async () => ({})),
};
vi.mock('../../services/legacyRelay.js', () => ({ legacyWebhooks: legacy }));
const model = { attachEndpoint: vi.fn(async () => ({})), saveCursor: vi.fn(async () => ({})), findByWorkflowId: vi.fn(async () => null), loadAll: vi.fn(async () => []), create: vi.fn(async () => ({})), deleteByWorkflowId: vi.fn(async () => ({})), findOwnerId: vi.fn(async () => 'u1') };
vi.mock('../../models/WebhookModel.js', () => ({ default: model }));
vi.mock('../../models/WorkflowModel.js', () => ({ default: { findByStatusBatch: vi.fn(async () => []) } }));

const serverClock = { now: null }; // null: use the real serverNow
vi.mock('../../services/agntServices.js', async (orig) => {
  const real = await orig();
  return { ...real, serverNow: () => (serverClock.now ?? real.serverNow()) };
});
const { ServiceError } = await import('../../services/agntServices.js');
const listening = () => ({ isListening: true, processWorkflowTrigger: vi.fn(async () => ({ status: 200 })) });

async function receiverWith(engines) {
  const { default: Receiver } = await import('./WebhookReceiver.js');
  return new Receiver({ activeWorkflows: new Map(Object.entries(engines)) });
}

describe('WebhookReceiver: hosted and legacy, side by side', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.IS_WORKFLOW_PROCESS = 'true';
    delete process.env.AGNT_DISABLE_EXTERNAL_POLLING;
    hooks.pullEvents.mockResolvedValue([]);
    legacy.poll.mockResolvedValue([]);
  });

  it('registration registers the old URL too and returns the hosted one', async () => {
    const receiver = await receiverWith({});
    hooks.createEndpoint.mockResolvedValueOnce({ id: 'ep', slug: 's', url: 'https://webhooks.agnt.gg/in/s' });
    const url = await receiver.registerWebhook('wf-1', 'u1', 'POST', 'bearer', 'tok');
    expect(url).toBe('https://webhooks.agnt.gg/in/s');
    expect(legacy.register).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1', method: 'POST', authType: 'bearer', authToken: 'tok' }));
    receiver.stopPolling();
  });

  it('hosted unreachable at start: runs on the old URL instead of failing the workflow', async () => {
    const receiver = await receiverWith({});
    hooks.createEndpoint.mockRejectedValueOnce(new ServiceError('webhooks', 0, 'unreachable', { causeCode: 'ECONNREFUSED' }));
    const url = await receiver.registerWebhook('wf-1', 'u1', 'POST');
    expect(url).toBe('https://api.agnt.gg/webhook/wf-1');
    expect(receiver.webhooks.get('wf-1').endpointId).toBeNull();
    receiver.stopPolling();
  });

  it('a plan refusal from hosted still fails the workflow with the plan message', async () => {
    const receiver = await receiverWith({});
    hooks.createEndpoint.mockRejectedValueOnce(new ServiceError('webhooks', 402, 'pro_required', { message: 'Included with AGNT Pro' }));
    await expect(receiver.registerWebhook('wf-1', 'u1', 'POST')).rejects.toThrow(/Pro/);
  });

  it('a legacy event is delivered and confirmed while hosted is down', async () => {
    const engine = listening();
    const receiver = await receiverWith({ 'wf-1': engine });
    receiver.webhooks.set('wf-1', { workflowId: 'wf-1', endpointId: 'ep', since: 0 });
    hooks.pullEvents.mockRejectedValueOnce(new ServiceError('webhooks', 0, 'unreachable', {}));
    legacy.poll.mockResolvedValueOnce([{ id: 't1', workflowId: 'wf-1', triggerData: { type: 'webhook', method: 'post', headers: {}, body: { a: 1 }, query: {} } }]);

    await receiver.pollForTriggers();

    expect(legacy.poll).toHaveBeenCalledWith(['wf-1']);
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(engine.processWorkflowTrigger.mock.calls[0][0]).toMatchObject({ method: 'POST', body: { a: 1 } });
    expect(legacy.confirm).toHaveBeenCalledWith(['t1']);
    expect(legacy.release).not.toHaveBeenCalled();
  });

  it('a hosted event is delivered while the legacy relay is down', async () => {
    const engine = listening();
    const receiver = await receiverWith({ 'wf-1': engine });
    receiver.webhooks.set('wf-1', { workflowId: 'wf-1', endpointId: 'ep', since: 0 });
    legacy.poll.mockRejectedValueOnce(Object.assign(new Error('legacy webhooks: retired'), { code: 'retired' }));
    hooks.pullEvents.mockResolvedValueOnce([{ id: 'e1', receivedAt: 5, method: 'POST', headers: {}, body: { b: 2 } }]);

    await receiver.pollForTriggers();

    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(receiver.webhooks.get('wf-1').since).toBe(5);
  });

  it('a legacy event whose workflow is not ready is released, not confirmed', async () => {
    const engine = listening();
    engine.processWorkflowTrigger.mockResolvedValueOnce(null);
    const receiver = await receiverWith({ 'wf-1': engine });
    receiver.webhooks.set('wf-1', { workflowId: 'wf-1', endpointId: null, since: 0 });
    vi.spyOn(receiver, '_triggerWorkflow').mockResolvedValueOnce(null);
    legacy.poll.mockResolvedValueOnce([{ id: 't2', workflowId: 'wf-1', triggerData: { method: 'POST', headers: {}, body: {} } }]);

    await receiver.pollForTriggers();

    expect(legacy.release).toHaveBeenCalledWith(['t2']);
    expect(legacy.confirm).not.toHaveBeenCalled();
  });

  it('a new endpoint starts reading from the SERVICE clock, so a fast local clock skips nothing', async () => {
    // Measured: this desktop runs ahead of webhooks.agnt.gg, so an event posted
    // right after activation carried a receivedAt earlier than local now.
    serverClock.now = Date.now() - 10 * 60_000; // service is 10 minutes behind
    try {
      const engine = listening();
      const receiver = await receiverWith({ 'wf-1': engine });
      hooks.createEndpoint.mockResolvedValueOnce({ id: 'ep', slug: 's', url: 'https://webhooks.agnt.gg/in/s', state: 'active' });
      await receiver.registerWebhook('wf-1', 'u1', 'POST');
      expect(receiver.webhooks.get('wf-1').since).toBe(serverClock.now);

      // An event stamped one second later by the service is delivered.
      hooks.pullEvents.mockImplementationOnce(async (_id, since) => [{ id: 'e', receivedAt: since + 1000, method: 'POST', headers: {}, body: {} }].filter((e) => e.receivedAt > since));
      await receiver.pollForTriggers();
      expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
      receiver.stopPolling();
    } finally {
      serverClock.now = null;
    }
  });

  it('unregistering stops both URLs', async () => {
    const receiver = await receiverWith({});
    receiver.webhooks.set('wf-1', { workflowId: 'wf-1', endpointId: 'ep', userId: 'u1' });
    await receiver.unregisterWebhook('wf-1');
    expect(legacy.unregister).toHaveBeenCalledWith('wf-1');
    expect(hooks.retireEndpointsFor).toHaveBeenCalledWith('wf-1', 'ep');
  });
});
