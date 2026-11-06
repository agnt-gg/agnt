import { describe, it, expect, vi, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * my_email_inbox: an agent can only sign up for a service with its own email if
 * it knows the address and can read the verification mail that comes back.
 * Each call acts for the person the run is for (context.userId), so a team
 * member's agent sees that member's inbox, never a teammate's.
 */
const database = new sqlite3.Database(':memory:');
vi.mock('../../models/database/index.js', () => ({ default: database }));
vi.mock('../../libs/agnt2.js', () => ({ default: {} }));
vi.mock('../../tools/library/triggers/LocalEmailReceiver.js', () => ({ default: {} }));
vi.mock('node-fetch', () => ({ default: vi.fn(() => { throw new Error('Network forbidden'); }) }));

const defaultInbox = vi.fn();
const listInbound = vi.fn();
vi.mock('../agntMail.js', () => ({
  sendMail: vi.fn(),
  defaultInbox: (...a) => defaultInbox(...a),
  listInbound: (...a) => listInbound(...a),
  resetInboxCache: () => {},
}));

const { TOOLS } = await import('./tools.js');
const { TOOL_GROUPS, GROUP_TRIGGERS } = await import('./toolSelector.js');
const invoke = async (args, userId) => JSON.parse(await TOOLS.my_email_inbox.execute(args, 'fixture', { userId }));
const box = (who) => ({ id: who + '-box', address: `agent-${who}@mail.agnt.gg`, state: 'active' });

describe('my_email_inbox', () => {
  beforeEach(() => {
    defaultInbox.mockReset().mockImplementation(async (actor) => box(actor || 'owner'));
    listInbound.mockReset().mockImplementation(async ({ actor }) => ({
      inbox: box(actor),
      messages: Array.from({ length: 12 }, (_, i) => ({ from: 'noreply@service.test', subject: `code ${i}`, createdAt: 1_000 + i, text: i === 11 ? 'x'.repeat(5000) : `Your code is ${i}` })),
    }));
  });

  it("returns the acting person's own address and reads only their inbox", async () => {
    const result = await invoke({}, 'ann');
    expect(result.success).toBe(true);
    expect(result.address).toBe('agent-ann@mail.agnt.gg');
    expect(defaultInbox).toHaveBeenCalledWith('ann');
    expect(listInbound).toHaveBeenCalledWith(expect.objectContaining({ actor: 'ann' }));
  });

  it('since_minutes: 0 returns just the address, without reading mail', async () => {
    const result = await invoke({ since_minutes: 0 }, 'bob');
    expect(result).toEqual({ success: true, address: 'agent-bob@mail.agnt.gg', messages: [] });
    expect(listInbound).not.toHaveBeenCalled();
  });

  it('returns the newest messages first, within the limit, with long bodies cut', async () => {
    const result = await invoke({ limit: 3 }, 'ann');
    expect(result.messages.map((m) => m.subject)).toEqual(['code 11', 'code 10', 'code 9']);
    expect(result.messages[0].text.length).toBe(4000);
    expect(result.messages[0].receivedAt).toBe(new Date(1011).toISOString());
  });

  it('a service refusal comes back as a tool failure, not a throw', async () => {
    defaultInbox.mockRejectedValueOnce(Object.assign(new Error('mail: pro_required'), { code: 'pro_required' }));
    const result = await invoke({}, 'ann');
    expect(result.success).toBe(false);
  });

  it('loads with send_email whenever a request mentions signing up or a verification code', () => {
    expect(TOOL_GROUPS.email).toEqual(expect.arrayContaining(['send_email', 'my_email_inbox']));
    for (const text of ['sign up for an account on example.com', 'create an account there', 'grab the verification code', 'check my inbox', 'paste the OTP', 'click the magic link']) {
      expect(GROUP_TRIGGERS.email.test(text), text).toBe(true);
    }
    expect(GROUP_TRIGGERS.email.test('summarise this PDF')).toBe(false);
  });
});
