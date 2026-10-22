/**
 * The desktop verifies its licence itself (2026-10-21). Before this the only
 * check was a frontend one that returned true without verifying anything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-licence-'));
vi.mock('../../utils/PathManager.js', () => ({ default: { getDataPath: (...parts) => path.join(dataDir, ...parts) } }));
vi.mock('./sessionTokenCache.js', () => ({ getSessionToken: () => 'session-token', getSessionUserId: () => 'u1', subscribe: () => () => {} }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const axios = (await import('axios')).default;
const { verifySignedLicence, licenceSigningInput, verifiedPlan, LICENCE_PUBLIC_KEY } = await import('./licence.js');
const { hasFeature, canRunScheduledGoals, isEnforcing } = await import('./planEntitlements.js');
const { admitWorkflow, paidTriggersIn, PAID_TRIGGERS } = await import('../../workflow/workflowAdmission.js');

// A test signer: the server's exact construction, with a throwaway key.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const now = Math.floor(Date.now() / 1000);
function sign(overrides = {}, key = privateKey) {
  const license = { userId: 'u1', email: 'u1@test', planType: 'personal', planStatus: 'active', planName: 'Personal Cloud', features: { models: { enabled: true } }, rateLimits: {}, issuedAt: now, expiresAt: now + 30 * 86400, refreshBefore: now + 7 * 86400, machineId: null, minAppVersion: '1.0.0', licenseVersion: 1, ...overrides };
  return { license, signature: crypto.sign(null, Buffer.from(JSON.stringify(license, Object.keys(license).sort())), key).toString('base64') };
}

beforeEach(() => {
  fs.rmSync(path.join(dataDir, 'licences'), { recursive: true, force: true });
  axios.post.mockReset();
  delete process.env.ENFORCE_PLAN_GATES;
  delete process.env.AGNT_TENANT_SLUG;
  delete process.env.AGNT_TENANT_PLAN;
});
afterEach(() => vi.restoreAllMocks());

describe('verifySignedLicence', () => {
  it('accepts a licence signed exactly as the server signs it', () => {
    expect(verifySignedLicence(sign(), { userId: 'u1', key: publicKey })).toMatchObject({ valid: true, planType: 'personal', paid: true });
  });
  it('refuses a changed plan, another key, expiry, and another account', () => {
    const forged = sign();
    forged.license.planType = 'business';
    expect(verifySignedLicence(forged, { key: publicKey })).toEqual({ valid: false, reason: 'bad_signature' });
    expect(verifySignedLicence(sign({}, crypto.generateKeyPairSync('ed25519').privateKey), { key: publicKey }).reason).toBe('bad_signature');
    expect(verifySignedLicence(sign({ expiresAt: now - 3600 }), { key: publicKey }).reason).toBe('expired');
    expect(verifySignedLicence(sign(), { userId: 'someone-else', key: publicKey }).reason).toBe('other_user');
    expect(verifySignedLicence(null).reason).toBe('missing');
  });
  it('a lapsed subscription is free even with a paid planType', () => {
    expect(verifySignedLicence(sign({ planStatus: 'past_due' }), { key: publicKey })).toMatchObject({ valid: true, planType: 'free', paid: false });
  });
  it('the real production key is what it checks against by default (a test-key licence fails)', () => {
    expect(LICENCE_PUBLIC_KEY).toContain('MCowBQYDK2VwAyEA+1T5wZnQ9vQhD/Sd9g+Cio5lQRFffehBpoAJhDhE+yM=');
    expect(verifySignedLicence(sign()).reason).toBe('bad_signature');
  });
  it('signs only top-level fields: nested contents are not covered, so they are never trusted', () => {
    expect(licenceSigningInput({ b: 1, a: { secret: 2 } })).toBe('{"a":{},"b":1}');
  });
});

describe('plan gates are ON and deny without proof', () => {
  it('enforcing unless explicitly switched off', () => {
    expect(isEnforcing()).toBe(true);
    process.env.ENFORCE_PLAN_GATES = 'false';
    expect(isEnforcing()).toBe(false);
  });
  it('THE HOLE: no verified licence means no paid feature (it used to mean yes)', async () => {
    axios.post.mockRejectedValue(new Error('offline'));
    expect(await hasFeature('remoteAccess', { userId: 'u1' })).toBe(false);
    expect(await canRunScheduledGoals('u1')).toBe(false);
  });
  it('an answer that does not verify is not believed', async () => {
    axios.post.mockResolvedValue({ data: sign() }); // signed with the test key, not the production one
    expect(await verifiedPlan('u1')).toBe(null);
    expect(await hasFeature('remoteAccess', { userId: 'u1' })).toBe(false);
  });
  it('a hosted instance takes its plan from the fleet', async () => {
    process.env.AGNT_TENANT_SLUG = 'acme';
    process.env.AGNT_TENANT_PLAN = 'always_on';
    expect(await hasFeature('remoteAccess', { userId: 'u1' })).toBe(true);
  });
});

describe('workflow admission: paid triggers', () => {
  const webhookFlow = { nodes: [{ type: 'webhook-listener' }, { type: 'send-email' }] };
  it('the webhook and email triggers are the paid ones, read from the library flag', () => {
    expect([...PAID_TRIGGERS].sort()).toEqual(['receive-email', 'webhook-listener']);
    expect(paidTriggersIn(webhookFlow)).toEqual(['webhook-listener']);
    expect(paidTriggersIn({ nodes: [{ type: 'trigger-timer', parameters: { schedule: 'Daily' } }] })).toEqual([]);
  });
  it('switching on: refused without a paid plan, allowed with one', async () => {
    const refused = await admitWorkflow(webhookFlow, 'u1', { hasPaidPlan: async () => false });
    expect(refused).toMatchObject({ ok: false, code: 'PLAN_REQUIRED', triggers: ['webhook-listener'] });
    expect(await admitWorkflow(webhookFlow, 'u1', { hasPaidPlan: async () => true })).toEqual({ ok: true });
    // A daily timer is within the free limits (planLimits.test.js covers the limits).
    expect(await admitWorkflow({ nodes: [{ type: 'trigger-timer', parameters: { schedule: 'Daily' } }] }, 'u1', { hasPaidPlan: async () => false, hasLicence: () => true, inGrace: () => false })).toEqual({ ok: true });
  });
  it('restore: a known free licence stops it; no licence yet restores it pending (checked at login)', async () => {
    expect(await admitWorkflow(webhookFlow, 'u1', { restore: true, hasPaidPlan: async () => false, hasLicence: () => true })).toMatchObject({ ok: false });
    expect(await admitWorkflow(webhookFlow, 'u1', { restore: true, hasPaidPlan: async () => false, hasLicence: () => false })).toEqual({ ok: true, pending: true });
    // Switching on never gets the pending pass.
    expect(await admitWorkflow(webhookFlow, 'u1', { hasPaidPlan: async () => false, hasLicence: () => false })).toMatchObject({ ok: false });
  });
});

describe('at login, a free licence switches off paid-trigger workflows', async () => {
  const { stopPaidTriggerWorkflows } = await import('./licenceEnforcer.js');
  it('only that account, only workflows with paid triggers', async () => {
    const rows = [
      { id: 'w1', user_id: 'u1', workflow_data: JSON.stringify({ nodes: [{ type: 'receive-email' }] }) },
      { id: 'w2', user_id: 'u1', workflow_data: JSON.stringify({ nodes: [{ type: 'trigger-timer' }] }) },
      { id: 'w3', user_id: 'u2', workflow_data: JSON.stringify({ nodes: [{ type: 'webhook-listener' }] }) },
    ];
    const deactivate = vi.fn(async () => {});
    const stopped = await stopPaidTriggerWorkflows('u1', { listActive: async () => rows, deactivate });
    expect(stopped).toEqual([{ id: 'w1', triggers: ['receive-email'] }]);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(deactivate).toHaveBeenCalledWith('w1', 'u1');
  });
});
