import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mail the account inbox sent itself never triggers a workflow.
 *
 * Send Email sends FROM the account inbox, and every Receive Email trigger
 * listens ON it. A workflow that replies to the sender of a message the inbox
 * sent itself therefore mails itself, sees that reply as new inbound mail, and
 * replies again — once per poll, indefinitely. On a live install this produced
 * ~90 "Re: Re: Re: …" sends in sixteen minutes.
 */
const INBOX = { id: 'inbox-1', address: 'operator-check@mail.agnt.gg' };
const listInbound = vi.fn();
vi.mock('../../services/agntMail.js', () => ({ listInbound: (...a) => listInbound(...a), releaseInboxReader: async () => true }));
vi.mock('../../services/agntServices.js', () => ({ serviceFailure: (e) => ({ error: e.message }), hostedInstanceSlug: () => null }));
vi.mock('../../models/TriggerCursorModel.js', () => ({ default: { get: async () => null, save: async () => {} } }));

function engineListeningOnBuiltInMail() {
  return {
    isListening: true,
    workflow: { nodes: [{ type: 'receive-email', parameters: { emailConfig: 'Built-in Email' } }] },
    processWorkflowTrigger: vi.fn(async () => ({})),
  };
}

describe('EmailReceiver ignores mail sent by its own inbox', () => {
  beforeEach(() => {
    listInbound.mockReset();
    process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true'; // no interval; the test drives polls
  });

  it('does not trigger on self-sent mail, in bare or display-name form, and advances past it', async () => {
    const { default: EmailReceiver } = await import('./EmailReceiver.js');
    const engine = engineListeningOnBuiltInMail();
    const receiver = new EmailReceiver({ activeWorkflows: new Map([['wf', engine]]) });
    receiver.since = 0;

    listInbound.mockResolvedValueOnce({
      inbox: INBOX,
      messages: [
        { id: 'self-bare', from: 'operator-check@mail.agnt.gg', subject: 'Re: hi', createdAt: 10 },
        { id: 'self-named', from: 'AGNT <Operator-Check@Mail.AGNT.gg>', subject: 'Re: Re: hi', createdAt: 20 },
        { id: 'external', from: 'Nathan <nathan@bizop.io>', subject: 'hello', text: 'body', createdAt: 30 },
      ],
    });

    await receiver.pollForTriggers();

    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(engine.processWorkflowTrigger.mock.calls[0][0]).toMatchObject({ id: 'external', from: 'Nathan <nathan@bizop.io>' });
    expect(receiver.since).toBe(30);
  });

  it('advances past a poll made only of self-sent mail, so it is not re-read forever', async () => {
    const { default: EmailReceiver } = await import('./EmailReceiver.js');
    const engine = engineListeningOnBuiltInMail();
    const receiver = new EmailReceiver({ activeWorkflows: new Map([['wf', engine]]) });
    receiver.since = 0;

    listInbound.mockResolvedValueOnce({
      inbox: INBOX,
      messages: [{ id: 'self', from: INBOX.address, subject: 'Re: x', createdAt: 50 }],
    });

    await receiver.pollForTriggers();

    expect(engine.processWorkflowTrigger).not.toHaveBeenCalled();
    expect(receiver.since).toBe(50);
  });
});
