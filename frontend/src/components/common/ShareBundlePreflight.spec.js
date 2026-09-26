import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ShareBundlePreflight from './ShareBundlePreflight.vue';

const manifest = (extra = {}) => ({
  totals: { files: 4, bytes: 3 * 1048576 },
  files: [
    { path: 'index.html', size: 100 }, { path: 'pic.png', size: 200 },
    { path: 'frames/001.png', size: 300 }, { path: 'data/x.json', size: 50 },
  ],
  sources: {
    'index.html': { kind: 'entry', reason: 'the entry' },
    'pic.png': { kind: 'reference', reason: 'referenced by index.html' },
    'frames/001.png': { kind: 'pattern', reason: 'matched by frames/*.png in index.html' },
    'data/x.json': { kind: 'folder', reason: 'in included folder site/data' },
  },
  warnings: [],
  ...extra,
});

describe('ShareBundlePreflight', () => {
  it('summarizes why every file is in the bundle', () => {
    const wrapper = mount(ShareBundlePreflight, { props: { manifest: manifest() } });
    expect(wrapper.find('.bp-counts').text()).toBe('1 entry · 1 referenced · 1 matched by a name pattern · 1 from included folders · 3.0 MB');
    const rows = wrapper.findAll('.bp-why li').map((row) => row.text());
    expect(rows[2]).toContain('frames/001.png');
    expect(rows[2]).toContain('matched by frames/*.png in index.html');
  });

  it('offers the suggested folder for a computed load, but not once it is included', async () => {
    const warning = { kind: 'runtime_load', file: 'index.html', detail: '1 load with a computed path, e.g. fetch(url)', folder: 'site/data' };
    const wrapper = mount(ShareBundlePreflight, { props: { manifest: manifest({ warnings: [warning] }) } });
    expect(wrapper.find('.bp-warnings').text()).toContain("can't be found by reading the page");
    await wrapper.find('.bp-warnings button').trigger('click');
    expect(wrapper.emitted('include-folder')).toEqual([['site/data']]);
    await wrapper.setProps({ includeDirs: ['site/data'] });
    expect(wrapper.find('.bp-warnings button').exists()).toBe(false);
  });

  it('removes an included folder and normalizes a typed one', async () => {
    const wrapper = mount(ShareBundlePreflight, { props: { manifest: manifest(), includeDirs: ['site/data'] } });
    await wrapper.find('.bp-chip button').trigger('click');
    expect(wrapper.emitted('remove-folder')).toEqual([['site/data']]);
    await wrapper.find('.bp-add input').setValue(' site\\frames/ ');
    await wrapper.find('.bp-add button').trigger('click');
    expect(wrapper.emitted('include-folder')).toEqual([['site/frames']]);
  });

  it('disables every action while a scan is running', () => {
    const warning = { kind: 'runtime_load', file: 'index.html', detail: 'x', folder: 'site' };
    const wrapper = mount(ShareBundlePreflight, { props: { manifest: manifest({ warnings: [warning] }), includeDirs: ['site/data'], busy: true } });
    for (const button of wrapper.findAll('button')) expect(button.attributes('disabled')).toBeDefined();
  });
});
