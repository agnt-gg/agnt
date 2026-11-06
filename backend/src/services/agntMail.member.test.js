import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * One inbox per PERSON. On a hosted team instance each member's mail goes
 * through that member's own inbox, never the owner's or a teammate's, and never
 * through the legacy relay, which has no per-member identity.
 */
const callService = vi.fn();
const legacySend = vi.fn();
const member = (actor) => (actor && actor !== 'owner-1' ? actor : null);
vi.mock('./agntServices.js', () => ({
  callService: (...a) => callService(...a),
  neverReached: () => true,
  memberActor: (actor) => member(actor),
}));
vi.mock('./legacyRelay.js', () => ({ legacyMail: { send: (...a) => legacySend(...a) } }));

const inboxes = { '': { id: 'own', address: 'agent-own@mail.agnt.gg', state: 'active', created_at: 1 }, ann: { id: 'ann-box', address: 'agent-ann@mail.agnt.gg', state: 'active', created_at: 2 }, bob: { id: 'bob-box', address: 'agent-bob@mail.agnt.gg', state: 'active', created_at: 3 } };

describe('agent inbox per person', () => {
  beforeEach(async () => {
    callService.mockReset();
    legacySend.mockReset();
    callService.mockImplementation(async (service, path, opts = {}) => {
      const who = member(opts.actor) ?? '';
      if (path === '/inboxes') return { inboxes: [inboxes[who]] };
      if (path.endsWith('/messages') && opts.method === 'POST') return { id: 'sent-' + who, state: 'queued' };
      return {};
    });
    (await import('./agntMail.js')).resetInboxCache();
  });

  it('each member and the owner get their own inbox, and send from it', async () => {
    const { defaultInbox, sendMail } = await import('./agntMail.js');
    expect((await defaultInbox('ann')).id).toBe('ann-box');
    expect((await defaultInbox('bob')).id).toBe('bob-box');
    expect((await defaultInbox('owner-1')).id).toBe('own');
    expect((await defaultInbox()).id).toBe('own');
    const sent = await sendMail({ to: 'x@example.com', subject: 's', text: 't', actor: 'ann' });
    expect(sent.from).toBe('agent-ann@mail.agnt.gg');
    const post = callService.mock.calls.find(([, path, o]) => o?.method === 'POST' && path.includes('/messages'));
    expect(post[1]).toBe('/inboxes/ann-box/messages');
    expect(post[2].actor).toBe('ann');
  });

  it('caches per person: a teammate never receives another member\'s cached inbox', async () => {
    const { defaultInbox } = await import('./agntMail.js');
    await defaultInbox('ann');
    expect((await defaultInbox('bob')).id).toBe('bob-box');
    expect(callService.mock.calls.filter(([, path]) => path === '/inboxes').map(([, , o]) => o.actor)).toEqual(['ann', 'bob']);
  });

  it('a member\'s send never falls back to the shared legacy relay', async () => {
    const { sendMail } = await import('./agntMail.js');
    callService.mockImplementation(async (service, path) => { if (path === '/inboxes') return { inboxes: [inboxes.ann] }; throw Object.assign(new Error('unreachable'), { code: 'unreachable' }); });
    await expect(sendMail({ to: 'x@example.com', subject: 's', text: 't', actor: 'ann' })).rejects.toThrow();
    expect(legacySend).not.toHaveBeenCalled();
  });
});
