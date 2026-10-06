import { describe, expect, it, vi } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { all: vi.fn(), get: vi.fn(), run: vi.fn() } }));

const { describeSkillCatalog, findLoadedSkills, NAME_ONLY_LEAD } = await import('./skillsInventory.js');
const { buildSkillCatalog, buildSkillActivationInstructions, selectFeaturedSkills } = await import('../SkillService.js');
const { buildContextManifest } = await import('./contextManifest.js');

const estimate = (text) => Math.ceil(String(text).length / 4);

const skill = (name, description) => ({ name, description });
const catalogText = (entries, featured) =>
  `${buildSkillCatalog(entries, { featured })}\n\n${buildSkillActivationInstructions()}`;

describe('describeSkillCatalog', () => {
  it('itemizes the text SkillService actually writes: gists, name-only list, rules', () => {
    const entries = [skill('alpha', 'Does alpha things. More detail.'), skill('beta', 'Does beta.'), skill('gamma', 'Does gamma.')];
    const text = catalogText(entries, new Set(['alpha']));
    const out = describeSkillCatalog(text, estimate);

    expect(out.described.map((s) => s.name)).toEqual(['alpha']);
    expect(out.namedOnly).toEqual(['beta', 'gamma']);
    expect(out.namedOnlyTokens).toBeGreaterThan(0);
    expect(out.rulesTokens).toBeGreaterThan(0);
    expect(out.tokens).toBe(estimate(text));
  });

  it('the name-only lead it parses is the one SkillService writes', () => {
    const text = buildSkillCatalog([skill('a', 'x'), skill('b', 'y')], { featured: new Set(['a']) });
    expect(text).toContain(NAME_ONLY_LEAD);
  });

  it('a catalog with every skill featured has no name-only list', () => {
    const out = describeSkillCatalog(catalogText([skill('a', 'x'), skill('b', 'y')], null), estimate);
    expect(out.described).toHaveLength(2);
    expect(out.namedOnly).toEqual([]);
  });

  it('returns null for an empty catalog', () => {
    expect(describeSkillCatalog('', estimate)).toBeNull();
    expect(describeSkillCatalog(null, estimate)).toBeNull();
  });
});

