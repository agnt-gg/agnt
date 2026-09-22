import { describe, it, expect, vi } from 'vitest';
import { CAPABILITIES, ROLE_CAPABILITIES, effectiveCapabilities, syncProjectAccess } from './TeamAccess.js';

describe('team roles', () => {
  it('maps each role to a baseline the cloud understands', () => {
    for (const set of Object.values(ROLE_CAPABILITIES)) for (const capability of set) expect(CAPABILITIES).toContain(capability);
    expect(ROLE_CAPABILITIES.member).not.toContain('access.manage');
    expect(ROLE_CAPABILITIES.viewer).toEqual(['resources.read', 'files.read', 'runs.read']);
  });

  it('applies overrides on top of the role, ignoring unknown capabilities and unknown roles', () => {
    const result = effectiveCapabilities('viewer', [{ capability: 'resources.write', granted: true }, { capability: 'runs.read', granted: false }, { capability: 'root', granted: true }]);
    expect([...result].sort()).toEqual(['files.read', 'resources.read', 'resources.write']);
    expect(effectiveCapabilities('stranger').size).toBe(0);
  });

  it('never lets an override lock the owner out', () => {
    expect(effectiveCapabilities('owner', [{ capability: 'access.manage', granted: false }]).has('access.manage')).toBe(true);
  });
});

describe('syncProjectAccess', () => {
  it('writes the exact target set per member and keeps going past one failure', async () => {
    const calls = [];
    const cloud = { request: vi.fn(async (_auth, path, options) => { calls.push(options.method + ' ' + path); if (path.includes('/members/ghost/')) throw Object.assign(new Error('No seat'), { status: 403 }); return {}; }) };
    const result = await syncProjectAccess({ cloud, authorization: 'Bearer x', team: { id: 't', tenantSlug: 's' }, workspaceIds: ['p'], members: [{ user_id: 'v', role: 'viewer' }, { user_id: 'ghost', role: 'member' }], overridesFor: async () => [] });
    const viewer = calls.filter(call => call.includes('/members/v/'));
    expect(viewer).toHaveLength(CAPABILITIES.length);
    expect(viewer.filter(call => call.startsWith('PUT')).map(call => call.split('/').at(-1)).sort()).toEqual(['files.read', 'resources.read', 'runs.read']);
    expect(result.failures).toHaveLength(CAPABILITIES.length);
    expect(result.failures.every(failure => failure.userId === 'ghost')).toBe(true);
  });
});
