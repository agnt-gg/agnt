/**
 * The referral free month on the desktop: a licence signed `planType: 'trial'`.
 *
 * It lifts the free plan's LOCAL limits and nothing that costs AGNT money.
 * These pin the two places that decide that from the licence itself: what a
 * verified licence says (licence.js) and what happens at login when the
 * licence arrives (licenceEnforcer.js), including the day the trial ends.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';

const fetchLicence = vi.fn();
vi.mock('./licence.js', async (importOriginal) => ({ ...(await importOriginal()), fetchLicence }));
vi.mock('./sessionTokenCache.js', () => ({ subscribe: () => () => {}, getSessionToken: () => null, getSessionUserId: () => null }));

const { verifySignedLicence, licenceSigningInput, PAID_PLANS, LOCAL_PLANS, TRIAL_PLAN } = await import('./licence.js');
const { enforceForAccount } = await import('./licenceEnforcer.js');

afterEach(() => fetchLicence.mockReset());

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
function sign(license) {
  return { license, signature: crypto.sign(null, Buffer.from(licenceSigningInput(license)), privateKey).toString('base64') };
}
const nowS = () => Math.floor(Date.now() / 1000);

describe('a verified trial licence', () => {
  it('is not paid, and lifts the local limits', () => {
    const verdict = verifySignedLicence(sign({ userId: 'u1', planType: 'trial', planStatus: 'active', expiresAt: nowS() + 3600 }), { userId: 'u1', key: publicKey });
    expect(verdict).toMatchObject({ valid: true, planType: 'trial', paid: false, liftsLimits: true });
  });
  it('a free licence lifts nothing; a paid one is paid and lifts', () => {
    const free = verifySignedLicence(sign({ userId: 'u1', planType: 'free', planStatus: 'active', expiresAt: nowS() + 3600 }), { userId: 'u1', key: publicKey });
    expect(free).toMatchObject({ paid: false, liftsLimits: false });
    const paid = verifySignedLicence(sign({ userId: 'u1', planType: 'personal', planStatus: 'active', expiresAt: nowS() + 3600 }), { userId: 'u1', key: publicKey });
    expect(paid).toMatchObject({ paid: true, liftsLimits: true });
  });
  it('an expired trial licence (the server caps it at the trial end) proves nothing', () => {
    const verdict = verifySignedLicence(sign({ userId: 'u1', planType: 'trial', planStatus: 'active', expiresAt: nowS() - 3600 }), { userId: 'u1', key: publicKey });
    expect(verdict).toMatchObject({ valid: false, reason: 'expired' });
  });
  it('trial is never in the paid set', () => {
    expect(PAID_PLANS.has(TRIAL_PLAN)).toBe(false);
    expect(LOCAL_PLANS.has(TRIAL_PLAN)).toBe(true);
    for (const plan of PAID_PLANS) expect(LOCAL_PLANS.has(plan), plan).toBe(true);
  });
});

const timer = (schedule) => JSON.stringify({ nodes: [{ type: 'trigger-timer', category: 'trigger', parameters: { schedule } }] });
const live = [
  { id: 'hook', user_id: 'u1', updated_at: '2026-11-01', workflow_data: JSON.stringify({ nodes: [{ type: 'webhook-listener', category: 'trigger' }] }) },
  { id: 'fast', user_id: 'u1', updated_at: '2026-10-30', workflow_data: timer('Every Minute') },
  { id: 'a', user_id: 'u1', updated_at: '2026-10-29', workflow_data: timer('Daily') },
  { id: 'b', user_id: 'u1', updated_at: '2026-10-28', workflow_data: timer('Daily') },
  { id: 'c', user_id: 'u1', updated_at: '2026-10-27', workflow_data: timer('Daily') },
];

/** A workflow process double: a deactivated workflow stops being live. */
function runningWorkflows() {
  const stopped = new Set();
  return {
    stopped,
    deps: {
      listActive: async () => live.filter((row) => !stopped.has(row.id)),
      deactivate: async (id) => { stopped.add(id); },
      inGrace: () => false,
    },
  };
}

describe('at login', () => {
  it('a trial keeps its local automations and loses only paid triggers', async () => {
    fetchLicence.mockResolvedValue({ valid: true, planType: 'trial', paid: false, liftsLimits: true });
    const workflows = runningWorkflows();
    await enforceForAccount('u1', workflows.deps);
    expect([...workflows.stopped]).toEqual(['hook']);
  });
  it('when the trial ends (the licence comes back free) the free limits apply again', async () => {
    fetchLicence.mockResolvedValue({ valid: true, planType: 'free', paid: false, liftsLimits: false });
    const workflows = runningWorkflows();
    await enforceForAccount('u1', workflows.deps);
    const stopped = [...workflows.stopped];
    expect(stopped).toContain('hook');
    expect(stopped).toContain('fast');
    // The newest two automations under the free rules are kept.
    expect(stopped).not.toContain('a');
    expect(stopped).not.toContain('b');
  });
});
