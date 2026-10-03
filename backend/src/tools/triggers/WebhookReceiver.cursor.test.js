import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A webhook that arrives while the process is down is delivered after restart.
 *
 * The cursor used to be saved only after the first delivered event, so an
 * endpoint that had never received one restarted at "now" on every boot. A
 * hosted instance the fleet woke to collect an event therefore skipped it: the
 * event was older than the boot. Measured on charlie, 2026-09-27.
 */
const hooks = { pullEvents: vi.fn(async () => []), createEndpoint: vi.fn(), retireEndpoint: vi.fn(), eventToTrigger: (e) => e };
vi.mock('../../services/agntWebhooks.js', () => hooks);
// The old api.agnt.gg relay is a separate source; idle here so no test reaches the network.
vi.mock('../../services/legacyRelay.js', () => ({ legacyWebhooks: { url: (id) => 'https://api.agnt.gg/webhook/' + id, register: async () => ({}), unregister: async () => ({}), poll: async () => [], confirm: async () => ({}), release: async () => ({}) } }));
// The service clock is the (faked) clock in these tests; skew is covered in WebhookReceiver.fallback.test.js.
vi.mock('../../services/agntServices.js', async (orig) => ({ ...(await orig()), serverNow: () => Date.now(), serviceFailure: (e) => ({ success: false, error: e.code || e.message, code: e.code, status: e.status }) }));
const stored = new Map(); // workflowId -> row
const model = {
  findByWorkflowId: vi.fn(async (id) => stored.get(id) ?? null),
  create: vi.fn(async (row) => { stored.set(row.workflow_id, { ...row, cursor: null }); }),
  saveCursor: vi.fn(async (id, cursor) => { const row = stored.get(id); if (row) row.cursor = Math.max(row.cursor ?? 0, cursor); }),
  attachEndpoint: vi.fn(async () => ({})), loadAll: vi.fn(async () => []), deleteByWorkflowId: vi.fn(), findOwnerId: vi.fn(),
};
vi.mock('../../models/WebhookModel.js', () => ({ default: model }));
vi.mock('../../models/WorkflowModel.js', () => ({ default: { findByStatusBatch: vi.fn(async () => []) } }));

const ENDPOINT = { id: 'ep-1', slug: 'aaaaaaaaaaaa', url: 'https://webhooks.agnt.gg/in/aaaaaaaaaaaa', state: 'active' };
async function freshReceiver(engine) {
  const { default: Receiver } = await import('./WebhookReceiver.js');
  return new Receiver({ activeWorkflows: new Map([['wf', engine]]) });
}
const listening = () => ({ isListening: true, processWorkflowTrigger: vi.fn(async () => ({ ok: true })) });

describe('WebhookReceiver keeps its starting point across restarts', () => {
  beforeEach(() => {
    stored.clear(); vi.clearAllMocks();
    process.env.IS_WORKFLOW_PROCESS = 'true'; delete process.env.AGNT_DISABLE_EXTERNAL_POLLING;
    hooks.createEndpoint.mockResolvedValue(ENDPOINT);
  });
  afterEach(() => vi.useRealTimers());

  it('an event that arrives while asleep is delivered after the restart', async () => {
    vi.useFakeTimers({ now: 1_000 });
    await (await freshReceiver(listening())).registerWebhook('wf', 'u1', 'POST', 'None');
    expect(stored.get('wf').cursor).toBe(1_000); // recorded at registration, not at first event

    // Asleep: an event arrives at 5_000. Woken at 9_000: a new process registers again.
    vi.setSystemTime(9_000);
    const engine = listening();
    const receiver = await freshReceiver(engine);
    await receiver.registerWebhook('wf', 'u1', 'POST', 'None');
    expect(receiver.webhooks.get('wf').since).toBe(1_000); // not 9_000

    hooks.pullEvents.mockResolvedValueOnce([{ id: 'while-asleep', receivedAt: 5_000, method: 'POST', headers: {}, body: {} }]);
    await receiver.pollForTriggers();
    expect(hooks.pullEvents).toHaveBeenCalledWith('ep-1', 1_000);
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
  });

  it('a stored cursor is resumed, never rewound or overwritten', async () => {
    stored.set('wf', { workflow_id: 'wf', endpoint_id: 'ep-1', slug: ENDPOINT.slug, webhook_url: ENDPOINT.url, cursor: 4_242 });
    const receiver = await freshReceiver(listening());
    await receiver.registerWebhook('wf', 'u1', 'POST', 'None');
    expect(receiver.webhooks.get('wf').since).toBe(4_242);
    expect(model.saveCursor).not.toHaveBeenCalled();
  });

  it('a replaced endpoint records its new starting point', async () => {
    vi.useFakeTimers({ now: 7_000 });
    stored.set('wf', { workflow_id: 'wf', cursor: 10 });
    const receiver = await freshReceiver(listening());
    receiver.webhooks.set('wf', { userId: 'u1', endpointId: 'dead', since: 10, workflowId: 'wf' });
    hooks.pullEvents.mockRejectedValueOnce(Object.assign(new Error('webhooks: endpoint_not_found'), { code: 'endpoint_not_found', status: 404 }));
    await receiver.pollForTriggers();
    expect(model.saveCursor).toHaveBeenCalledWith('wf', 7_000);
  });
});
