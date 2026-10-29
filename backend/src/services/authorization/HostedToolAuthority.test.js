import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reported on genii 2026-10-27: every member tool call (search, email, plugins)
// failed with "direct machine tools require tenant administration". Membership
// is the gate here; which tools a member may run is memberIsolation's job.
const teams = vi.fn();
const access = vi.fn();
vi.mock('../CloudTeamClient.js', () => ({
  CloudTeamClient: class { request(...args) { return teams(...args); } access(...args) { return access(...args); } },
}));
// Turn-scoped tokens (toolRunAuthority) without the signing key: 'agnt-tool.<sub>'.
vi.mock('../security/toolRunAuthority.js', () => ({
  isToolToken: (token) => typeof token === 'string' && token.startsWith('agnt-tool.'),
  verifyToolToken: (token) => { if (token.endsWith('.forged')) throw new Error('invalid signature'); return { sub: token.slice('agnt-tool.'.length) }; },
}));
const { requireHostedToolAuthority } = await import('./HostedToolAuthority.js');

describe('requireHostedToolAuthority', () => {
  beforeEach(() => {
    vi.stubEnv('AGNT_TENANT_SLUG', 'genii');
    vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
    teams.mockReset();
    access.mockReset().mockResolvedValue({ tenantSlug: 'genii' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('a plain member of the team may call tools', async () => {
    teams.mockResolvedValue([{ id: 't1', tenantSlug: 'genii', role: 'member' }]);
    await expect(requireHostedToolAuthority('member-2', 'Bearer member-token')).resolves.toBeNull();
    expect(access).toHaveBeenCalledWith('Bearer member-token', 't1');
  });

  it("returns the member's team permissions from that same check, and remembers them for text turns", async () => {
    const permissions = { 'workflows.run': true, 'code.run': false };
    teams.mockResolvedValue([{ id: 't1', tenantSlug: 'genii', role: 'member' }]);
    access.mockResolvedValue({ tenantSlug: 'genii', policy: { revision: 2, permissions } });
    await expect(requireHostedToolAuthority('amber', 'Bearer amber-token')).resolves.toEqual(permissions);
    // A text answered as Amber cannot ask the cloud; the owner's rules still apply.
    await expect(requireHostedToolAuthority('amber', 'Bearer agnt-tool.amber')).resolves.toEqual(permissions);
  });

  it('someone who is not on this instance\'s team is refused', async () => {
    teams.mockResolvedValue([{ id: 't9', tenantSlug: 'other', role: 'owner' }]);
    await expect(requireHostedToolAuthority('stranger', 'Bearer x')).rejects.toThrow(/not a member of this instance's team/);
  });

  it('the owner never needs the control plane, and a desktop install is never checked', async () => {
    await expect(requireHostedToolAuthority('owner-1', undefined)).resolves.toBeNull();
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    await expect(requireHostedToolAuthority('anyone', undefined)).resolves.toBeNull();
    expect(teams).not.toHaveBeenCalled();
  });

  it('a text answered as a teammate uses the turn token this instance minted for that same teammate', async () => {
    await expect(requireHostedToolAuthority('john', 'Bearer agnt-tool.john')).resolves.toBeNull(); // nothing known about John yet
    expect(teams).not.toHaveBeenCalled(); // the issuer cannot verify it, so it never goes there
    await expect(requireHostedToolAuthority('amber', 'Bearer agnt-tool.john')).rejects.toThrow(/does not match the caller/);
    await expect(requireHostedToolAuthority('amber', 'Bearer agnt-tool.amber.forged')).rejects.toThrow(/invalid signature/);
  });

  it('a member call with no credential is refused rather than waved through', async () => {
    await expect(requireHostedToolAuthority('member-2', undefined)).rejects.toThrow(/requires current team authority/);
  });
});
