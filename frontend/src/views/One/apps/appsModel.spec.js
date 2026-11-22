import { describe, it, expect } from 'vitest';
import {
  LISTS,
  catalogueRows,
  connectionRows,
  customAppErrors,
  customProviderData,
  customProviderId,
  formatChecked,
  groupRows,
  healthProblem,
  identityOf,
  isCustomProvider,
  isNewerVersion,
  mcpRows,
  mcpTestResult,
  pluginRows,
  randomSuffix,
  sectionOfTab,
  tabOfSection,
  teamConnectionRows,
  teamProviderOptions,
  triggerRows,
  visibleRows,
} from './appsModel.js';

const tool = (type, authProvider) => ({ type, schema: { title: type, ...(authProvider ? { authProvider } : {}) } });
const card = (providerId, extra = {}) => ({ kind: 'account', providerId, name: extra.name || providerId, icon: '', connectionType: 'oauth', status: 'ready', apps: [], suggested: [], ...extra });
const MODEL_IDS = new Set(['openai', 'anthropic', 'agnt', 'local']);

describe('sections and the route', () => {
  it('no tab and the older vault tab open Connections; the others round-trip', () => {
    expect(sectionOfTab('')).toBe('connections');
    expect(sectionOfTab(undefined)).toBe('connections');
    expect(sectionOfTab('vault')).toBe('connections');
    for (const section of ['plugins', 'mcp', 'triggers']) expect(sectionOfTab(tabOfSection(section))).toBe(section);
    expect(tabOfSection('connections')).toBe('');
  });
});

describe('connection rows', () => {
  const catalogue = [
    { id: 'github', name: 'GitHub', connection_type: 'oauth', is_global: '1' },
    { id: 'acme', name: 'Acme', connection_type: 'apikey', is_global: '0', created_by: 'someone' },
    { id: 'e2e-crm', name: 'CRM', connectionType: 'apikey', pluginProvided: true, plugin: 'crm-plugin' },
    { id: 'cursor-cli', name: 'Cursor', connectionType: 'oauth', localOnly: true },
  ];
  const health = [
    { provider: 'github', status: 'healthy', lastChecked: '2026-11-13T16:27:10.020Z', details: { login: 'agnt-gg' } },
    { provider: 'calendly', status: 'error', error: 'No valid token available' },
  ];
  const cards = {
    yours: [
      card('github', { name: 'GitHub', apps: [{ name: 'github-plugin', displayName: 'GitHub', icon: '', tools: 3 }] }),
      card('calendly', { name: 'Calendly', status: 'reconnect' }),
      card('acme', { name: 'Acme', connectionType: 'apikey' }),
      card('e2e-crm', { name: 'CRM', connectionType: 'apikey', status: 'connect' }),
      { kind: 'app', providerId: 'openai', name: 'Video', apps: [] },
    ],
    models: [card('cursor-cli', { name: 'Cursor', aiModel: true })],
  };
  const rows = connectionRows({ cards, catalogue, health, installed: [{ name: 'crm-plugin', displayName: 'CRM Suite' }] });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  it('lists account cards and connected AI models, never app cards', () => {
    expect(rows.map((row) => row.id)).toEqual(['github', 'calendly', 'acme', 'e2e-crm', 'cursor-cli']);
    expect(byId['cursor-cli'].ai).toBe(true);
    expect(byId.github.ai).toBe(false);
  });
  it('reads who is signed in and when it was checked from the health check', () => {
    expect(byId.github.identity).toBe('agnt-gg');
    expect(byId.github.checked).toBe('2026-11-13T16:27:10.020Z');
    expect(byId.github.apps).toEqual([expect.objectContaining({ name: 'github-plugin', label: 'GitHub', tools: 3 })]);
  });
  it('says why a connection stopped working, in plain words', () => {
    expect(byId.calendly.problem).toBe('The sign-in expired or was revoked');
    expect(byId.github.problem).toBe('');
  });
  it('marks custom apps, plugin sign-ins and on-this-computer sign-ins', () => {
    expect(byId.acme.custom).toBe(true);
    expect(byId.github.custom).toBe(false);
    expect(byId['e2e-crm'].fromPlugin).toBe('CRM Suite');
    expect(byId['cursor-cli'].local).toBe(true);
  });
  it('offers a test only where the health check can answer', () => {
    expect(byId.github.testable).toBe(true);
    expect(byId['e2e-crm'].testable).toBe(false);
  });
});

