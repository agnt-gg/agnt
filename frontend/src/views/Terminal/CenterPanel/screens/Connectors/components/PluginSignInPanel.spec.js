/**
 * The Plugin Forge's Sign-in tab (reported 2026-10-21: "the plugin forge
 * should have the auth connect page in addition to overview, test & code").
 */
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'appAuth/connectedApps': ['google'] }, state: {} }) }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { REMOTE_URL: 'https://remote.test' } }));

import PluginSignInPanel from './PluginSignInPanel.vue';
import { signInRows, setToolSignIn, signInEntry, signInProblems } from './pluginDraftEditing.js';

const SHARED = [{ id: 'google', name: 'Google', connection_type: 'oauth' }, { id: 'notion', name: 'Notion', connection_type: 'oauth' }];
const tool = (type, authProvider) => ({ type, entryPoint: `./${type}.js`, schema: { title: type, ...(authProvider ? { authProvider, authRequired: 'apiKey' } : {}) } });

describe('rules', () => {
  it('classifies each sign-in the way the publish gate does', () => {
    const manifest = { auth: [{ id: 'pipedrive', name: 'Pipedrive', type: 'apikey' }], tools: [tool('a', 'pipedrive'), tool('b', 'google'), tool('c', 'calendly'), tool('d')] };
    expect(signInRows(manifest, { shared: SHARED, connectedIds: ['google'] }).map((r) => [r.id, r.source, r.connected, r.usedBy])).toEqual([
      ['pipedrive', 'plugin', false, ['a']],
      ['google', 'shared', true, ['b']],
      ['calendly', 'unresolved', false, ['c']],
    ]);
  });

  it('pointing a tool at a sign-in sets authProvider and authRequired; none clears both', () => {
    const m = { tools: [tool('a', 'old')] };
    expect(setToolSignIn(m, 'a', 'google', 'oauth').tools[0].schema).toMatchObject({ authProvider: 'google', authRequired: 'oauth' });
    const cleared = setToolSignIn(m, 'a', null).tools[0].schema;
    expect(cleared.authProvider).toBeUndefined();
    expect(cleared.authRequired).toBeUndefined();
  });

  it('a bundled entry carries no secret and drops blanks; OAuth scopes are split', () => {
    expect(signInEntry({ id: 'X', name: 'X', type: 'apikey', keyLabel: 'Token', instructions: '', helpUrl: '' })).toEqual({ id: 'x', name: 'X', type: 'apikey', keyLabel: 'Token' });
    expect(signInEntry({ id: 'ga4', name: 'GA', type: 'oauth2', authorizationUrl: 'https://a', tokenUrl: 'https://t', scopes: 'read, write' })).toMatchObject({ scopes: ['read', 'write'] });
  });

  it('refuses a shared id, a duplicate, a bad id and non-https URLs, in words', () => {
    expect(signInProblems({ id: 'google', type: 'apikey' }, { sharedIds: ['google'] })[0]).toContain('already built into AGNT');
    expect(signInProblems({ id: 'x', type: 'apikey' }, { otherIds: ['x'] })[0]).toContain('already "x"');
    expect(signInProblems({ id: 'Bad Id', type: 'apikey' })[0]).toContain('lowercase');
    expect(signInProblems({ id: 'o', type: 'oauth2', authorizationUrl: 'http://a', tokenUrl: 'https://t' })).toEqual(['The authorization URL must start with https://.']);
  });
});

