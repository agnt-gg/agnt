import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('@/utils/openLocalFile.js', () => ({ openLocalPath: vi.fn(() => true) }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

import ArtifactPreview from './ArtifactPreview.vue';
import { openLocalPath } from '@/utils/openLocalFile.js';

const mountIt = () => mount(ArtifactPreview, { attachTo: document.body });
const dialog = () => document.body.querySelector('.ap-dialog');

/** Let show()'s probe() and any follow-up body fetch settle. */
const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

/** A server that finds the file exactly where it was asked for. */
const servesFrom = (resolvedPath, { ok = true, status = 206 } = {}) =>
  vi.fn(async () => ({
    ok,
    status,
    headers: { get: (h) => (h === 'X-Local-File-Path' && resolvedPath ? resolvedPath : null) },
    text: async () => 'hello file',
  }));

describe('ArtifactPreview — see the file, stay on the page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.fetch = servesFrom('C:/Users/x/report.html');
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
    global.fetch = servesFrom('C:/x/notes.md');
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/notes.md', name: 'notes.md' });
    await settle();
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3333/api/local-file/C:/x/notes.md', expect.any(Object));
    expect(dialog().querySelector('pre.ap-text').textContent).toBe('hello file');
    w.unmount();
  });

  it('unknown kinds offer the system opener instead of a broken frame', async () => {
    global.fetch = servesFrom('C:/x/model.blend');
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/model.blend', name: 'model.blend' });
    await settle();
    expect(dialog().querySelector('.ap-none')).not.toBeNull();
    dialog().querySelector('.ap-none .ap-btn').click();
    expect(openLocalPath).toHaveBeenCalledWith('C:/x/model.blend');
    w.unmount();
  });

  it('"Open in Files" closes and hands the artifact up; × closes', async () => {
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/a.html', name: 'a.html' });
    await nextTick();
    dialog().querySelectorAll('.ap-link')[0].click();
    await nextTick();
    expect(w.emitted('open-in-files')[0][0]).toEqual({ href: 'file:///C:/x/a.html', name: 'a.html' });
    expect(dialog()).toBeNull();
    w.vm.show({ href: 'file:///C:/x/a.html', name: 'a.html' });
    await nextTick();
    dialog().querySelector('.ap-x').click();
    await nextTick();
    expect(dialog()).toBeNull();
    w.unmount();
  });
});

describe('ArtifactPreview — the recorded path went stale', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('THE BUG: a reaped-worktree path still previews, from wherever the server found it', async () => {
    const stale = 'file:///C:/repos/agnt-server.wt/social-metadata/agnt.gg/public/assets/social/card.png';
    global.fetch = servesFrom('C:/repos/agnt-server/agnt.gg/public/assets/social/card.png');

    const w = mountIt();
    w.vm.show({ href: stale, name: 'card.png' });
    await settle();

    // The image still renders — the server does the recovering, so the src is
    // the requested path and the bytes come back anyway.
    expect(dialog().querySelector('img.ap-media')).not.toBeNull();
    expect(dialog().querySelector('.ap-none')).toBeNull();
    // …and the overlay now knows where the file REALLY is.
    expect(dialog().querySelector('.ap-moved')).not.toBeNull();
    dialog().querySelectorAll('.ap-link')[1].click();
    expect(openLocalPath).toHaveBeenCalledWith('C:/repos/agnt-server/agnt.gg/public/assets/social/card.png');
    w.unmount();
  });

  it('no "moved" badge when the file was exactly where the message said', async () => {
    global.fetch = servesFrom('C:/x/pic.png');
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/pic.png', name: 'pic.png' });
    await settle();
    expect(dialog().querySelector('.ap-moved')).toBeNull();
    w.unmount();
  });

  it('says so plainly when the file truly cannot be found, instead of a broken image', async () => {
    global.fetch = servesFrom('', { ok: false, status: 404 });
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/gone/pic.png', name: 'pic.png' });
    await settle();

    expect(dialog().querySelector('img.ap-media')).toBeNull();
    const panel = dialog().querySelector('.ap-none');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('no longer where this message recorded it');
    expect(panel.querySelector('.ap-path').textContent).toBe('C:/gone/pic.png');
    w.unmount();
  });

  it('an empty file (416, unsatisfiable range) counts as found, not missing', async () => {
    global.fetch = servesFrom('C:/x/empty.png', { ok: false, status: 416 });
    const w = mountIt();
    w.vm.show({ href: 'file:///C:/x/empty.png', name: 'empty.png' });
    await settle();
    expect(dialog().querySelector('.ap-none')).toBeNull();
    expect(dialog().querySelector('img.ap-media')).not.toBeNull();
    w.unmount();
  });
});