describe('the health check in words', () => {
  it('identity comes from the first useful detail', () => {
    expect(identityOf({ details: { email: 'someone@example.com' } })).toBe('someone@example.com');
    expect(identityOf({ details: { name: '  ' } })).toBeNull();
    expect(identityOf({})).toBeNull();
  });
  it('a lost sign-in reads as one; anything else is passed through, shortened', () => {
    expect(healthProblem('invalid_grant')).toBe('The sign-in expired or was revoked');
    expect(healthProblem('Not signed in on this machine')).toBe('Not signed in on this computer');
    expect(healthProblem('x'.repeat(200))).toHaveLength(118);
    expect(healthProblem('')).toBe('');
  });
  it('a provider is custom only when not shared and someone made it', () => {
    expect(isCustomProvider({ is_global: '0', created_by: 'a' })).toBe(true);
    expect(isCustomProvider({ is_global: 0, created_by: 'a' })).toBe(true);
    expect(isCustomProvider({ is_global: '1', created_by: 'a' })).toBe(false);
    expect(isCustomProvider({ is_global: '0' })).toBe(false);
    expect(isCustomProvider({ is_global: '0', created_by: 'a', pluginProvided: true })).toBe(false);
  });
});

describe('team connections', () => {
  it('rows carry the team provider and only GitHub can be tested', () => {
    const options = teamProviderOptions([['github', 'GitHub'], ['openai', 'OpenAI']], MODEL_IDS);
    expect(options.map((option) => [option.id, option.ai])).toEqual([['github', false], ['openai', true]]);
    const rows = teamConnectionRows([{ id: 'c1', providerId: 'github', name: 'Company GitHub' }, { id: 'c2', providerId: 'openai', name: '' }], options);
    expect(rows.map((row) => [row.id, row.name, row.appName, row.kind, row.testable])).toEqual([
      ['team:c1', 'Company GitHub', 'GitHub', 'Sign-in', true],
      ['team:c2', 'OpenAI', 'OpenAI', 'Model key', false],
    ]);
  });
});

describe('Add connection catalogue', () => {
  const connections = [{ id: 'github', status: 'ready' }, { id: 'calendly', status: 'reconnect' }, { id: 'linear', status: 'connect' }];
  const rows = catalogueRows({
    catalogue: [
      { id: 'GitHub', name: 'GitHub', connection_type: 'oauth' },
      { id: 'calendly', name: 'Calendly', connection_type: 'oauth' },
      { id: 'linear', name: 'Linear', connectionType: 'apikey', pluginProvided: true },
      { id: 'openai', name: 'OpenAI', connection_type: 'apikey' },
      { id: 'agnt', name: 'AGNT' },
      { id: 'google-login', name: 'Google login' },
      { id: 'github', name: 'GitHub again' },
    ],
    connections,
    modelIds: MODEL_IDS,
  });
  it('offers each service once and hides AGNT’s own sign-ins', () => {
    expect(rows.map((row) => row.id)).toEqual(['calendly', 'linear', 'openai', 'github']);
  });
  it('keeps a stopped connection reconnectable and puts connected ones last', () => {
    const status = Object.fromEntries(rows.map((row) => [row.id, row.status]));
    expect(status).toEqual({ calendly: 'reconnect', linear: null, openai: null, github: 'ready' });
    expect(rows.find((row) => row.id === 'openai').ai).toBe(true);
  });
});

