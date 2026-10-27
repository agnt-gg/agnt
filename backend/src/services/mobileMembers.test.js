import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { textingMember, visiblePhones, assertOwnPhone } from './mobileMembers.js';

// Reported 2026-10-27 (GeniiNow): a teammate linking their phone on the team
// instance created it on the owner's account with no owner of its own, and
// every teammate's card listed (and could unlink) everyone's phones.
describe('Text Annie on a team instance: whose phone is it', () => {
  beforeEach(() => {
    vi.stubEnv('AGNT_TENANT_SLUG', 'genii');
    vi.stubEnv('AGNT_TENANT_OWNER', 'david');
    vi.stubEnv('AGNT_TENANT_MEMBERS', 'david,amber,john');
  });
  afterEach(() => vi.unstubAllEnvs());

  const phones = [
    { id: 'p-david', memberId: null },
    { id: 'p-amber', memberId: 'amber' },
    { id: 'p-john', memberId: 'john' },
  ];

  it('a teammate is identified; the owner and a desktop install are not', () => {
    expect(textingMember({ user: { id: 'amber' } })).toBe('amber');
    expect(textingMember({ user: { userId: 'john' } })).toBe('john');
    expect(textingMember({ user: { id: 'david' } })).toBeNull();
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    expect(textingMember({ user: { id: 'amber' } })).toBeNull();
  });

  it('a teammate sees only their own phones; the owner sees every phone on the account', () => {
    expect(visiblePhones(phones, 'amber').map((p) => p.id)).toEqual(['p-amber']);
    expect(visiblePhones(phones, null).map((p) => p.id)).toEqual(['p-david', 'p-amber', 'p-john']);
    expect(visiblePhones(undefined, 'amber')).toEqual([]);
  });

  it('a teammate cannot act on someone else\'s phone, and is told it does not exist', async () => {
    const list = async () => phones;
    await expect(assertOwnPhone('p-amber', 'amber', list)).resolves.toBeUndefined();
    await expect(assertOwnPhone('p-david', 'amber', list)).rejects.toMatchObject({ status: 404, code: 'phone_not_found' });
    await expect(assertOwnPhone('p-john', 'amber', list)).rejects.toMatchObject({ status: 404 });
    // The owner manages every phone, and is never looked up.
    const never = vi.fn();
    await expect(assertOwnPhone('p-john', null, never)).resolves.toBeUndefined();
    expect(never).not.toHaveBeenCalled();
  });
});
