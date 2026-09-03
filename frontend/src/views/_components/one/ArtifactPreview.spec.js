import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('@/utils/openLocalFile.js', () => ({ openLocalPath: vi.fn(() => true) }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

import ArtifactPreview from './ArtifactPreview.vue';
import { openLocalPath } from '@/utils/openLocalFile.js';

const mountIt = () => mount(ArtifactPreview, { attachTo: document.body });
const dialog = () => document.body.querySelector('.ap-dialog');

describe('ArtifactPreview — see the file, stay on the page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.fetch = vi.fn(async () => ({ text: async () => 'hello file' }));
  });

  it('is closed until show(), then previews HTML in an iframe pointed at /api/local-file', async () => {
    const w = mountIt();
    expect(dialog()).toBeNull();
    w.vm.show({ href: 'file:///C:/Users/x/report.html', name: 'report.html' });
    await nextTick();
    const f = dialog().querySelector('iframe.ap-frame');
    expect(f).not.toBeNull();
    expect(f.getAttribute('src')).toBe('http://localhost:3333/api/local-file/C:/Users/x/report.html');
    expect(dialog().querySelector('.ap-name').textContent).toBe('report.html');
    w.unmount();
  });

  it.each([
    ['photo.PNG', 'img.ap-media'],
    ['clip.mp4', 'video.ap-media'],
    ['track.mp3', 'audio.ap-audio'],
    ['doc.pdf', 'iframe.ap-frame'],
  ])('%s renders with the native element', async (name, sel) => {
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/' + name, name });
    await nextTick();
    expect(dialog().querySelector(sel)).not.toBeNull();
    w.unmount();
  });

  it('text-like files are fetched and shown in a <pre>', async () => {
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/notes.md', name: 'notes.md' });
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3333/api/local-file/C:/x/notes.md', expect.any(Object));
    expect(dialog().querySelector('pre.ap-text').textContent).toBe('hello file');
    w.unmount();
  });

  it('unknown kinds offer the system opener instead of a broken frame', async () => {
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/model.blend', name: 'model.blend' });
    await nextTick();
    expect(dialog().querySelector('.ap-none')).not.toBeNull();
    dialog().querySelector('.ap-none .ap-btn').click();
    expect(openLocalPath).toHaveBeenCalledWith('C:/x/model.blend');
    w.unmount();
  });

  it('"Open in Outputs" closes and hands the artifact up; × closes', async () => {
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/a.html', name: 'a.html' });
    await nextTick();
    dialog().querySelectorAll('.ap-link')[0].click();
    await nextTick();
    expect(w.emitted('open-in-outputs')[0][0]).toEqual({ href: 'file:///C:/x/a.html', name: 'a.html' });
    expect(dialog()).toBeNull();
    w.vm.show({ href: 'file:///C:/x/a.html', name: 'a.html' });
    await nextTick();
    dialog().querySelector('.ap-x').click();
    await nextTick();
    expect(dialog()).toBeNull();
    w.unmount();
  });
});
