import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * On a hosted team instance each member's Built-in Email workflows listen on
 * that member's own inbox. Mail to one member's inbox triggers only that
 * member's workflows, never the owner's or a teammate's.
 */
const listInbound = vi.fn();
const saved = new Map();
vi.mock('../../services/agntMail.js', () => ({ listInbound: (...a) => listInbound(...a), releaseInboxReader: async () => true }));
vi.mock('../../services/agntServices.js', () => ({
  serviceFailure: (e) => ({ error: e.message }),
  hostedInstanceSlug: () => 'genii',
  serverNow: () => 0,
  memberActor: (actor) => (actor && actor !== 'owner-1' ? actor : null),
}));
vi.mock('../../models/TriggerCursorModel.js', () => ({ default: { get: async (k) => saved.get(k) ?? null, save: async (k, v) => saved.set(k, v) } }));

const engine = (userId) => ({
  userId,
  isListening: true,
  workflow: { nodes: [{ type: 'receive-email', parameters: { emailConfig: 'Built-in Email' } }] },
  processWorkflowTrigger: vi.fn(async () => ({})),
});
const mail = (box, id, createdAt) => ({ inbox: { id: box, address: `${box}@mail.agnt.gg` }, messages: [{ id, from: 'client@example.com', to: `${box}@mail.agnt.gg`, subject: id, createdAt }] });

describe('EmailReceiver on a team instance', () => {
  beforeEach(() => {
    listInbound.mockReset();
    saved.clear();
    process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
  });

  it('polls each member\'s own inbox and delivers only to that member\'s workflows', async () => {
    const owners = engine('owner-1'), anns = engine('ann'), bobs = engine('bob');
    listInbound.mockImplementation(async ({ actor }) => (actor === 'ann' ? mail('ann', 'for-ann', 5) : actor === 'bob' ? mail('bob', 'for-bob', 6) : mail('own', 'for-owner', 7)));
    const { default: EmailReceiver } = await import('./EmailReceiver.js');
    const receiver = new EmailReceiver({ activeWorkflows: new Map([['wf-own', owners], ['wf-ann', anns], ['wf-bob', bobs]]) });
    receiver.since = 0;

    await receiver.pollForTriggers();

    expect(listInbound.mock.calls.map(([o]) => o.actor ?? null).sort()).toEqual([null, 'ann', 'bob'].sort());
    expect(anns.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['for-ann']);
    expect(bobs.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['for-bob']);
    expect(owners.processWorkflowTrigger.mock.calls.map((c) => c[0].id)).toEqual(['for-owner']);
    // Each member's read position is kept separately, so a restart resumes it.
    expect(saved.get('mail:inbound:ann')).toBe(5);
    expect(saved.get('mail:inbound:bob')).toBe(6);
  });
});