describe('plugin rows', () => {
  const installed = [
    { name: 'gmail-plugin', displayName: 'Gmail', version: '1.1.0', tools: [tool('gmail-api', 'google')], installedAt: '2026-01-01T00:00:00Z' },
    { name: 'video', version: '2.0.0', tools: [tool('video-generate', 'openai')] },
    { name: 'calculator', version: '1.0.0', tools: [tool('calc')], enabled: false },
    { name: 'slack-plugin', displayName: 'Slack', version: '1.0.1', tools: [tool('slack-api', 'slack'), { type: 'slack-trigger', schema: { category: 'trigger', authProvider: 'slack' } }] },
  ];
  const rows = pluginRows({
    installed,
    available: [{ name: 'gmail-plugin', version: '1.10.0' }, { name: 'slack-plugin', version: '1.0.1' }],
    connections: [{ id: 'google', status: 'reconnect', name: 'Google' }],
    catalogue: [{ id: 'slack', name: 'Slack' }],
    modelIds: MODEL_IDS,
  });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  it('takes its status from the sign-in it uses', () => {
    expect(byId['gmail-plugin'].status).toBe('reconnect');
    expect(byId['slack-plugin'].status).toBe('connect');
    expect(byId['slack-plugin'].provider).toEqual(expect.objectContaining({ id: 'slack', name: 'Slack', model: false }));
  });
  it('a plugin that bills through an AI model, or needs nothing, is ready; a disabled one is off', () => {
    expect(byId.video.status).toBe('ready');
    expect(byId.video.provider.model).toBe(true);
    expect(byId.calculator.status).toBe('off');
    expect(byId.calculator.provider).toBeNull();
  });
  it('knows when the Market has a newer version, and what is inside', () => {
    expect(byId['gmail-plugin'].update).toBe('1.10.0');
    expect(byId['slack-plugin'].update).toBeNull();
    expect(byId['slack-plugin'].triggers).toBe(true);
    expect(byId['slack-plugin'].contents.map((group) => group.key)).toEqual(expect.arrayContaining(['tools']));
  });
  it('compares versions by number', () => {
    expect(isNewerVersion('1.10.0', '1.9.2')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9', '1.0.0')).toBe(false);
    expect(isNewerVersion('', '1.0.0')).toBe(false);
  });
});

describe('MCP servers', () => {
  it('a server is unchecked until tested, then says what the test answered', () => {
    const tests = {
      git: mcpTestResult({ success: true, connected: true, message: 'Connection successful (4 tools, 80ms)', toolCount: 4 }, 'T'),
      web: mcpTestResult({ success: true, connected: false, message: 'Connection failed: timeout' }, 'T'),
    };
    const rows = mcpRows([{ name: 'git', transport: { type: 'stdio' } }, { name: 'web', transport: { type: 'http' } }, { name: 'fresh' }], tests);
    expect(rows.map((row) => [row.id, row.runs, row.status, row.tools])).toEqual([
      ['git', 'On this computer', 'ok', 4],
      ['web', 'Remote server', 'bad', null],
      ['fresh', 'On this computer', 'unchecked', null],
    ]);
    expect(mcpTestResult({ success: false, error: 'Server not found' }).ok).toBe(false);
  });
});

describe('email and webhook triggers', () => {
  it('one row per listener and webhook, with what each needs', () => {
    const rows = triggerRows(
      [{ id: 7, workflow_id: 'w2', workflow_name: 'Leads', workflow_status: 'listening', webhook_url: 'https://h/x', method: 'get', auth_type: 'bearer' }],
      [{ id: 3, workflow_id: 'w1', workflow_name: '', workflow_status: 'stopped', email_address: 'workflow-1@agnt.gg' }],
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: 'email:3', kind: 'Email', workflow: 'Untitled workflow', wfStatus: 'stopped', address: 'workflow-1@agnt.gg' }),
      expect.objectContaining({ id: 'webhook:7', kind: 'Webhook', method: 'GET', protected: true, url: 'https://h/x', wfStatus: 'listening' }),
    ]);
  });
});

