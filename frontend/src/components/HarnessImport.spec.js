import { describe, it, expect, vi } from 'vitest';
import { ref, computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import HarnessImport from './HarnessImport.vue';

const source = (id, label, over = {}) => ({
  id,
  label,
  icon: 'agent',
  home: `/home/user/.${id}`,
  skills: { total: 8, importable: 0, names: [], ...(over.skills || {}) },
  persona: { available: false, ...(over.persona || {}) },
  memories: { count: 0, ...(over.memories || {}) },
});

/** A stand-in for useHarnessImport() with real refs, so computeds react. */
function stubImporter(sources = [], over = {}) {
  const selected = ref(new Set());
  const list = ref(sources);
  const totals = ref({
    skillsSeen: sources.reduce((n, s) => n + s.skills.total, 0),
    skillsImportable: sources.reduce((n, s) => n + s.skills.importable, 0),
    personas: sources.filter((s) => s.persona.available).length,
    memories: sources.reduce((n, s) => n + s.memories.count, 0),
    ...(over.totals || {}),
  });
  const api = {
    sources: list,
    totals,
    offerable: computed(() =>
      list.value.filter((s) => s.skills.importable > 0 || s.persona.available || s.memories.count > 0),
    ),
    selectedCount: computed(() => selected.value.size),
    running: ref(false),
    result: ref(null),
    error: ref(''),
    toggle: vi.fn((kind, id) => {
      const key = `${kind}:${id}`;
      const next = new Set(selected.value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selected.value = next;
    }),
    isSelected: (kind, id) => selected.value.has(`${kind}:${id}`),
    run: vi.fn(async () => ({ imported: { skills: 1, agents: 0, memories: 0 }, items: [], failures: [] })),
    ...over,
  };
  return api;
}

const mountImport = (importer) =>
  mount(HarnessImport, {
    props: { importer },
    global: { stubs: { SvgIcon: { template: '<span class="svg-icon-stub" />', props: ['name'] } } },
  });

describe('HarnessImport — what already works', () => {
  it('leads with the skills that need no action at all', () => {
    // AGNT reads these tools' folders directly, so most of what the user has
    // already works. Saying so first stops the list reading as "missing".
    const importer = stubImporter([
      source('claude', 'Claude Code'),
      source('hermes', 'Hermes', { skills: { total: 9, importable: 1, names: ['x'] } }),
    ]);
    const text = mountImport(importer).find('.hi-already').text();
    expect(text).toContain('16 skills');
    expect(text).toContain('already work here');
  });

  it('says nothing about it when every skill is new', () => {
    const importer = stubImporter([
      source('hermes', 'Hermes', { skills: { total: 2, importable: 2, names: ['a', 'b'] } }),
    ]);
    expect(mountImport(importer).find('.hi-already').exists()).toBe(false);
  });

  it('never lists tools without bound', () => {
    const importer = stubImporter([
      source('a', 'Alpha'), source('b', 'Beta'), source('c', 'Gamma'), source('d', 'Delta'),
    ]);
    const text = mountImport(importer).find('.hi-already').text();
    expect(text).toContain('Alpha, Beta and 2 others');
  });
});

describe('HarnessImport — the offer', () => {
  it('reconciles the banner count with the number of rows', () => {
    // The banner counts every tool found; only some have rows. Without the
    // numbers here, four missing cards look like a bug rather than like four
    // tools with nothing left to give.
    const importer = stubImporter([
      source('claude', 'Claude Code'),
      source('codex', 'Codex'),
      source('hermes', 'Hermes', { skills: { total: 9, importable: 3, names: ['a', 'b', 'c'] } }),
    ]);
    expect(mountImport(importer).find('.hi-lead').text()).toBe('Not in AGNT yet — 1 of your 3 tools');
  });

  it('drops the count when every tool has something to offer', () => {
    const importer = stubImporter([
      source('hermes', 'Hermes', { skills: { total: 9, importable: 3, names: ['a', 'b', 'c'] } }),
    ]);
    expect(mountImport(importer).find('.hi-lead').text()).toBe('Not in AGNT yet');
  });

  it('shows a row only for tools that can contribute something', () => {
    const importer = stubImporter([
      source('claude', 'Claude Code'),
      source('hermes', 'Hermes', { skills: { total: 9, importable: 3, names: ['a', 'b', 'c'] } }),
    ]);
    const rows = mountImport(importer).findAll('.hi-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('Hermes');
  });

  it('offers each kind the tool actually has', () => {
    const importer = stubImporter([
      source('hermes', 'Hermes', {
        skills: { total: 9, importable: 3, names: ['a', 'b', 'c'] },
        persona: { available: true },
        memories: { count: 7 },
      }),
    ]);
    const labels = mountImport(importer).findAll('.hi-offer').map((o) => o.text());
    expect(labels).toEqual(['3 skills', 'Agent persona', '7 memories']);
  });

  it('counts in singular when there is one', () => {
    const importer = stubImporter([
      source('hermes', 'Hermes', {
        skills: { total: 1, importable: 1, names: ['a'] },
        memories: { count: 1 },
      }),
    ]);
    const labels = mountImport(importer).findAll('.hi-offer').map((o) => o.text());
    expect(labels).toEqual(['1 skill', '1 memory']);
  });

  it('toggles an offer and reflects it', async () => {
    const importer = stubImporter([
      source('hermes', 'Hermes', { skills: { total: 9, importable: 3, names: ['a', 'b', 'c'] } }),
    ]);
    const wrapper = mountImport(importer);
    const offer = wrapper.find('.hi-offer');
    expect(offer.classes()).not.toContain('on');

    await offer.trigger('click');
    expect(importer.toggle).toHaveBeenCalledWith('skills', 'hermes');
    expect(wrapper.find('.hi-offer').classes()).toContain('on');
    expect(wrapper.find('.hi-offer').attributes('aria-pressed')).toBe('true');
  });
});

describe('HarnessImport — the action', () => {
  const withOne = () =>
    stubImporter([
      source('hermes', 'Hermes', {
        skills: { total: 9, importable: 3, names: ['a', 'b', 'c'] },
        persona: { available: true },
      }),
    ]);

  it('is disabled until something is selected', () => {
    const wrapper = mountImport(withOne());
    const button = wrapper.find('.hi-action');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.text()).toContain('Select what to bring over');
  });

  it('names the total so the button says what pressing it does', async () => {
    const importer = withOne();
    const wrapper = mountImport(importer);
    await wrapper.findAll('.hi-offer')[0].trigger('click');
    expect(wrapper.find('.hi-action').text()).toContain('3 skills');

    await wrapper.findAll('.hi-offer')[1].trigger('click');
    expect(wrapper.find('.hi-action').text()).toContain('1 agent');
  });

  it('promises only what it does — copies, changes nothing at the source', () => {
    expect(mountImport(withOne()).text()).toContain('Nothing in Hermes is changed or removed');
  });

  it('runs the import and reports what landed', async () => {
    const importer = withOne();
    const wrapper = mountImport(importer);
    await wrapper.findAll('.hi-offer')[0].trigger('click');
    await wrapper.find('.hi-action').trigger('click');
    await flushPromises();

    expect(importer.run).toHaveBeenCalled();
    expect(wrapper.emitted('imported')).toHaveLength(1);
  });

  it('does nothing when nothing is selected', async () => {
    const importer = withOne();
    const wrapper = mountImport(importer);
    await wrapper.find('.hi-action').trigger('click');
    expect(importer.run).not.toHaveBeenCalled();
  });
});

describe('HarnessImport — afterwards', () => {
  it('replaces the offer with what actually happened', () => {
    const importer = stubImporter([source('hermes', 'Hermes')]);
    importer.result.value = { imported: { skills: 8, agents: 1, memories: 7 }, items: [], failures: [] };
    const wrapper = mountImport(importer);
    expect(wrapper.find('.hi-done').text()).toContain('8 skills, 1 agent, 7 memories');
    expect(wrapper.find('.hi-action').exists()).toBe(false);
  });

  it('says so honestly when everything was already there', () => {
    const importer = stubImporter([source('hermes', 'Hermes')]);
    importer.result.value = { imported: { skills: 0, agents: 0, memories: 0 }, items: [], failures: [] };
    expect(mountImport(importer).find('.hi-done').text()).toContain('already here');
  });

  it('surfaces partial failure rather than claiming success', () => {
    // Four things landing and one failing is four things and one honest line.
    const importer = stubImporter([source('hermes', 'Hermes')]);
    importer.result.value = {
      imported: { skills: 4, agents: 0, memories: 0 },
      items: [],
      failures: [{ kind: 'skill', name: 'broken-one', error: 'Invalid SKILL.md' }],
    };
    const wrapper = mountImport(importer);
    expect(wrapper.find('.hi-done').text()).toContain('4 skills');
    expect(wrapper.find('.hi-warn').text()).toContain('broken-one');
  });

  it('shows an error from the request itself', () => {
    const importer = stubImporter([
      source('hermes', 'Hermes', { skills: { total: 1, importable: 1, names: ['a'] } }),
    ]);
    importer.error.value = 'Import failed';
    expect(mountImport(importer).find('.hi-warn').text()).toBe('Import failed');
  });
});
