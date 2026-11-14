import { describe, it, expect, vi } from 'vitest';
import {
  claimReferral,
  fetchReferralProfile,
  inviteLink,
  inviteTrialState,
  shareIntents,
  FRIEND_OFFER,
  INVITE_SHARE_TEXT,
  INVITE_TERMS,
} from './referralProgram.js';

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

describe('FRIEND_OFFER', () => {
  it('offers the 30-day trial, never free cloud', () => {
    expect(FRIEND_OFFER).toMatch(/30 days of AGNT Pro/);
    expect(FRIEND_OFFER).not.toMatch(/Cloud/i);
  });

  it('is what every share prefills, and the invite terms promise no more than it', () => {
    expect(INVITE_SHARE_TEXT).toBe(`I build with AGNT, the agent operating system. ${FRIEND_OFFER}`);
    expect(INVITE_TERMS).toMatch(/30 days of AGNT Pro free/);
    expect(INVITE_TERMS).not.toMatch(/Cloud/i);
  });
});

describe('fetchReferralProfile', () => {
  const answering = (status, body) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  let n = 0;
  const fresh = () => `user${(n += 1)}@x.test`;

  it("reads the account's own record with its token: its code, and whether someone invited it", async () => {
    const email = fresh();
    const fetchImpl = answering(200, { email, referral_code: 'MAYA', referred_by: 'friend@x.test', pseudonym: 'maya' });
    expect(await fetchReferralProfile({ email, token: 't', remoteUrl: 'https://api.test', fetchImpl })).toEqual({ code: 'MAYA', invited: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.test/referrals/user/${encodeURIComponent(email)}`);
    expect(init.headers.Authorization).toBe('Bearer t');
  });

  it('never passes on a code that could not be an invite link', async () => {
    const fetchImpl = answering(200, { referral_code: '"><img src=x>', referred_by: null });
    expect(await fetchReferralProfile({ email: fresh(), token: 't', remoteUrl: 'u', fetchImpl })).toEqual({ code: null, invited: false });
  });

  it('reads no record as not invited, with nothing to share', async () => {
    expect(await fetchReferralProfile({ email: fresh(), token: 't', remoteUrl: 'u', fetchImpl: answering(404, {}) })).toEqual({ code: null, invited: false });
  });

  it('asks once per account, and again after a failure', async () => {
    const email = fresh();
    const fetchImpl = answering(200, { referral_code: 'MAYA', referred_by: null });
    await fetchReferralProfile({ email, token: 't', remoteUrl: 'u', fetchImpl });
    await fetchReferralProfile({ email: email.toUpperCase(), token: 't', remoteUrl: 'u', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = fresh();
    const down = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchReferralProfile({ email: other, token: 't', remoteUrl: 'u', fetchImpl: down })).toBeNull();
    expect(await fetchReferralProfile({ email: other, token: 't', remoteUrl: 'u', fetchImpl: answering(500, {}) })).toBeNull();
    expect(await fetchReferralProfile({ email: other, token: 't', remoteUrl: 'u', fetchImpl: answering(200, { referral_code: 'B', referred_by: 'a@x' }) })).toEqual({ code: 'B', invited: true });
    warn.mockRestore();
  });

  it('never calls out without a session', async () => {
    const fetchImpl = answering(200, {});
    expect(await fetchReferralProfile({ email: '', token: 't', remoteUrl: 'u', fetchImpl })).toBeNull();
    expect(await fetchReferralProfile({ email: fresh(), token: '', remoteUrl: 'u', fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('inviteTrialState', () => {
  it('offers the month to an invited account on the free plan', () => {
    expect(inviteTrialState({ invited: true, planType: 'free', planStatus: 'active' })).toBe('offer');
    expect(inviteTrialState({ invited: true })).toBe('offer');
  });

  it('shows a running month as started', () => {
    expect(inviteTrialState({ invited: true, planType: 'personal', planStatus: 'trialing' })).toBe('started');
    expect(inviteTrialState({ invited: true, planType: 'trial' })).toBe('started');
  });

  it('offers nothing to a paying account or to anyone not invited', () => {
    expect(inviteTrialState({ invited: true, planType: 'personal', planStatus: 'active' })).toBeNull();
    expect(inviteTrialState({ invited: false, planType: 'free' })).toBeNull();
    expect(inviteTrialState({ invited: null, planType: 'free' })).toBeNull();
    expect(inviteTrialState()).toBeNull();
  });
});
