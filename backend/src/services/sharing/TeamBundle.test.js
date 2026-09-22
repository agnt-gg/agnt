import { describe, it, expect } from 'vitest';
import { sanitize, buildBundle, installBundle, slotsFor, looksSecret } from './TeamBundle.js';

// Fake credentials are ASSEMBLED at runtime. A credential-shaped literal in
// source is exactly what secret scanners block, and should keep blocking.
const join = (...parts) => parts.join('');
const OPENAI_KEY = join('sk', '-proj-', 'a'.repeat(40));
const GITHUB_TOKEN = join('gh', 'p_', 'A'.repeat(36));
const CLOUD_KEY = join('AK', 'IA', 'B'.repeat(16));
const CHAT_TOKEN = join('xo', 'xb-', '1234567890-abcdefghij');
const KEY_HEADER = join('-----BEGIN RSA PRIV', 'ATE KEY-----');

/** An in-memory store with the same owner-checked contract as nativeStore. */
function memoryStore(rows = {}) {
  const data = new Map(Object.entries(rows));
  return {
    data,
    read: async (kind, id, owner) => { const row = data.get(kind + ':' + id); return row && row.owner === owner ? row.value : null; },
    write: async (kind, id, value, owner) => { data.set(kind + ':' + id, { owner, value }); },
    customToolIds: async owner => [...data].filter(([key, row]) => key.startsWith('tool:') && row.owner === owner).map(([key]) => key.slice(5)),
  };
}
const seeded = () => memoryStore({
  'agent:a1': { owner: 'alice', value: { name: 'Researcher', systemPrompt: 'Use key ' + OPENAI_KEY + ' when asked.', provider: 'openai', model: 'gpt-4o', apiKey: OPENAI_KEY, creditLimit: 5000, created_by: 'alice', assignedTools: ['t1', 'web-search'], assignedWorkflows: ['w1'], assignedSkills: [], description: 'C:\\Users\\alice\\secret-plans.docx' } },
  'tool:t1': { owner: 'alice', value: { title: 'Summarize', base: 'AI', config: { instructions: 'Summarize', provider: 'anthropic', headers: { Authorization: 'Bearer ' + GITHUB_TOKEN } }, parameters: {}, outputs: {} } },
  'workflow:w1': { owner: 'alice', value: { name: 'Triage', nodes: [{ id: 'n1', type: 'github-api', parameters: { action: 'CREATE_ISSUE', repo: 'acme/app', token: GITHUB_TOKEN } }, { id: 'n2', type: 't1' }], edges: [] } },
  'agent:bob-agent': { owner: 'bob', value: { name: 'Not yours' } },
});
const nodeProvider = type => (type === 'github-api' ? 'github' : null);

describe('sanitize', () => {
  it('keeps only the allowlist and blanks secrets and local paths wherever they appear', () => {
    const { definition, stripped } = sanitize('agent', { name: 'x', systemPrompt: OPENAI_KEY, apiKey: 'k', creditLimit: 1, created_by: 'alice', description: '/Users/alice/notes.md' });
    expect(definition).toEqual({ name: 'x', systemPrompt: '', description: '' });
    expect(stripped.map(s => s.reason).sort()).toEqual(['credential', 'local path']);
  });

  it('refuses a code tool whose code contains a credential rather than shipping half of it', () => {
    expect(() => sanitize('tool', { title: 'x', code: 'const key = "' + OPENAI_KEY + '";' })).toThrow(/credential/);
    expect(sanitize('tool', { title: 'x', code: 'return input * 2;' }).definition.code).toBe('return input * 2;');
  });

  it('recognises the common credential shapes and not ordinary text', () => {
    for (const secret of [OPENAI_KEY, GITHUB_TOKEN, CLOUD_KEY, CHAT_TOKEN, KEY_HEADER]) expect(looksSecret(secret)).toBe(true);
    for (const text of ['Summarize the ticket', 'skip the intro', 'ghost town', 'sk-short']) expect(looksSecret(text)).toBe(false);
  });
});

