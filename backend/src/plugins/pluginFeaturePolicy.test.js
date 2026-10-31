import { describe, it, expect } from 'vitest';
import { pluginFeatureGrant, pluginEntryGrant, PLUGIN_FEATURES } from './pluginFeaturePolicy.js';
const report = { valid: true, trustTier: 'official', integrityState: 'verified', detected: { network: {}, filesystem: {} } };
const policy = { allowedFeatures: ['network', 'filesystem'] };
describe('capability-wide plugin grants', () => {
  it('grants the same capabilities across different plugins, with one filesystem toggle', () => {
    expect(PLUGIN_FEATURES.map(f => f.id)).toContain('filesystem');
    expect(PLUGIN_FEATURES.map(f => f.id)).not.toContain('fs-read');
    for (const name of ['first', 'second']) expect(pluginFeatureGrant(name, report, policy)).toBe('features');
  });
  it('refuses missing, revoked and unknown capabilities', () => {
    expect(pluginFeatureGrant('first', report, { allowedFeatures: ['network'] })).toBeNull();
    expect(pluginFeatureGrant('first', {...report, detected: undefined}, policy)).toBeNull();
    expect(pluginFeatureGrant('first', {...report, detected: { unknown: {} }}, policy)).toBeNull();
  });
  it('blocks take precedence over every grant', () => {
    expect(pluginFeatureGrant('first', report, {...policy, preApproved: ['first'], blockedPlugins: ['first'], membersAllOfficial: true})).toBeNull();
  });
  it('never grants unverified or invalid packages', () => {
    for (const patch of [{ valid: false }, { integrityState: 'mismatch' }, { success: false }, { trustTier: 'unaudited' }]) expect(pluginFeatureGrant('first', {...report, ...patch}, policy)).toBeNull();
  });
  it('uses the same grants for installed execution and revokes immediately on recomputation', () => {
    const entry = {name:'first',trustTier:'official',integrityState:'verified',detectedCapabilities:['filesystem','network']};
    expect(pluginEntryGrant(entry, policy)).toBe('features');
    expect(pluginEntryGrant(entry, {allowedFeatures:[]})).toBeNull();
    expect(pluginEntryGrant({...entry,scanFailed:true}, policy)).toBeNull();
  });
});