describe('PluginSignInPanel', () => {
  const SelectStub = { props: ['modelValue', 'options'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>' };
  const mountPanel = (manifest, extra = {}) => mount(PluginSignInPanel, { props: { manifest, sharedSignIns: SHARED, installState: 'installed', ...extra }, global: { directives: { tooltip: {} }, stubs: { BaseSelect: SelectStub } } });

  it('a plugin with no sign-in says so', async () => {
    const w = mountPanel({ tools: [tool('a')] });
    await flushPromises();
    expect(w.find('[data-testid="signin-none"]').exists()).toBe(true);
  });

  it('THE CALENDLY CASE: a private sign-in is flagged, and "Bundle it" turns it into a bundled one', async () => {
    const w = mountPanel({ name: 'p', tools: [tool('a', 'calendly')] });
    await flushPromises();
    const row = w.find('[data-signin="calendly"]');
    expect(row.text()).toMatch(/can't be published/i);
    await row.find('button').trigger('click');
    await w.find('[data-action="save-calendly"]').trigger('click');
    const saved = w.emitted('save')[0][0];
    expect(saved.auth).toEqual([{ id: 'calendly', name: 'calendly', type: 'apikey', keyLabel: 'API key' }]);
    expect(saved.tools[0].schema).toMatchObject({ authProvider: 'calendly', authRequired: 'apiKey' });
  });

  it('picking a shared sign-in for a tool saves it with OAuth; Connect opens the account', async () => {
    const w = mountPanel({ tools: [tool('a'), tool('b', 'notion')] });
    await flushPromises();
    await w.find('[data-tool="a"] select').setValue('google');
    expect(w.emitted('save')[0][0].tools[0].schema).toMatchObject({ authProvider: 'google', authRequired: 'oauth' });
    await w.find('[data-action="connect-notion"]').trigger('click');
    expect(w.emitted('connect')[0]).toEqual(['notion']);
    // Google is already connected: no button, a check.
    const g = mountPanel({ tools: [tool('a', 'google')] });
    await flushPromises();
    expect(g.find('[data-signin="google"]').text()).toContain('Connected');
  });

  // Reported 2026-10-21: every AGNT sign-in read "(shared)", which explained nothing.
  it('labels say where a sign-in comes from; AGNT\'s own carry no suffix', async () => {
    const w = mountPanel({ auth: [{ id: 'pipedrive', name: 'Pipedrive', type: 'apikey' }], tools: [tool('a', 'calendly')] });
    await flushPromises();
    const labels = w.findAll('[data-tool="a"] option').map((o) => o.text());
    expect(labels).toEqual(['No sign-in', 'Pipedrive (this plugin)', 'Google', 'Notion', 'calendly (only on your account)']);
    expect(w.text()).not.toMatch(/shared/i);
    expect(w.find('[data-signin="pipedrive"]').text()).toContain('Comes with this plugin');
    expect(w.find('[data-signin="calendly"]').text()).toContain('Only on your account');
  });

  // Reported 2026-10-21: picking Claude Code / Codex as a tool's sign-in made the
  // tool fail CONNECTION_REQUIRED forever; subscriptions hold no token for a tool.
  it('AI models are not offered as sign-ins; a tool that names one gets a one-click fix', async () => {
    const AI = [...SHARED, { id: 'claude-code', name: 'Claude Code', categories: '["AI","Development"]' }, { id: 'openai', name: 'OpenAI', categories: ['ai'] }];
    const w = mountPanel({ tools: [tool('blog', 'claude-code'), tool('other')] }, { sharedSignIns: AI });
    await flushPromises();
    expect(w.findAll('[data-tool="other"] option').map((o) => o.text())).toEqual(['No sign-in', 'Google', 'Notion']);
    expect(w.find('[data-signin="claude-code"]').text()).toContain('An AI model, not a sign-in');
    await w.find('[data-action="use-my-ai-claude-code"]').trigger('click');
    const saved = w.emitted('save')[0][0];
    expect(saved.tools[0].schema.authProvider).toBeUndefined();
    expect(saved.tools[0].schema.authRequired).toBeUndefined();
  });

  it('a bundled sign-in can only be connected once the plugin is installed', async () => {
    const w = mountPanel({ auth: [{ id: 'pipedrive', name: 'Pipedrive', type: 'apikey' }], tools: [tool('a', 'pipedrive')] }, { installState: 'draft' });
    await flushPromises();
    expect(w.find('[data-signin="pipedrive"] button').text()).toBe('Install to connect');
    expect(w.find('[data-signin="pipedrive"] button').attributes('disabled')).toBeDefined();
  });

  it('removing a bundled sign-in also clears it from the tools that used it', async () => {
    const w = mountPanel({ auth: [{ id: 'pipedrive', name: 'Pipedrive', type: 'apikey' }], tools: [tool('a', 'pipedrive')] });
    await flushPromises();
    await w.find('[data-entry="pipedrive"] .signin-link.danger').trigger('click');
    const saved = w.emitted('save')[0][0];
    expect(saved.auth).toBeUndefined();
    expect(saved.tools[0].schema.authProvider).toBeUndefined();
  });
});