describe('findLoadedSkills', () => {
  const openAiCall = (id, input) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'activate_skill', arguments: JSON.stringify(input) } }] });
  const openAiResult = (id, content) => ({ role: 'tool', tool_call_id: id, content });

  it('finds playbooks in OpenAI-shape history', () => {
    const messages = [
      { role: 'user', content: 'go' },
      openAiCall('c1', { skill_name: 'frontend-design' }),
      openAiResult('c1', 'x'.repeat(400)),
    ];
    expect(findLoadedSkills(messages, estimate)).toEqual([{ name: 'frontend-design', tokens: 100, activations: 1 }]);
  });

  it('finds playbooks in Anthropic-shape history', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'activate_skill', input: { skill_name: 'code-review' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'y'.repeat(80) }] }] },
    ];
    expect(findLoadedSkills(messages, estimate)).toEqual([{ name: 'code-review', tokens: 20, activations: 1 }]);
  });

  it('skips searches, which load no playbook, and other tools', () => {
    const messages = [
      openAiCall('s1', { search: 'video' }),
      openAiResult('s1', 'z'.repeat(400)),
      { role: 'assistant', content: '', tool_calls: [{ id: 'r1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      openAiResult('r1', 'w'.repeat(400)),
    ];
    expect(findLoadedSkills(messages, estimate)).toEqual([]);
  });

  it('one skill activated twice is one row with summed tokens', () => {
    const messages = [
      openAiCall('a', { skill_name: 'flag-issue' }), openAiResult('a', 'x'.repeat(40)),
      openAiCall('b', { skill_name: 'flag-issue' }), openAiResult('b', 'x'.repeat(40)),
    ];
    expect(findLoadedSkills(messages, estimate)).toEqual([{ name: 'flag-issue', tokens: 20, activations: 2 }]);
  });

  it('tolerates junk input', () => {
    expect(findLoadedSkills(null, estimate)).toEqual([]);
    expect(findLoadedSkills([null, {}, { role: 'tool' }], estimate)).toEqual([]);
  });
});

describe('selectFeaturedSkills (the catalog gist tier)', () => {
  const stats = [
    { name: 'a', count: 60, last: '2026-01-01' },
    { name: 'b', count: 30, last: '2026-01-01' },
    { name: 'c', count: 9, last: '2026-01-01' },
    { name: 'd', count: 1, last: '2026-01-01' },
  ];

  it('keeps the most-used skills until they cover the target share', () => {
    expect([...selectFeaturedSkills(stats, { coverage: 0.9 })]).toEqual(['a', 'b']);
    expect([...selectFeaturedSkills(stats, { coverage: 0.95 })]).toEqual(['a', 'b', 'c']);
  });

  it('always keeps a skill used recently, however rarely', () => {
    const recent = [...stats, { name: 'e', count: 1, last: '2026-09-30' }];
    expect(selectFeaturedSkills(recent, { coverage: 0.9, recentSince: '2026-09-01' }).has('e')).toBe(true);
  });

  it('only installed skills compete, so an uninstalled favourite takes no slot', () => {
    const out = selectFeaturedSkills(stats, { coverage: 0.9, installed: ['b', 'c', 'd'] });
    expect(out.has('a')).toBe(false);
    expect(out.has('b')).toBe(true);
  });

  it('merges counts for one skill activated under two spellings', () => {
    const split = [{ name: 'Code Review', count: 5, last: '' }, { name: 'code-review', count: 5, last: '' }, { name: 'z', count: 8, last: '' }];
    expect([...selectFeaturedSkills(split, { coverage: 0.5 })]).toEqual(['codereview']);
  });

  it('features nothing when there is no history', () => {
    expect(selectFeaturedSkills([], {}).size).toBe(0);
    expect(selectFeaturedSkills(null, {}).size).toBe(0);
  });
});

describe('buildContextManifest: Skills group', () => {
  const catalog = catalogText([skill('alpha', 'Does alpha.'), skill('beta', 'Does beta.')], new Set(['alpha']));
  const messages = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'activate_skill', arguments: '{"skill_name":"alpha"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'p'.repeat(4000) },
  ];
  const input = () => ({
    systemPrompt: 'whatever',
    promptSections: [
      { id: 'memory', label: 'Memory', tokens: 300, frozen: true },
      { id: 'skills', label: 'Skills catalog', tokens: 900, frozen: true },
      { id: 'skills_assigned', label: 'Assigned skills', tokens: 100, frozen: true },
    ],
    skillsText: { catalog, assigned: 'x' },
    contextResult: { systemTokens: 5000, toolTokens: 0, messagesTokens: 3000, messages },
  });

  it('moves skill rows out of System without changing the System bucket', () => {
    const { manifest } = buildContextManifest(input());
    expect(manifest.system.total).toBe(5000);
    expect(manifest.system.sections.map((s) => s.id)).not.toContain('skills');
    expect(manifest.system.sections.map((s) => s.id)).not.toContain('skills_assigned');
    // Core instructions is still the residue with skills counted in.
    expect(manifest.system.sections.find((s) => s.id === 'static').tokens).toBe(5000 - 300 - 900 - 100);
  });

  it('partitions exactly: resident from System, loaded from Messages', () => {
    const { manifest } = buildContextManifest(input());
    const s = manifest.skills;
    expect(s.resident).toBe(1000);
    expect(s.catalog.describedCount).toBe(1);
    expect(s.catalog.namedOnlyCount).toBe(1);
    expect(s.loaded.map((l) => l.name)).toEqual(['alpha']);
    expect(s.total).toBe(s.resident + s.loadedTokens);
  });

  it('never claims more of the messages than the messages bucket holds', () => {
    const tight = input();
    tight.contextResult.messagesTokens = 50;
    expect(buildContextManifest(tight).manifest.skills.loadedTokens).toBe(50);
  });

  it('a /skill-pinned playbook is a Skills row, not hidden in Core instructions', () => {
    const pinned = input();
    pinned.promptSections.push({ id: 'skills_pinned', label: 'hyperframes', tokens: 700, frozen: true });
    const { manifest } = buildContextManifest(pinned);
    expect(manifest.skills.pinned).toMatchObject({ name: 'hyperframes', tokens: 700 });
    expect(manifest.skills.resident).toBe(1700);
    expect(manifest.system.sections.map((s) => s.id)).not.toContain('skills_pinned');
  });

  it('a skills catalog change still breaks the cache fingerprint', () => {
    const first = buildContextManifest(input());
    const changed = input();
    changed.promptSections[1].tokens = 950;
    const second = buildContextManifest({ ...changed, prior: first.fingerprints });
    expect(second.manifest.cache.changedSections).toContain('skills');
  });

  it('no skills at all is an empty group, not a crash', () => {
    const { manifest } = buildContextManifest({});
    expect(manifest.skills).toMatchObject({ total: 0, resident: 0, loadedTokens: 0, loaded: [], pinned: null });
  });
});
