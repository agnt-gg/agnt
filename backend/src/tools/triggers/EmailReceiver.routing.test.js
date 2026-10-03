import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Each Built-in Email workflow receives only mail sent to its own subaddress
 * (inbox+wf-<id>@...). Before this, every workflow on the account fired on
 * every message the account inbox received.
 */
const INBOX = { id: 'inbox-1', address: 'operator-check@mail.agnt.gg' };
const listInbound = vi.fn();
vi.mock('../../services/agntMail.js', () => ({ listInbound: (...a) => listInbound(...a), releaseInboxReader: async () => true }));
vi.mock('../../services/agntServices.js', () => ({ serviceFailure: (e) => ({ error: e.message }), hostedInstanceSlug: () => null, serverNow: () => Date.now() }));
vi.mock('../../models/TriggerCursorModel.js', () => ({ default: { get: async () => null, save: async () => {} } }));

const engine = () => ({
  isListening: true,
  workflow: { nodes: [{ type: 'receive-email', parameters: { emailConfig: 'Built-in Email' } }] },
  processWorkflowTrigger: vi.fn(async () => ({})),
});
const to = (id) => `operator-check+wf-${id}@mail.agnt.gg`;

async function receiverWith(engines) {
  const { default: EmailReceiver } = await import('./EmailReceiver.js');
  const receiver = new EmailReceiver({ activeWorkflows: new Map(Object.entries(engines)) });
  receiver.since = 0;
  return receiver;
}

describe('EmailReceiver routes by subaddress', () => {
  beforeEach(() => {
    listInbound.mockReset();
    process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
  });

  it('a tagged message reaches only its workflow; a bare one reaches every listener', async () => {
    const a = engine();
    const b = engine();
    const receiver = await receiverWith({ 'wf-a': a, 'wf-b': b });
    listInbound.mockResolvedValueOnce({
      inbox: INBOX,
      messages: [
        { id: 'm1', from: 'x@example.com', deliveredTo: to('wf-a'), subject: 'for a', createdAt: 10 },
        { id: 'm2', from: 'x@example.com', deliveredTo: '', to: INBOX.address, subject: 'for all', createdAt: 20 },
      ],
    });

    await receiver.pollForTriggers();

    expect(a.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['m1', 'm2']);
    expect(b.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['m2']);
    expect(a.processWorkflowTrigger.mock.calls[0][0].to).toBe(to('wf-a'));
    expect(receiver.since).toBe(20);
  });

  it('mail for a stopped workflow is skipped after boot grace, without blocking later mail', async () => {
    const a = engine();
    const receiver = await receiverWith({ 'wf-a': a });
    receiver.bootedAt = Date.now() - 10 * 60 * 1000;
    listInbound.mockResolvedValueOnce({
      inbox: INBOX,
      messages: [
        { id: 'stopped', from: 'x@example.com', deliveredTo: to('wf-gone'), createdAt: 10 },
        { id: 'live', from: 'x@example.com', deliveredTo: to('wf-a'), createdAt: 20 },
      ],
    });

    await receiver.pollForTriggers();

    expect(a.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['live']);
    expect(receiver.since).toBe(20);
  });

  it('just after boot, mail for a workflow that is not up yet holds the cursor', async () => {
    const a = engine();
    const receiver = await receiverWith({ 'wf-a': a });
    listInbound.mockResolvedValueOnce({ inbox: INBOX, messages: [{ id: 'early', from: 'x@example.com', deliveredTo: to('wf-starting'), createdAt: 10 }] });

    await receiver.pollForTriggers();

    expect(a.processWorkflowTrigger).not.toHaveBeenCalled();
    expect(receiver.since).toBe(0);
  });
});
