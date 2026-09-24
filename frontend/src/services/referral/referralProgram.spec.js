import { describe, it, expect, vi } from 'vitest';
import { claimReferral, inviteLink, shareIntents, milestoneLabel } from './referralProgram.js';

describe('inviteLink', () => {
  it('points at the invite page, and never builds one from a bad code', () => {
    expect(inviteLink('NATHAN33')).toBe('https://agnt.gg/invite/NATHAN33');
    expect(inviteLink('"><script>')).toBe('https://agnt.gg/');
    expect(inviteLink('')).toBe('https://agnt.gg/');
  });
});

describe('shareIntents', () => {
  it('encodes the link and the text into each intent', () => {
    const i = shareIntents('https://agnt.gg/s/abc', 'Try this & that');
    expect(i.x).toContain('url=https%3A%2F%2Fagnt.gg%2Fs%2Fabc');
    expect(i.x).toContain('text=Try%20this%20%26%20that');
    expect(i.linkedin).toContain('url=https%3A%2F%2Fagnt.gg%2Fs%2Fabc');
  });
});

describe('claimReferral', () => {
  const ok = () => vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));

  it('asks the API to credit the code for the signed-in account', async () => {
    const fetchImpl = ok();
    const result = await claimReferral({ code: 'ALICE', email: 'bob@x.test', token: 't', remoteUrl: 'https://api.test', fetchImpl });
    expect(result).toEqual({ claimed: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/referrals/referral');
    expect(JSON.parse(init.body)).toEqual({ referralCode: 'ALICE', newUserEmail: 'bob@x.test' });
    expect(init.headers.Authorization).toBe('Bearer t');
  });

  it('never calls out with a malformed code or without a session', async () => {
    const fetchImpl = ok();
    expect((await claimReferral({ code: '../x', email: 'a@b', token: 't', remoteUrl: 'u', fetchImpl })).claimed).toBe(false);
    expect((await claimReferral({ code: 'OK', email: '', token: 't', remoteUrl: 'u', fetchImpl })).claimed).toBe(false);
    expect((await claimReferral({ code: 'OK', email: 'a@b', token: '', remoteUrl: 'u', fetchImpl })).claimed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an already-referred account as not claimed, and never throws', async () => {
    const refused = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'User has already been referred' }) }));
    expect(await claimReferral({ code: 'OK', email: 'a@b', token: 't', remoteUrl: 'u', fetchImpl: refused })).toEqual({ claimed: false, reason: 'User has already been referred' });
    const down = vi.fn(async () => { throw new Error('offline'); });
    expect(await claimReferral({ code: 'OK', email: 'a@b', token: 't', remoteUrl: 'u', fetchImpl: down })).toEqual({ claimed: false, reason: 'network' });
  });
});

describe('milestoneLabel', () => {
  it('names each reward', () => {
    expect(milestoneLabel({ reward: 'always_on', months: 1 })).toBe('1 month of Always-On');
    expect(milestoneLabel({ reward: 'always_on', months: 3 })).toBe('3 months of Always-On');
    expect(milestoneLabel({ reward: 'founding_member' })).toBe('Founding member');
  });
});
