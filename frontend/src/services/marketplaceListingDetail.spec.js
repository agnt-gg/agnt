// What a Market listing contains and does (2026-10-21): agents, workflows,
// tools and skills showed only a title and description. Shapes here are the
// real listings' metadata, as served by api.agnt.gg/marketplace/items.
import { describe, it, expect } from 'vitest';
import { listingDetail, accessFrom } from './marketplaceListingDetail.js';

const ids = (entries) => entries.map((entry) => entry.id);

describe('an agent', () => {
  const agent = { asset_type: 'agent', metadata: JSON.stringify({ name: 'Koder Kai', assignedTools: ['execute_shell_command', 'web_search', 'file_operations', 'generate_image'], assignedSkills: ['frontend-design'], systemPrompt: 'You write code.', provider: '', model: '' }) };
  it('lists its tools and skills, shows its instructions, and runs on your AI when it names none', () => {
    const d = listingDetail(agent);
    expect(d.groups.map((g) => [g.key, g.items.map((i) => i.name)])).toEqual([
      ['tools', ['Execute shell command', 'Web search', 'File operations', 'Generate image']],
      ['skills', ['Frontend design']],
    ]);
    expect(d.instructions).toBe('You write code.');
    expect(d.facts).toEqual([{ key: 'Model', value: 'Your selected AI' }]);
    expect(d.itemCount).toBe(5);
  });
  it('the access it uses comes from its tools, and says which tool implies it', () => {
    const access = listingDetail(agent).access;
    expect(ids(access)).toEqual(['programs', 'files', 'internet']);
    expect(access.find((a) => a.id === 'programs').because).toEqual(['Execute shell command']);
  });
});

describe('a workflow', () => {
  const workflow = { asset_type: 'workflow', metadata: {
    nodes: [
      { id: 'note', type: 'label', text: 'Daily AI News', category: 'utility' },
      { id: 'send', type: 'send-email', text: 'Send Daily Email', category: 'action', parameters: { to: 'me@example.com', subject: 'News', apiKey: 'sk-secret' } },
      { id: 'timer', type: 'trigger-timer', text: 'Daily Trigger', category: 'trigger', parameters: { schedule: 'Daily' } },
      { id: 'search', type: 'web-search', text: 'Web Search AI News', category: 'action', parameters: { searchQuery: 'AI news' } },
    ],
    edges: [{ start: { id: 'timer' }, end: { id: 'search' } }, { start: { id: 'search' }, end: { id: 'send' } }],
  } };
  it('lists its steps in the order they run, without canvas notes, with their settings but never a secret', () => {
    const steps = listingDetail(workflow).groups[0].items;
    expect(steps.map((s) => [s.number, s.name])).toEqual([[1, 'Daily Trigger'], [2, 'Web Search AI News'], [3, 'Send Daily Email']]);
    expect(steps[0].detail).toBe('Starts the workflow · Trigger timer');
    expect(steps[2].settings).toEqual([{ key: 'To', value: 'me@example.com' }, { key: 'Subject', value: 'News' }]);
    expect(JSON.stringify(steps)).not.toContain('sk-secret');
    expect(listingDetail(workflow).facts).toEqual([{ key: 'Starts', value: 'Daily Trigger' }]);
  });
  it('the access it uses comes from its steps', () => {
    expect(ids(listingDetail(workflow).access)).toEqual(['internet', 'email', 'schedule']);
  });
});

describe('a tool', () => {
  it('a code tool shows its inputs, outputs, code, and what the code calls', () => {
    const d = listingDetail({ asset_type: 'tool', metadata: { base: 'CODE_JS', code: "// fetch the page\nconst r = await fetch(params.url);", parameters: { url: { label: 'URL', description: 'The URL to fetch', required: true }, method: { options: ['GET', 'POST'] } }, outputs: { success: { type: 'boolean' }, result: { type: 'any', description: 'The body' } } } });
    expect(d.groups.map((g) => [g.key, g.items.map((i) => [i.name, i.detail])])).toEqual([
      ['inputs', [['URL', 'The URL to fetch · Required'], ['Method', 'One of: GET, POST']]],
      ['outputs', [['success', 'boolean'], ['result', 'any · The body']]],
    ]);
    expect(d.codeLabel).toBe('JavaScript code');
    expect(d.code).toContain('fetch(params.url)');
    expect(ids(d.access)).toEqual(['code', 'internet']);
    // What the code calls, in words: never "Http, Https".
    const net = listingDetail({ asset_type: 'tool', metadata: { base: 'CODE_JS', code: "await fetch('https://a.b'); http://c" } }).access.find((a) => a.id === 'internet');
    expect(net.because).toEqual(['Fetch()', 'Web addresses']);
  });
  it('a prompt tool shows its prompt and needs no access of its own', () => {
    const d = listingDetail({ asset_type: 'tool', metadata: { base: 'AI', parameters: { topic: { type: 'text' }, instructions: 'Write about {{topic}}' } } });
    expect(d.instructions).toBe('Write about {{topic}}');
    expect(d.code).toBe('');
    expect(d.groups[0].items.map((i) => i.id)).toEqual(['topic']);
    expect(d.access).toEqual([]);
  });
});

describe('a skill', () => {
  it('shows its full instructions, its allowed tools and where it comes from', () => {
    const d = listingDetail({ asset_type: 'skill', metadata: { instructions: '# Article extractor\nUse curl.', allowedTools: ['Bash', 'Write'], license: 'MIT', metadata: { author: 'anthropic', source: 'https://github.com/x' } } });
    expect(d.instructions).toBe('# Article extractor\nUse curl.');
    expect(d.groups[0].items.map((i) => i.name)).toEqual(['Bash', 'Write']);
    expect(ids(d.access)).toEqual(['programs', 'files']);
    expect(d.facts.map((f) => f.key)).toEqual(['License', 'Author', 'Source']);
  });
});

describe('edges', () => {
  it('plugins are not described here, and a listing without a definition says so', () => {
    expect(listingDetail({ asset_type: 'plugin', metadata: '{}' })).toBeNull();
    expect(listingDetail({ asset_type: 'agent', metadata: 'not json' })).toMatchObject({ known: false, itemCount: 0 });
  });
  it('access matches whole words only', () => {
    expect(accessFrom(['update_profile', 'rapid_notes', 'edit_image', 'search_memory', 'write_blog_post'])).toEqual([]);
  });
});