describe('lists: search, filters, sort and groups', () => {
  const spec = LISTS.connections;
  const row = (id, extra) => ({ id, name: id, appName: id, identity: null, kind: 'Sign-in', ai: false, local: false, fromPlugin: null, custom: false, status: 'ready', apps: [], checked: null, team: false, ...extra });
  const rows = [
    row('Slack', { apps: [{ label: 'Slack' }] }),
    row('calendly', { status: 'reconnect' }),
    row('Airtable', { kind: 'API key' }),
    row('OpenAI', { ai: true, kind: 'API key' }),
    row('linear', { status: 'connect', fromPlugin: 'Linear' }),
  ];
  const ids = (list) => list.map((r) => r.id);

  it('needs-you rows come first by default, then by name', () => {
    expect(ids(visibleRows(rows, spec))).toEqual(['calendly', 'linear', 'Airtable', 'OpenAI', 'Slack']);
  });
  it('search matches names and the plugins a connection powers', () => {
    expect(ids(visibleRows(rows, spec, { q: 'SLACK' }))).toEqual(['Slack']);
  });
  it('options within a filter are alternatives; filters together narrow', () => {
    const chosen = { status: new Set(['ready', 'connect']) };
    expect(ids(visibleRows(rows, spec, { chosen }))).toEqual(['linear', 'Airtable', 'OpenAI', 'Slack']);
    chosen.kind = new Set(['apikey']);
    expect(ids(visibleRows(rows, spec, { chosen }))).toEqual(['Airtable']);
  });
  it('sorting flips with direction and ties fall back to the name', () => {
    expect(ids(visibleRows(rows, spec, { sort: ['name', -1] }))).toEqual(['Slack', 'OpenAI', 'linear', 'calendly', 'Airtable']);
    expect(ids(visibleRows(rows, spec, { sort: ['status', -1] })).slice(0, 3)).toEqual(['Airtable', 'OpenAI', 'Slack']);
  });
  it('groups follow their order, then other headings by name, then the trailing ones', () => {
    const grouped = groupRows(visibleRows(rows, spec), spec.groups.kind);
    expect(grouped.map((group) => [group.label, group.rows.length])).toEqual([['Sign-ins', 3], ['API keys', 1], ['AI models', 1]]);
    const uses = groupRows(
      [{ provider: null }, { provider: { name: 'Slack', model: false } }, { provider: { name: 'OpenAI', model: true } }, { provider: { name: 'Asana', model: false } }],
      LISTS.plugins.groups.uses,
    );
    expect(uses.map((group) => group.label)).toEqual(['Asana', 'Slack', 'Your AI model', 'Nothing to connect']);
  });
});

describe('custom apps', () => {
  const catalogue = [{ id: 'slack', name: 'Slack' }, { id: 'custom-acme-crm', name: 'Old Acme' }];
  it('needs a name that is not already listed, and a key', () => {
    expect(customAppErrors({ name: '', key: '' }, catalogue)).toEqual({ name: 'Enter the app’s name', key: 'Paste the API key' });
    expect(customAppErrors({ name: ' slack ', key: 'k' }, catalogue).name).toBe('slack is already in the list. Connect it from there.');
    expect(customAppErrors({ name: 'x'.repeat(61), key: 'k' }, catalogue).name).toMatch(/under 60/);
    expect(customAppErrors({ name: 'Acme CRM', key: 'k' }, catalogue)).toEqual({});
  });
  it('gets an id of its own from its name', () => {
    expect(customProviderId('Acme CRM!', ['slack'])).toBe('custom-acme-crm');
    expect(customProviderId('Acme CRM', catalogue.map((entry) => entry.id))).toBe('custom-acme-crm-2');
    expect(customProviderId('Acme CRM', new Set(['custom-acme-crm', 'custom-acme-crm-2']))).toBe('custom-acme-crm-3');
    expect(customProviderId('★★★', [])).toBe('custom-app');
    expect(customProviderId('Acme CRM', [], 'K3X9')).toBe('custom-acme-crm-k3x9');
    expect(customProviderId('Acme CRM', ['custom-acme-crm-k3x9'], 'k3x9')).toBe('custom-acme-crm-k3x9-2');
    expect(randomSuffix()).toMatch(/^[a-z0-9]{4}$/);
  });
  it('is created as an API-key app with its own icon and help text', () => {
    expect(customProviderData({ name: ' Acme ', where: 'Settings › API' }, 'custom-acme')).toEqual({
      id: 'custom-acme',
      name: 'Acme',
      icon: 'custom',
      categories: ['Custom'],
      connectionType: 'apikey',
      instructions: 'Settings › API',
      customPrompt: '',
    });
    expect(customProviderData({ name: 'Acme' }, 'custom-acme').instructions).toBe('Paste your Acme API key.');
  });
});

describe('dates', () => {
  it('a check from today shows the time; an older one shows the date', () => {
    const now = new Date('2026-11-13T18:00:00');
    expect(formatChecked(new Date('2026-11-13T11:27:00').toISOString(), now)).toBe('Today, 11:27 AM');
    expect(formatChecked('2026-11-02T10:00:00', now)).toBe('Nov 2, 2026');
    expect(formatChecked(null, now)).toBe('—');
    expect(formatChecked('not a date', now)).toBe('—');
  });
});
