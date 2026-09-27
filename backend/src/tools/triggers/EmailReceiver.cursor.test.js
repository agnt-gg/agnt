import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The inbox cursor survives a restart.
 *
 * It used to start at Date.now() on every boot. A hosted instance that the
 * fleet woke up *to collect mail* therefore collected nothing: everything that
 * arrived while it slept was older than "now" and was skipped for good.
 */
const INBOX = { id: 'inbox-1', address: 'me@mail.agnt.gg' };
const listInbound = vi.fn();
const store = { value: null, get: vi.fn(), save: vi.fn() };
const releaseInboxReader = vi.fn(async () => true);
const hosted = { slug: null };
vi.mock('../../services/agntMail.js', () => ({ listInbound: (...a) => listInbound(...a), releaseInboxReader: (...a) => releaseInboxReader(...a) }));
vi.mock('../../services/agntServices.js', () => ({ serviceFailure: (e) => ({ error: e.message }), hostedInstanceSlug: () => hosted.slug }));
vi.mock('../../models/TriggerCursorModel.js', () => ({ default: { get: (...a) => store.get(...a), save: (...a) => store.save(...a) } }));

const listening = () => ({
  isListening: true,
  workflow: { nodes: [{ type: 'receive-email', parameters: { emailConfig: 'Built-in Email' } }] },
  processWorkflowTrigger: vi.fn(async () => ({})),
});

async function receiverWith(engines) {
  const { default: EmailReceiver } = await import('./EmailReceiver.js');
  return new EmailReceiver({ activeWorkflows: new Map(engines) });
}

describe('EmailReceiver keeps its inbox cursor across restarts', () => {
  beforeEach(() => {
    process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
    listInbound.mockReset().mockResolvedValue({ inbox: INBOX, messages: [] });
    store.value = null;
    store.get.mockReset().mockImplementation(async () => store.value);
    store.save.mockReset().mockImplementation(async (source, cursor) => { store.value = Math.max(store.value ?? 0, cursor); });
    releaseInboxReader.mockClear();
    hosted.slug = null;
  });
  afterEach(() => vi.useRealTimers());

  it('resumes from the stored cursor, so mail that arrived while asleep is delivered', async () => {
    store.value = 1_000;
    const engine = listening();
    const receiver = await receiverWith([['wf', engine]]);
    listInbound.mockResolvedValueOnce({ inbox: INBOX, messages: [{ id: 'while-asleep', from: 'a@b.c', createdAt: 1_500 }] });

    await receiver.pollForTriggers();

    expect(listInbound).toHaveBeenCalledWith({ since: 1_000 });
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenLastCalledWith('mail:inbound', 1_500);
  });

  it('a first-ever start begins at now and records it, rather than replaying the inbox', async () => {
    vi.useFakeTimers({ now: 50_000 });
    const receiver = await receiverWith([['wf', listening()]]);
    await receiver.pollForTriggers();
    expect(listInbound).toHaveBeenCalledWith({ since: 50_000 });
    expect(store.value).toBe(50_000);
  });

  it('with nobody listening, the cursor holds during the boot grace, then moves to now', async () => {
    vi.useFakeTimers({ now: 10_000 });
    store.value = 1_000;
    const receiver = await receiverWith([]);

    vi.setSystemTime(10_000 + 60_000);
    await receiver.pollForTriggers();
    expect(receiver.since).toBe(1_000); // workflows may still be coming back up

    vi.setSystemTime(10_000 + 6 * 60_000);
    await receiver.pollForTriggers();
    expect(receiver.since).toBe(10_000 + 6 * 60_000);
    expect(store.value).toBe(10_000 + 6 * 60_000);
    expect(listInbound).not.toHaveBeenCalled(); // no listener, no request
  });

  it('a hosted instance with nothing listening releases its inbox reader once, after the grace', async () => {
    vi.useFakeTimers({ now: 10_000 });
    hosted.slug = 'charlie';
    const engines = new Map();
    const { default: EmailReceiver } = await import('./EmailReceiver.js');
    const receiver = new EmailReceiver({ activeWorkflows: engines });

    await receiver.pollForTriggers();
    expect(releaseInboxReader).not.toHaveBeenCalled(); // workflows may still be starting

    vi.setSystemTime(10_000 + 6 * 60_000);
    await receiver.pollForTriggers();
    await receiver.pollForTriggers();
    expect(releaseInboxReader).toHaveBeenCalledTimes(1); // once, not per poll

    // A listener returns (its reads re-register), then goes away again: release again.
    engines.set('wf', listening());
    await receiver.pollForTriggers();
    engines.delete('wf');
    await receiver.pollForTriggers();
    expect(releaseInboxReader).toHaveBeenCalledTimes(2);
  });

  it('a desktop never releases (it is never counted as a reader)', async () => {
    vi.useFakeTimers({ now: 10_000 });
    const receiver = await receiverWith([]);
    vi.setSystemTime(10_000 + 6 * 60_000);
    await receiver.pollForTriggers();
    expect(releaseInboxReader).not.toHaveBeenCalled();
  });

  it('an unreadable store falls back to now and mail still flows', async () => {
    vi.useFakeTimers({ now: 70_000 });
    store.get.mockRejectedValueOnce(new Error('disk'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const receiver = await receiverWith([['wf', listening()]]);
    await receiver.pollForTriggers();
    expect(listInbound).toHaveBeenCalledWith({ since: 70_000 });
    error.mockRestore();
  });
});
