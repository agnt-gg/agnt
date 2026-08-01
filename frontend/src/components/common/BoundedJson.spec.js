import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import BoundedJson, { defaultSerialize, countLines, formatBytes } from './BoundedJson.vue';

const text = (w) => w.find('pre').text();

describe('BoundedJson — pure helpers', () => {
  it('serializes strings verbatim and objects as pretty JSON', () => {
    expect(defaultSerialize('hello')).toBe('hello');
    expect(defaultSerialize({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(defaultSerialize(null)).toBe('');
    expect(defaultSerialize(undefined)).toBe('');
  });

  it('survives circular structures instead of throwing', () => {
    const circular = { name: 'x' };
    circular.self = circular;
    expect(() => defaultSerialize(circular)).not.toThrow();
    expect(defaultSerialize(circular)).toContain('object');
  });

  it('counts lines without allocating an array', () => {
    expect(countLines('')).toBe(1);
    expect(countLines('a\nb\nc')).toBe(3);
    expect(countLines('a\n')).toBe(2);
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('BoundedJson — small payloads are untouched', () => {
  it('renders a short payload in full with no toolbar', () => {
    const w = mount(BoundedJson, { props: { value: { ok: true } } });
    expect(text(w)).toBe('{\n  "ok": true\n}');
    expect(w.find('.bj-bar').exists()).toBe(false);
    expect(text(w)).not.toContain('truncated');
  });

  it('renders a plain string payload without JSON quoting', () => {
    const w = mount(BoundedJson, { props: { value: 'boom: it failed' } });
    expect(text(w)).toBe('boom: it failed');
  });
});

describe('BoundedJson — the bounded-render invariant', () => {
  const HUGE = 'x'.repeat(5_000_000); // 5 MB, i.e. Nathan's "million lines"

  it('never puts more than previewChars in the DOM when collapsed', () => {
    const w = mount(BoundedJson, { props: { value: HUGE, previewChars: 2000 } });
    const rendered = text(w);
    expect(rendered.length).toBeLessThan(2000 + 64);
    expect(rendered).toContain('[clipped for display]');
  });

  it('never puts more than maxRenderChars in the DOM when expanded', async () => {
    const w = mount(BoundedJson, {
      props: { value: HUGE, previewChars: 2000, maxRenderChars: 50000 },
    });
    await w.findAll('.bj-btn')[0].trigger('click'); // Expand
    const rendered = text(w);
    expect(rendered.length).toBeGreaterThan(2000);
    expect(rendered.length).toBeLessThan(50000 + 64);
    expect(rendered).toContain('[clipped for display]');
  });

  it('is bounded even when a caller hands it an uncapped serializer', () => {
    // The invariant must not depend on callers behaving. This is the guard
    // against a future surface re-introducing an unbounded dump.
    const w = mount(BoundedJson, {
      props: { value: null, serializer: () => HUGE, maxRenderChars: 10000 },
    });
    expect(text(w).length).toBeLessThan(10000 + 64);
  });

  it('reports real size and line count of the full payload, not the shown slice', () => {
    const w = mount(BoundedJson, { props: { value: 'a\n'.repeat(100000), previewChars: 100 } });
    expect(w.find('.bj-meta').text()).toContain('lines');
    expect(w.find('.bj-meta').text()).toMatch(/100,001 lines/);
  });

  it('shows an Expand affordance exactly when content is clipped', async () => {
    const small = mount(BoundedJson, { props: { value: 'short', previewChars: 2000 } });
    expect(small.find('.bj-bar').exists()).toBe(false);

    const big = mount(BoundedJson, { props: { value: 'y'.repeat(5000), previewChars: 2000 } });
    const btns = big.findAll('.bj-btn').map((b) => b.text());
    expect(btns).toContain('Expand');
    await big.findAll('.bj-btn')[0].trigger('click');
    expect(big.findAll('.bj-btn')[0].text()).toBe('Collapse');
  });

  it('re-collapses when the payload changes', async () => {
    const w = mount(BoundedJson, { props: { value: 'y'.repeat(5000), previewChars: 100 } });
    await w.findAll('.bj-btn')[0].trigger('click');
    expect(w.findAll('.bj-btn')[0].text()).toBe('Collapse');
    await w.setProps({ value: 'z'.repeat(5000) });
    expect(w.findAll('.bj-btn')[0].text()).toBe('Expand');
  });
});

describe('BoundedJson — nothing is unreachable', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('copies the FULL payload, not the clipped view', async () => {
    const serializer = vi.fn((v, { full }) => (full ? 'FULL-PAYLOAD' : 'x'.repeat(9999)));
    const w = mount(BoundedJson, { props: { value: {}, serializer, previewChars: 100 } });

    expect(text(w).length).toBeLessThan(200);
    const copyBtn = w.findAll('.bj-btn').find((b) => b.text() === 'Copy all');
    await copyBtn.trigger('click');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('FULL-PAYLOAD');
  });

  it('downloads the FULL payload via a blob', async () => {
    const createURL = vi.fn(() => 'blob:fake');
    global.URL.createObjectURL = createURL;
    global.URL.revokeObjectURL = vi.fn();
    // jsdom logs "Not implemented: navigation" on a real anchor click.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const serializer = vi.fn((v, { full }) => (full ? 'FULL-PAYLOAD' : 'small'));

    const w = mount(BoundedJson, {
      props: { value: {}, serializer, previewChars: 1, filename: 'out.json' },
    });
    const dl = w.findAll('.bj-btn').find((b) => b.text() === 'Download');
    await dl.trigger('click');

    expect(createURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(serializer).toHaveBeenCalledWith({}, { full: true });
    clickSpy.mockRestore();
  });

  it('does not compute the full payload until asked', () => {
    const serializer = vi.fn((v, { full }) => (full ? 'FULL' : 'preview'));
    mount(BoundedJson, { props: { value: {}, serializer } });
    expect(serializer.mock.calls.every(([, o]) => o.full === false)).toBe(true);
  });
});

describe('BoundedJson — payloads cannot inject markup', () => {
  it('escapes HTML in tool output instead of rendering it', () => {
    // Regression: these <pre> blocks previously used v-html on raw
    // JSON.stringify output, which does not escape < or >.
    const w = mount(BoundedJson, {
      props: { value: { note: '<img src=x onerror="window.__pwned=1">' } },
    });
    expect(w.find('img').exists()).toBe(false);
    expect(text(w)).toContain('<img src=x onerror=');
  });

  it('escapes markup in error strings', () => {
    const w = mount(BoundedJson, { props: { value: '<script>bad()</script>', tone: 'error' } });
    expect(w.find('script').exists()).toBe(false);
    expect(text(w)).toContain('<script>bad()</script>');
  });
});

describe('BoundedJson — serialization is memoized', () => {
  it('does not re-serialize on unrelated parent re-renders', async () => {
    const serializer = vi.fn(() => 'stable');
    const w = mount(BoundedJson, { props: { value: { a: 1 }, serializer, tone: 'result' } });
    const initial = serializer.mock.calls.length;

    await w.setProps({ tone: 'params' });
    await w.setProps({ filename: 'other.json' });

    expect(serializer.mock.calls.length).toBe(initial);
  });
});

describe('BoundedJson — panel appearance is unchanged', () => {
  // These blocks were <pre class="io-data">. Panel CSS cannot reach inside a
  // child component (a parent's scoped styles only apply to the child's ROOT),
  // so .bj-pre restates the .io-data rule verbatim. Pinned because a previous
  // attempt restyled these blocks while "just" adding a cap.
  const source = readFileSync('src/components/common/BoundedJson.vue', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const start = source.indexOf(`\n${selector} {`);
    return start === -1 ? null : source.slice(start, source.indexOf('}', start));
  };

  it('matches the .io-data rule it replaced', () => {
    const pre = rule('.bj-pre');
    expect(pre).toMatch(/font-size: var\(--font-size-xs\);/);
    expect(pre).toMatch(/background: var\(--color-darker-0\);/);
    expect(pre).toMatch(/padding: 10px;/);
    expect(pre).toMatch(/max-height: 250px;/);
  });

  it('renders plain text, with no code element', () => {
    const wrapper = mount(BoundedJson, { props: { value: { a: 1 } } });
    expect(wrapper.find('code').exists()).toBe(false);
    expect(wrapper.find('pre').text()).toContain('"a": 1');
  });
});
