import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A hosted endpoint that no longer exists is replaced during the poll, once,
 * and the new URL is persisted — instead of "endpoint_not_found" every ten
 * seconds for the life of the process.
 */
const hooks = { pullEvents: vi.fn(), createEndpoint: vi.fn(), retireEndpoint: vi.fn(), eventToTrigger: (e) => e };
vi.mock('../../services/agntWebhooks.js', () => hooks);
vi.mock('../../services/agntServices.js', async (orig) => ({ ...(await orig()), serviceFailure: (e) => ({ success: false, error: e.code || e.message, code: e.code, status: e.status }) }));
const model = { attachEndpoint: vi.fn(async () => ({ updated: true })), saveCursor: vi.fn(async () => ({})), findByWorkflowId: vi.fn(async () => null), loadAll: vi.fn(async () => []), create: vi.fn(), deleteByWorkflowId: vi.fn(), findOwnerId: vi.fn() };
vi.mock('../../models/WebhookModel.js', () => ({ default: model }));
vi.mock('../../models/WorkflowModel.js', () => ({ default: { findByStatusBatch: vi.fn(async () => []) } }));

describe('WebhookReceiver replaces a dead hosted endpoint', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.IS_WORKFLOW_PROCESS = 'true'; delete process.env.AGNT_DISABLE_EXTERNAL_POLLING; });

  it('re-registers on endpoint_not_found and persists the new URL', async () => {
    const { default: Receiver } = await import('./WebhookReceiver.js');
    const engine = { isListening: true, processWorkflowTrigger: vi.fn(async () => ({ ok: true })) };
    const receiver = new Receiver({ activeWorkflows: new Map([['wf-1', engine]]) });
    receiver.webhooks.set('wf-1', { userId: 'u1', endpointId: 'dead', since: 0, workflowId: 'wf-1' });
    hooks.pullEvents.mockRejectedValueOnce(Object.assign(new Error('webhooks: endpoint_not_found'), { code: 'endpoint_not_found', status: 404 }));
    hooks.createEndpoint.mockResolvedValueOnce({ id: 'live', slug: 'abc123', url: 'https://webhooks.agnt.gg/in/abc123', state: 'active' });

    await receiver.pollForTriggers();

    expect(hooks.createEndpoint).toHaveBeenCalledWith('wf-1');
    expect(receiver.webhooks.get('wf-1').endpointId).toBe('live');
    expect(model.attachEndpoint).toHaveBeenCalledWith('wf-1', 'u1', expect.objectContaining({ endpoint_id: 'live', webhook_url: 'https://webhooks.agnt.gg/in/abc123' }));

    // Next poll uses the live endpoint and delivers normally.
    hooks.pullEvents.mockResolvedValueOnce([{ id: 'ev', receivedAt: 10, body: { hi: 1 }, headers: {}, method: 'POST' }]);
    await receiver.pollForTriggers();
    expect(hooks.pullEvents).toHaveBeenLastCalledWith('live', expect.any(Number), );
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
  });

  it('does not replace on other failures', async () => {
    const { default: Receiver } = await import('./WebhookReceiver.js');
    const receiver = new Receiver({ activeWorkflows: new Map([['wf-2', { isListening: true, processWorkflowTrigger: vi.fn() }]]) });
    receiver.webhooks.set('wf-2', { userId: 'u1', endpointId: 'ep', since: 0, workflowId: 'wf-2' });
    hooks.pullEvents.mockRejectedValueOnce(Object.assign(new Error('webhooks: pro_required'), { code: 'pro_required', status: 402 }));
    await receiver.pollForTriggers();
    expect(hooks.createEndpoint).not.toHaveBeenCalled();
    expect(receiver.webhooks.get('wf-2').endpointId).toBe('ep');
  });
});
