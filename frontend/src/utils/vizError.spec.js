import { describe, it, expect } from 'vitest';
import { escapeHtml, vizErrorHtml } from './vizError';

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">'))
      .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("it's & <b>")).toBe('it&#39;s &amp; &lt;b&gt;');
  });

  it('escapes the ampersand first so entities are not double-produced', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('handles null, undefined and non-strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('usable \u03C4 (complex fixed field)')).toBe('usable \u03C4 (complex fixed field)');
  });
});

describe('vizErrorHtml', () => {
  it('renders the title and message', () => {
    const html = vizErrorHtml('D3 Render Failed', 'd3 is not defined');
    expect(html).toContain('D3 Render Failed');
    expect(html).toContain('d3 is not defined');
  });

  it('escapes a hostile message', () => {
    const html = vizErrorHtml('X', '<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a hostile title', () => {
    const html = vizErrorHtml('<img onerror=1>', 'boom');
    expect(html).not.toContain('<img onerror');
  });

  it('escapes a hostile source block', () => {
    const html = vizErrorHtml('X', 'boom', '<iframe src=javascript:1>');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('&lt;iframe');
  });

  it('omits the source block when no source is given', () => {
    expect(vizErrorHtml('X', 'boom')).not.toContain('<pre');
    expect(vizErrorHtml('X', 'boom', '   ')).not.toContain('<pre');
  });

  it('includes the source block when a source is given', () => {
    expect(vizErrorHtml('X', 'boom', '{"type":"bar"}')).toContain('<pre');
  });

  it('produces markup whose only tags are the ones it builds', () => {
    const html = vizErrorHtml('<b>t</b>', '<i>m</i>', '<u>s</u>');
    const tags = (html.match(/<[a-z/][^>]*>/gi) || []).map((t) => t.replace(/\s[\s\S]*$/, '').replace(/[<>]/g, ''));
    expect(new Set(tags)).toEqual(new Set(['div', 'strong', '/strong', 'br', 'span', '/span', 'pre', '/pre', '/div']));
  });
});
