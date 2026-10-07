import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * One workflow, one hosted endpoint. Overlapping register calls used to both
 * create an endpoint; the row kept one and the other leaked, still answering
 * senders 202 after the workflow was deleted (charlie, 2026-10-07).
 */
const hooks = {
  createEndpoint: vi.fn(),
  retireEndpointsFor: vi.fn(async () => 1),
  pullEvents: vi.fn(async () => []),
  eventToTrigger: (e) => e,
};
vi.mock('../../services/agntWebhooks.js', () => hooks);
vi.mock('../../services/legacyRelay.js', () => ({ legacyWebhooks: { url: (id) => 'https://api.agnt.gg/webhook/' + id, register: async () => ({}), unregister: async () => ({}), poll: async () => [], confirm: async () => ({}), release: async () => ({}) } }));
vi.mock('../../services/agntServices.js', async (orig) => ({ ...(await orig()), serverNow: () => 1000, serviceFailure: (e) => ({ success: false, error: e.code || e.message }) }));

// A tiny in-memory webhooks table, so a second registration sees the first's row.
let rows;
const model = {
  findByWorkflowId: vi.fn(async (id) => rows.get(id) || null),
  create: vi.fn(async (row) => { rows.set(row.workflow_id, { ...row, cursor: null }); }),
  attachEndpoint: vi.fn(async () => ({ updated: true })),
  saveCursor: vi.fn(async (id, cursor) => { const r = rows.get(id); if (r) r.cursor = cursor; }),
  deleteByWorkflowId: vi.fn(async (id) => { rows.delete(id); }),
  findOwnerId: vi.fn(async (id) => rows.get(id)?.user_id || null),
  loadAll: vi.fn(async () => []),
};
vi.mock('../../models/WebhookModel.js', () => ({ default: model }));
vi.mock('../../models/WorkflowModel.js', () => ({ default: { findByStatusBatch: vi.fn(async () => []) } }));

const deferred = () => { let resolve; const promise = new Promise((r) => (resolve = r)); return { promise, resolve }; };

describe('WebhookReceiver: one endpoint per workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = new Map();
    process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
  });

  it('two overlapping registrations create ONE endpoint and one row, and agree on the URL', async () => {
    const { default: Receiver } = await import('./WebhookReceiver.js');
    const receiver = new Receiver({ activeWorkflows: new Map() });
    const slow = deferred();
    hooks.createEndpoint.mockImplementationOnce(async () => { await slow.promise; return { id: 'ep-1', slug: 's1', url: 'https://webhooks.agnt.gg/in/s1', state: 'active' }; });
    hooks.createEndpoint.mockImplementation(async () => ({ id: 'ep-DUPLICATE', slug: 'dup', url: 'https://webhooks.agnt.gg/in/dup', state: 'active' }));

    const first = receiver.registerWebhook('wf-1', 'u1', 'POST');
    const second = receiver.registerWebhook('wf-1', 'u1', 'POST');
    slow.resolve();
    const [a, b] = await Promise.all([first, second]);

    expect(hooks.createEndpoint).toHaveBeenCalledTimes(1);
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(a).toBe('https://webhooks.agnt.gg/in/s1');
    expect(b).toBe('https://webhooks.agnt.gg/in/s1');
    expect(receiver.webhooks.get('wf-1').endpointId).toBe('ep-1');
  });

  it('a stop that overlaps a start runs after it, and retires what the start created', async () => {
    const { default: Receiver } = await import('./WebhookReceiver.js');
    const receiver = new Receiver({ activeWorkflows: new Map() });
    const slow = deferred();
    const order = [];
    hooks.createEndpoint.mockImplementationOnce(async () => { await slow.promise; order.push('created'); return { id: 'ep-2', slug: 's2', url: 'https://webhooks.agnt.gg/in/s2', state: 'active' }; });
    hooks.retireEndpointsFor.mockImplementationOnce(async (id, known) => { order.push(`retired:${known}`); return 1; });

    const start = receiver.registerWebhook('wf-2', 'u1', 'POST');
    const stop = receiver.unregisterWebhook('wf-2');
    slow.resolve();
    await Promise.all([start, stop]);

    expect(order).toEqual(['created', 'retired:ep-2']);
    expect(receiver.webhooks.has('wf-2')).toBe(false);
    expect(rows.has('wf-2')).toBe(false);
  });

  it('a failed registration does not wedge the queue for that workflow', async () => {
    const { default: Receiver } = await import('./WebhookReceiver.js');
    const receiver = new Receiver({ activeWorkflows: new Map() });
    hooks.createEndpoint.mockRejectedValueOnce(Object.assign(new Error('pro_required'), { code: 'pro_required', status: 402 }));
    hooks.createEndpoint.mockResolvedValueOnce({ id: 'ep-3', slug: 's3', url: 'https://webhooks.agnt.gg/in/s3', state: 'active' });

    await expect(receiver.registerWebhook('wf-3', 'u1', 'POST')).rejects.toThrow();
    await expect(receiver.registerWebhook('wf-3', 'u1', 'POST')).resolves.toBe('https://webhooks.agnt.gg/in/s3');
  });

  it('different workflows are not serialised behind each other', async () => {
    const { default: Receiver } = await import('./WebhookReceiver.js');
    const receiver = new Receiver({ activeWorkflows: new Map() });
    const never = deferred();
    hooks.createEndpoint.mockImplementationOnce(async () => { await never.promise; return { id: 'x', slug: 'x', url: 'u', state: 'active' }; });
    hooks.createEndpoint.mockImplementationOnce(async () => ({ id: 'ep-5', slug: 's5', url: 'https://webhooks.agnt.gg/in/s5', state: 'active' }));

    receiver.registerWebhook('wf-4', 'u1', 'POST'); // hangs on purpose
    await expect(receiver.registerWebhook('wf-5', 'u1', 'POST')).resolves.toBe('https://webhooks.agnt.gg/in/s5');
    never.resolve();
  });

  it('stopping retires every endpoint for the workflow, passing the recorded one', async () => {
    const { default: Receiver } = await import('./WebhookReceiver.js');
    const receiver = new Receiver({ activeWorkflows: new Map() });
    rows.set('wf-6', { workflow_id: 'wf-6', user_id: 'u1', endpoint_id: 'ep-6' });
    await receiver.unregisterWebhook('wf-6');
    expect(hooks.retireEndpointsFor).toHaveBeenCalledWith('wf-6', 'ep-6');
  });
});
