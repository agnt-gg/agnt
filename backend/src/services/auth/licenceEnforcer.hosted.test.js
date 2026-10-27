import { describe, it, expect, vi, afterEach } from 'vitest';

const fetchLicence = vi.fn(async () => ({ valid: true, paid: false, planType: 'free' }));
vi.mock('./licence.js', async (importOriginal) => ({ ...(await importOriginal()), fetchLicence }));
vi.mock('./sessionTokenCache.js', () => ({ subscribe: () => () => {}, getSessionToken: () => null }));

const { enforceForAccount } = await import('./licenceEnforcer.js');

afterEach(() => { vi.unstubAllEnvs(); fetchLicence.mockClear(); });

const freeMembersWorkflow = { id: 'w1', user_id: 'member-2', workflow_data: JSON.stringify({ nodes: [{ type: 'receive-email' }] }) };

describe('the licence enforcer on a hosted instance', () => {
  it("uses the instance's plan, so a free member's workflows on a Business instance are left alone", async () => {
    vi.stubEnv('AGNT_TENANT_SLUG', 'genii');
    vi.stubEnv('AGNT_TENANT_PLAN', 'business');
    const deactivate = vi.fn();
    const verdict = await enforceForAccount('member-2', { listActive: async () => [freeMembersWorkflow], deactivate });
    expect(verdict).toMatchObject({ paid: true, planType: 'business', source: 'hosted' });
    expect(fetchLicence).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });

  it("still checks the person's own licence on a desktop", async () => {
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    await enforceForAccount('desktop-user', { listActive: async () => [], deactivate: vi.fn() });
    expect(fetchLicence).toHaveBeenCalledWith('desktop-user');
  });
});
