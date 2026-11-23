import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MkFiles from './MkFiles.vue';
import { getTree } from '@/services/fileSystemService.js';

vi.mock('@/services/fileSystemService.js', () => ({ getTree: vi.fn() }));

const listing = (...items) => ({ items });
const folder = (path) => ({ name: path.split('/').pop(), type: 'directory', path });
const file = (path, extra = {}) => ({ name: path.split('/').pop(), type: 'file', path, size: 2048, ...extra });

function mountFiles(dir = '') {
  const ctx = { go: vi.fn(), openLibrary: vi.fn() };
  const wrapper = mount(MkFiles, { props: { dir }, global: { provide: { teamCtx: ctx } } });
  return { wrapper, ctx };
}
const names = (wrapper) => wrapper.findAll('.cards .card h4').map((el) => el.text());

beforeEach(() => {
  getTree.mockReset();
  localStorage.clear();
});

describe('Library › Files', () => {
  it('lists the top of the workspace, folders first', async () => {
    getTree.mockResolvedValue(listing(file('notes.md'), folder('Reports'), file('a.png')));
    const { wrapper } = mountFiles();
    expect(wrapper.find('.list .empty').text()).toBe('Loading…');
    await flushPromises();
    expect(getTree).toHaveBeenCalledWith('', { details: true });
    expect(names(wrapper)).toEqual(['Reports', 'a.png', 'notes.md']);
    expect(wrapper.find('.cards .card p').text()).toBe('Folder');
    expect(wrapper.findAll('.cards .card')[1].find('.v2-card-meta').text()).toMatch(/^2\.0 KB/);
    expect(wrapper.find('nav.crumbs').exists()).toBe(false);
  });

  it('opens a folder in place and a file in its viewer', async () => {
    getTree.mockResolvedValue(listing(folder('Reports'), file('notes.md')));
    const { wrapper, ctx } = mountFiles();
    await flushPromises();
    const [reports, notes] = wrapper.findAll('.cards .card');
    await reports.trigger('click');
    expect(ctx.go).toHaveBeenCalledWith({ view: 'library', tab: 'files', dir: 'Reports' });
    await notes.trigger('click');
    expect(ctx.openLibrary).toHaveBeenCalledWith('files', 'notes.md');
  });

  it('a subfolder lists itself, with crumbs back up', async () => {
    getTree.mockResolvedValue(listing(file('Reports/2026/q4.pdf')));
    const { wrapper, ctx } = mountFiles('Reports/2026');
    await flushPromises();
    expect(getTree).toHaveBeenCalledWith('Reports/2026', { details: true });
    const crumbs = wrapper.find('nav.crumbs');
    expect(crumbs.findAll('button').map((b) => b.text())).toEqual(['Files', 'Reports']);
    expect(crumbs.find('b').text()).toBe('2026');
    await crumbs.findAll('button')[1].trigger('click');
    expect(ctx.go).toHaveBeenLastCalledWith({ view: 'library', tab: 'files', dir: 'Reports' });
    await crumbs.findAll('button')[0].trigger('click');
    expect(ctx.go).toHaveBeenLastCalledWith({ view: 'library', tab: 'files', dir: '' });
  });

  it('search narrows the folder; a big folder shows its first 300', async () => {
    const many = Array.from({ length: 305 }, (_, i) => file(`f${String(i).padStart(3, '0')}.txt`));
    getTree.mockResolvedValue(listing(...many, file('budget.xlsx')));
    const { wrapper } = mountFiles();
    await flushPromises();
    expect(wrapper.findAll('.cards .card')).toHaveLength(300);
    expect(wrapper.text()).toContain('Showing 300 of 306. Search to find the rest.');
    await wrapper.find('input[type="search"]').setValue('budget');
    expect(names(wrapper)).toEqual(['budget.xlsx']);
    expect(wrapper.text()).not.toContain('Showing');
    await wrapper.find('input[type="search"]').setValue('zzz');
    expect(wrapper.find('.list .empty').text()).toBe('Nothing here matches “zzz”.');
  });

  it('sorts by date when asked, in the order the Files page remembers', async () => {
    getTree.mockResolvedValue(listing(file('a-old.md', { modifiedAt: 1000 }), file('b-new.md', { modifiedAt: 2000 })));
    const { wrapper } = mountFiles();
    await flushPromises();
    expect(names(wrapper)).toEqual(['a-old.md', 'b-new.md']);
    await wrapper.findAll('.seg button').find((b) => b.text() === 'Date').trigger('click');
    expect(names(wrapper)).toEqual(['b-new.md', 'a-old.md']);
    expect(localStorage.getItem('agnt:focused-files-sort')).toBe('date');
    expect(mountFiles().wrapper.find('.seg button.on').text()).toBe('Date');
  });

  it('says so when the folder cannot be opened', async () => {
    getTree.mockRejectedValue(new Error('Failed to fetch tree: Not Found'));
    const { wrapper } = mountFiles('gone');
    await flushPromises();
    expect(wrapper.find('.list .empty').text()).toBe('Couldn’t open this folder. Failed to fetch tree: Not Found');
    expect(wrapper.findAll('.cards .card')).toHaveLength(0);
  });

  it('shows the folder it is on, even when the folder before it answers late', async () => {
    let answerFirst;
    getTree.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    getTree.mockResolvedValueOnce(listing(file('b/second.md')));
    const { wrapper } = mountFiles('a');
    await wrapper.setProps({ dir: 'b' });
    await flushPromises();
    answerFirst(listing(file('a/first.md')));
    await flushPromises();
    expect(names(wrapper)).toEqual(['second.md']);
    expect(wrapper.find('.list .empty').exists()).toBe(false);
  });
});
