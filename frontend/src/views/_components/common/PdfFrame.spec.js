import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PdfFrame from './PdfFrame.vue';

// jsdom cannot paint a PDF, so it cannot see the real failure (a blank frame).
// What it CAN pin is the attribute that causes it: Chromium refuses to run its
// PDF viewer in any sandboxed frame. The pixel-level proof lives in
// tests/live/pdf-frame-electron.mjs.
describe('PdfFrame', () => {
  it('is never sandboxed — a sandboxed frame renders PDFs blank', () => {
    const w = mount(PdfFrame, { props: { src: 'http://h/api/local-file/C:/a.pdf', label: 'a.pdf' } });
    const frame = w.find('iframe');
    expect(frame.attributes()).not.toHaveProperty('sandbox');
    expect(frame.attributes('src')).toBe('http://h/api/local-file/C:/a.pdf');
    expect(frame.attributes('aria-label')).toBe('a.pdf');
  });

  it('passes class and listeners through to the iframe', async () => {
    let loads = 0;
    const w = mount(PdfFrame, { props: { src: 'x.pdf' }, attrs: { class: 'ap-frame', tabindex: '-1', onLoad: () => { loads += 1; } } });
    expect(w.find('iframe').classes()).toContain('ap-frame');
    expect(w.find('iframe').attributes('tabindex')).toBe('-1');
    await w.find('iframe').trigger('load');
    expect(loads).toBe(1);
  });

  it('omits src rather than loading the app page into the frame when there is no URL yet', () => {
    const w = mount(PdfFrame, { props: { src: '' } });
    expect(w.find('iframe').attributes()).not.toHaveProperty('src');
  });
});

// Three surfaces drifted into sandboxed PDF frames independently; one stayed
// correct only by accident. Every PDF preview goes through PdfFrame, so a raw
// <iframe> whose condition mentions pdf is the regression, wherever it is.
describe('PDF previews go through PdfFrame', () => {
  const sources = import.meta.glob('/src/**/*.vue', { query: '?raw', import: 'default', eager: true });

  it('no component renders a PDF with a raw <iframe>', () => {
    const offenders = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const tag of source.match(/<iframe\b[^>]*>/gi) || []) {
        if (/v-(else-)?if="[^"]*pdf/i.test(tag)) offenders.push(`${file}: ${tag}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scan actually sees the app (guards against a glob that matches nothing)', () => {
    expect(Object.keys(sources).some((f) => f.endsWith('/ArtifactInspector.vue'))).toBe(true);
  });
});
