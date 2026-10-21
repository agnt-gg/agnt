/**
 * The one rule for plugin sign-ins (validate-core checkPluginSignIns).
 *
 * Reported 2026-10-21: Calendly was in the marketplace needing a sign-in that
 * existed only on its author's account, so every other user installed a
 * plugin that could never run. A plugin may only be published when anyone who
 * installs it can connect every sign-in it names: bundled in its own
 * manifest.auth, or a shared AGNT sign-in.
 */
import { describe, it, expect } from 'vitest';
import { checkPluginSignIns, neededSignIns, normalizeAuthDeclaration } from './validate-core.js';
import { normalizeAuthDeclaration as runtimeNormalize } from '../../src/plugins/pluginAuth.js';

const SHARED = ['google', 'notion', 'openweathermap', 'airtable'];
const tool = (authProvider, extra = {}) => ({ type: `t-${authProvider || 'none'}`, entryPoint: './t.js', schema: { title: 'T', ...(authProvider ? { authRequired: 'apiKey', authProvider } : {}), ...extra } });
const PIPEDRIVE = { id: 'pipedrive', name: 'Pipedrive', type: 'apikey', keyLabel: 'API token', instructions: 'Settings -> API' };
const GA4 = { id: 'ga4', name: 'Google Analytics', type: 'oauth2', authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes: ['x'] };

describe('checkPluginSignIns', () => {
  it('THE REPORTED CASE: a sign-in only its author has is refused at publish, not at build', () => {
    const calendly = { name: 'calendly-plugin', tools: [tool('calendly')] };
    const result = checkPluginSignIns(calendly, { sharedIds: SHARED });
    expect(result.signIns).toEqual([{ id: 'calendly', source: 'unresolved' }]);
    expect(result.errors).toEqual([]);
    expect(result.publishErrors).toHaveLength(1);
    expect(result.publishErrors[0]).toMatch(/"calendly" sign-in.*manifest\.auth/);
  });

  it('the same plugin passes once the sign-in is shared', () => {
    const result = checkPluginSignIns({ tools: [tool('calendly')] }, { sharedIds: [...SHARED, 'calendly'] });
    expect(result).toEqual({ errors: [], publishErrors: [], warnings: [], signIns: [{ id: 'calendly', source: 'shared' }] });
  });

  it('a sign-in bundled in manifest.auth (API key or OAuth) passes', () => {
    const result = checkPluginSignIns({ auth: [PIPEDRIVE, GA4], tools: [tool('pipedrive'), tool('ga4')] }, { sharedIds: SHARED });
    expect(result.errors).toEqual([]);
    expect(result.publishErrors).toEqual([]);
    expect(result.signIns).toEqual([{ id: 'pipedrive', source: 'plugin' }, { id: 'ga4', source: 'plugin' }]);
  });

  it('a plugin with no sign-ins passes', () => {
    expect(checkPluginSignIns({ tools: [tool(null)] }, { sharedIds: SHARED })).toEqual({ errors: [], publishErrors: [], warnings: [], signIns: [] });
  });

  it('ids compare case-insensitively, once each', () => {
    const result = checkPluginSignIns({ tools: [tool('Google'), tool('GOOGLE')] }, { sharedIds: ['google'] });
    expect(result.signIns).toEqual([{ id: 'google', source: 'shared' }]);
  });

  it('an auth entry carrying a credential is refused everywhere, and the field is named, never the value', () => {
    const leaky = { ...GA4, clientSecret: 'shh-very-secret-value' };
    const result = checkPluginSignIns({ auth: [leaky], tools: [tool('ga4')] }, { sharedIds: SHARED });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/auth "ga4" carries a credential \(clientSecret\)/);
    expect(result.errors[0]).not.toContain('shh-very-secret-value');
    // The declaration itself is fine, so the tool is not ALSO reported unresolved.
    expect(result.publishErrors).toEqual([]);
  });

  it('every credential-shaped field is caught, including inside authorizationParams', () => {
    for (const field of ['client_secret', 'apiKey', 'api_key', 'password', 'accessToken', 'refresh_token', 'token', 'privateKey', 'bearer']) {
      expect(checkPluginSignIns({ auth: [{ ...PIPEDRIVE, [field]: 'x1' }] }).errors, field).toHaveLength(1);
    }
    const viaParams = checkPluginSignIns({ auth: [{ ...GA4, authorizationParams: { client_secret: 'x1', access_type: 'offline' } }] });
    expect(viaParams.errors[0]).toMatch(/authorizationParams\.client_secret/);
  });

  it('descriptions that merely mention keys or tokens are not credentials', () => {
    const result = checkPluginSignIns({ auth: [{ ...GA4, keyLabel: 'API token', tokenUrl: GA4.tokenUrl, clientId: 'public-client.apps.example.com' }, { ...PIPEDRIVE, apiKey: '' }] });
    expect(result.errors).toEqual([]);
  });

  it('redefining a shared sign-in is refused at publish (a shared id has one definition)', () => {
    const result = checkPluginSignIns({ auth: [{ ...PIPEDRIVE, id: 'airtable' }], tools: [tool('airtable')] }, { sharedIds: SHARED });
    expect(result.errors).toEqual([]);
    expect(result.publishErrors).toEqual([expect.stringMatching(/auth "airtable" redefines the shared AGNT sign-in/)]);
    expect(result.signIns).toEqual([{ id: 'airtable', source: 'shared' }]);
  });

  it('malformed and duplicate declarations are refused everywhere', () => {
    expect(checkPluginSignIns({ auth: { id: 'x' } }).errors).toEqual(['manifest.auth must be an array']);
    expect(checkPluginSignIns({ auth: [{ id: 'Bad Id!', type: 'apikey' }] }).errors[0]).toMatch(/must match/);
    expect(checkPluginSignIns({ auth: [{ id: 'x', type: 'basic' }] }).errors[0]).toMatch(/type must be/);
    expect(checkPluginSignIns({ auth: [{ ...GA4, tokenUrl: 'http://insecure' }] }).errors[0]).toMatch(/https/);
    expect(checkPluginSignIns({ auth: [PIPEDRIVE, PIPEDRIVE] }).errors).toEqual(['auth "pipedrive" is declared twice']);
  });

  it('without the shared list, nothing is guessed: ids are unknown and only warned about', () => {
    const result = checkPluginSignIns({ auth: [PIPEDRIVE], tools: [tool('pipedrive'), tool('calendly')] }, { sharedIds: null });
    expect(result.signIns).toEqual([{ id: 'pipedrive', source: 'plugin' }, { id: 'calendly', source: 'unknown' }]);
    expect(result.publishErrors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringMatching(/"calendly".*marketplace checks it again/)]);
  });

  it('reads authProvider from the schema or the tool, and tolerates odd manifests', () => {
    expect(neededSignIns({ tools: [{ authProvider: 'a' }, { schema: { authProvider: ' B ' } }, null, {}] })).toEqual(['a', 'b']);
    expect(neededSignIns(null)).toEqual([]);
    expect(checkPluginSignIns(undefined, { sharedIds: SHARED }).signIns).toEqual([]);
  });

  it('the desktop runtime reads declarations through this same function', () => {
    expect(runtimeNormalize).toBe(normalizeAuthDeclaration);
  });
});