describe('buildBundle', () => {
  it('carries definitions and dependencies, and none of the owner\'s credentials, paths or bookkeeping', async () => {
    const { bundle, preview } = await buildBundle(seeded(), 'alice', [{ kind: 'agent', id: 'a1' }], { nodeProvider });
    expect(bundle.items.map(i => i.kind + ':' + i.sourceId).sort()).toEqual(['agent:a1', 'tool:t1', 'workflow:w1']);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(OPENAI_KEY);
    expect(serialized).not.toContain(GITHUB_TOKEN);
    expect(serialized).not.toContain('secret-plans');
    expect(serialized).not.toMatch(/creditLimit|created_by|apiKey/);
    expect(preview.needs.map(n => n.provider).sort()).toEqual(['anthropic', 'github', 'openai']);
    expect(preview.removed).toBeGreaterThanOrEqual(3);
  });

  it('can leave dependencies out and report them instead', async () => {
    const { bundle, preview } = await buildBundle(seeded(), 'alice', [{ kind: 'agent', id: 'a1' }], { includeDependencies: false });
    expect(bundle.items).toHaveLength(1);
    expect(preview.dependencies.map(d => d.kind + ':' + d.id).sort()).toEqual(['tool:t1', 'workflow:w1']);
  });

  it('never reads another person\'s item', async () => {
    await expect(buildBundle(seeded(), 'alice', [{ kind: 'agent', id: 'bob-agent' }])).rejects.toMatchObject({ status: 404 });
  });
});

describe('installBundle', () => {
  it('installs with fresh ids and rewires references between the copied items', async () => {
    const { bundle } = await buildBundle(seeded(), 'alice', [{ kind: 'agent', id: 'a1' }], { nodeProvider });
    const team = memoryStore();
    const { installed } = await installBundle(team, 'scope:p1', bundle);
    const ids = Object.fromEntries(installed.map(item => [item.source, item.id]));
    expect(Object.values(ids).some(id => ['a1', 't1', 'w1'].includes(id))).toBe(false);
    const agent = await team.read('agent', ids['agent:a1'], 'scope:p1');
    expect(agent.assignedTools).toEqual([ids['tool:t1'], 'web-search']);
    expect(agent.assignedWorkflows).toEqual([ids['workflow:w1']]);
    const workflow = await team.read('workflow', ids['workflow:w1'], 'scope:p1');
    expect(workflow.nodes[1].type).toBe(ids['tool:t1']);
  });

  it('re-sanitizes whatever it is sent, and only updates in place what the receiver already owns', async () => {
    const team = memoryStore({ 'agent:existing': { owner: 'scope:p1', value: { name: 'Old' } }, 'agent:foreign': { owner: 'scope:other', value: { name: 'Theirs' } } });
    const hostile = { version: 1, items: [{ kind: 'agent', sourceId: 'x', definition: { name: 'Hostile', systemPrompt: OPENAI_KEY, apiKey: OPENAI_KEY } }, { kind: 'agent', sourceId: 'y', definition: { name: 'Takeover' } }] };
    const { installed } = await installBundle(team, 'scope:p1', hostile, { replaces: { 'agent:x': 'existing', 'agent:y': 'foreign' } });
    expect(installed.find(i => i.source === 'agent:x').id).toBe('existing');
    expect(installed.find(i => i.source === 'agent:y').id).not.toBe('foreign');
    expect((await team.read('agent', 'foreign', 'scope:other')).name).toBe('Theirs');
    expect(JSON.stringify([...team.data.values()])).not.toContain(OPENAI_KEY);
  });

  it('rejects malformed bundles', async () => {
    await expect(installBundle(memoryStore(), 'o', { version: 2, items: [] })).rejects.toMatchObject({ status: 400 });
    await expect(installBundle(memoryStore(), 'o', { version: 1, items: [{ kind: 'wallet', sourceId: 'w', definition: { name: 'x' } }] })).rejects.toMatchObject({ status: 400 });
  });
});

describe('slotsFor', () => {
  it('names providers, never values', () => {
    expect(slotsFor('agent', { provider: 'openai' })).toEqual([{ provider: 'openai', reason: 'model' }]);
    expect(slotsFor('workflow', { nodes: [{ type: 'github-api', parameters: {} }] }, { nodeProvider })).toEqual([{ provider: 'github', reason: 'connection' }]);
  });
});
