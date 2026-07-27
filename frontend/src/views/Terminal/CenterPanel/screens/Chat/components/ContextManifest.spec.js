// ContextManifest — the drill-down inventory. Pins the behaviours that make
// it more than a prettier gauge: provenance is visible, "not in context" is
// accounted for, and a broken cache prefix is announced rather than silent.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ContextManifest from './ContextManifest.vue';

const manifest = (over = {}) => ({
  mode: 'auto',
  system: {
    total: 3000,
    sections: [
      { id: 'memory', label: 'Memory', tokens: 1500, frozen: true },
      { id: 'static', label: 'Core instructions', tokens: 1200, frozen: true },
      { id: 'skills', label: 'Skills catalog', tokens: 300, frozen: true },
    ],
  },
  tools: {
    total: 900, count: 3, registryTotal: 296,
    hiddenCount: 293, droppedCount: 0, deniedCount: 2,
    groups: ['core', 'media'],
    items: [
      { name: 'discover_tools', tokens: 340, reason: 'default', group: null },
      { name: 'generate_image', tokens: 890, reason: 'group', group: 'media' },
      { name: 'github_api', tokens: 2100, reason: 'discovered', group: null },
    ],
  },
  messages: { total: 400, count: 3, managed: false, reduction: 0 },
  cache: { prefixStable: true, toolsAdded: 1 },
  ...over,
});

describe('ContextManifest', () => {
  it('renders nothing until a manifest arrives', () => {
    const w = mount(ContextManifest, { props: { manifest: null } });
    expect(w.find('.context-manifest').exists()).toBe(false);
  });

  it('itemizes the system prompt instead of one opaque number', () => {
    const w = mount(ContextManifest, { props: { manifest: manifest() } });
    const text = w.text();
    expect(text).toContain('Memory');
    expect(text).toContain('Core instructions');
    expect(text).toContain('Skills catalog');
    expect(text).toContain('1.5k');
  });

  it('shows WHY each tool is loaded', () => {
    const w = mount(ContextManifest, { props: { manifest: manifest() } });
    const badges = w.findAll('.why').map((b) => b.text());
    expect(badges).toContain('default');
    expect(badges).toContain('media');      // group name, not the word "group"
    expect(badges).toContain('discovered');
  });

  it('accounts for what is NOT in context', () => {
    const w = mount(ContextManifest, { props: { manifest: manifest() } });
    expect(w.text()).toContain('Not in context');
    expect(w.text()).toContain('295'); // 293 hidden + 2 denied
  });

  it('surfaces dropped tools as a distinct, visible state', async () => {
    const m = manifest();
    m.tools.droppedCount = 18;
    const w = mount(ContextManifest, { props: { manifest: m } });
    await w.findAll('.group-head').at(3).trigger('click'); // open "Not in context"
    expect(w.text()).toContain('18 dropped');
  });

  // Losing 18 tools is a capability loss. It must not be a grey footnote in
  // the weakest position on the card.
  it('promotes dropped tools to a warning banner, not a muted row', () => {
    const m = manifest();
    m.tools.droppedCount = 18;
    const w = mount(ContextManifest, { props: { manifest: m } });
    const warns = w.findAll('.manifest-alert.warn');
    expect(warns.length).toBeGreaterThan(0);
    const text = warns.map((a) => a.text()).join(' ');
    // Stated as a SUBSET of everything absent, so the banner, the tool count
    // and the "not in context" row can be reconciled by the reader.
    expect(text).toMatch(/18 of \d+ tools dropped/);
    expect(text).toContain('budget cap');
  });

  it('marks the tool count as capped so it does not read as healthy', () => {
    const m = manifest();
    m.tools.droppedCount = 18;
    const w = mount(ContextManifest, { props: { manifest: m } });
    expect(w.find('.group-count.capped').exists()).toBe(true);
  });

  it('shows no dropped banner when nothing was dropped', () => {
    const w = mount(ContextManifest, { props: { manifest: manifest() } });
    expect(w.text()).not.toContain('tools dropped');
  });

  it('pluralizes the section count correctly', () => {
    const one = manifest();
    one.system.sections = [{ id: 'memory', label: 'Memory', tokens: 15300, frozen: true }];
    expect(mount(ContextManifest, { props: { manifest: one } }).text()).toContain('1 part');
    expect(mount(ContextManifest, { props: { manifest: one } }).text()).not.toContain('1 parts');
    expect(mount(ContextManifest, { props: { manifest: manifest() } }).text()).toContain('3 parts');
  });

  it('confirms a stable prompt prefix', () => {
    const w = mount(ContextManifest, { props: { manifest: manifest() } });
    expect(w.find('.manifest-alert').classes()).toContain('ok');
    expect(w.text()).toContain('Prompt prefix stable');
  });

  it('warns when the prefix broke and names the culprit', () => {
    const w = mount(ContextManifest, {
      props: { manifest: manifest({ cache: { prefixStable: false, changedSections: ['memory'] } }) },
    });
    expect(w.find('.manifest-alert').classes()).toContain('warn');
    expect(w.text()).toContain('Prefix changed');
    expect(w.text()).toContain('memory');
  });

  it('previews the 8 costliest-order tools and expands on demand', async () => {
    const m = manifest();
    m.tools.items = Array.from({ length: 20 }, (_, i) => ({
      name: `tool_${i}`, tokens: 100 + i, reason: 'default', group: null,
    }));
    const w = mount(ContextManifest, { props: { manifest: m } });
    expect(w.findAll('.item-row').filter((r) => r.text().includes('tool_')).length).toBe(8);
    expect(w.text()).toContain('12 more');
    await w.find('.show-more').trigger('click');
    expect(w.findAll('.item-row').filter((r) => r.text().includes('tool_')).length).toBe(20);
  });

  it('sorts by cost on demand, defaulting to load order', async () => {
    const w = mount(ContextManifest, { props: { manifest: manifest() } });
    const names = () => w.findAll('.item-name').map((n) => n.text());
    expect(names()).toContain('discover_tools');
    await w.find('.sort-toggle').trigger('click');
    const toolNames = names().filter((n) => n.includes('_') || n.includes('api'));
    expect(toolNames[0]).toBe('github_api'); // 2100, the biggest
  });

  it('reports trimmed messages', async () => {
    const m = manifest();
    m.messages = { total: 400, count: 3, managed: true, reduction: 12400 };
    const w = mount(ContextManifest, { props: { manifest: m } });
    await w.findAll('.group-head').at(2).trigger('click'); // open Messages
    expect(w.text()).toContain('Trimmed to fit');
    expect(w.text()).toContain('12.4k');
  });

  it('labels the tool-selection mode', () => {
    expect(mount(ContextManifest, { props: { manifest: manifest() } }).find('.mode-badge').text()).toBe('auto');
    expect(
      mount(ContextManifest, { props: { manifest: manifest({ mode: 'whitelist' }) } }).find('.mode-badge').text()
    ).toBe('custom');
  });
});
