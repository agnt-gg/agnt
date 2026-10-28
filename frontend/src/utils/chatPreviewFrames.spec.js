import { describe, it, expect } from 'vitest';
import { API_CONFIG } from '@/tt.config.js';
import { PREVIEW_SRC_ATTR, holdPreviewFrameSource, heldPreviewSource } from './chatPreviewFrames.js';
import { isLocalPreviewUrl } from './localFileUrl.js';

const api = API_CONFIG.BASE_URL.replace(/\/$/, '');
const element = (html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild;
};

describe('holding a chat preview frame until it is placed', () => {
  it.each([
    ['a local preview', `${api}/local-preview/C:/work/page.html`, `${api}/local-preview/C:/work/page.html`],
    ['a raw local file, held as its preview', `${api}/local-file/C:/work/page.html`, `${api}/local-preview/C:/work/page.html`],
  ])('holds %s in data-preview-src with no src', (_label, src, held) => {
    const frame = element(`<iframe src="${src}"></iframe>`);
    holdPreviewFrameSource(frame);
    expect(frame.hasAttribute('src')).toBe(false);
    expect(frame.getAttribute(PREVIEW_SRC_ATTR)).toBe(held);
    expect(heldPreviewSource(frame)).toBe(held);
  });

  it('leaves a remote embed live', () => {
    const frame = element('<iframe src="https://www.youtube.com/embed/abc"></iframe>');
    holdPreviewFrameSource(frame);
    expect(frame.getAttribute('src')).toBe('https://www.youtube.com/embed/abc');
    expect(frame.hasAttribute(PREVIEW_SRC_ATTR)).toBe(false);
  });

  it('drops an author-written data-preview-src on any element', () => {
    const div = element('<div data-preview-src="javascript:alert(1)"></div>');
    holdPreviewFrameSource(div);
    expect(div.hasAttribute(PREVIEW_SRC_ATTR)).toBe(false);
    const frame = element('<iframe data-preview-src="https://evil.example/x.html"></iframe>');
    holdPreviewFrameSource(frame);
    expect(frame.hasAttribute(PREVIEW_SRC_ATTR)).toBe(false);
    expect(frame.hasAttribute('src')).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'https://evil.example/api/local-preview/C:/x.html',
    `${api}/local-file/C:/x.html`,
    `${api}/settings`,
  ])('never releases %s as a frame URL', (value) => {
    const frame = document.createElement('iframe');
    frame.setAttribute(PREVIEW_SRC_ATTR, value);
    expect(heldPreviewSource(frame)).toBe('');
  });
});

describe('isLocalPreviewUrl', () => {
  it('accepts only same-origin URLs under the API preview route', () => {
    expect(isLocalPreviewUrl(`${api}/local-preview/C:/x.html?__agnt_preview=abc#view`)).toBe(true);
    expect(isLocalPreviewUrl(`${api}/local-previewer/C:/x.html`)).toBe(false);
    expect(isLocalPreviewUrl('http://127.0.0.2:1/api/local-preview/C:/x.html')).toBe(false);
    expect(isLocalPreviewUrl('not a url at all ::')).toBe(false);
  });
});
