import { describe, it, expect } from 'vitest';
import { renderMarkdown, STREAMING_ATTR } from './markdownPipeline.js';

const HTML_DOC = `<!DOCTYPE html>
<html>
<head><style>body{background:#1a1a2e}</style></head>
<body><h1>Hi</h1></body>
</html>`;

describe('markdownPipeline — closed fences', () => {
  it('renders a closed block with its language class and no streaming marker', () => {
    const out = renderMarkdown('Here:\n\n```html\n<div>x</div>\n```\n', { streaming: true });
    expect(out).toContain('language-html');
    expect(out).not.toContain(STREAMING_ATTR);
  });

  it('escapes block content so markup is shown, not executed', () => {
    const out = renderMarkdown('```html\n<script>alert(1)<\/script>\n```', {});
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>alert');
  });

  it('keeps nested fences inside the outer block', () => {
    const out = renderMarkdown('````markdown\n```bash\nls\n```\n````', {});
    expect(out).toContain('language-markdown');
    expect(out).toContain('```bash');
    expect(out).not.toContain('language-bash');
  });

  it('still produces viz containers for chartjs/d3/threejs/mermaid', () => {
    expect(renderMarkdown('```chartjs\n{"type":"bar"}\n```', {})).toContain('chartjs-container');
    expect(renderMarkdown('```d3\nx\n```', {})).toContain('d3-container');
    expect(renderMarkdown('```threejs\nx\n```', {})).toContain('threejs-container');
    expect(renderMarkdown('```mermaid\ngraph TD\n```', {})).toContain('mermaid-container');
  });

  it('leaves ordinary markdown alone', () => {
    const out = renderMarkdown('# Title\n\n**bold** and `code`', {});
    expect(out).toContain('<h1');
    expect(out).toContain('<strong>bold</strong>');
  });

  it('wraps display math in a stable .math-container', () => {
    const out = renderMarkdown('$$a^2 + b^2 = c^2$$', {});
    expect(out).toContain('math-container');
    expect(out).toMatch(/id="math-[a-z0-9]+-0"/);
  });
});

describe('markdownPipeline — unclosed fences while streaming', () => {
  const partial = '```html\n' + HTML_DOC.slice(0, 60);

  it('marks the block so the renderer can skip highlighting it', () => {
    const out = renderMarkdown(partial, { streaming: true });
    expect(out).toContain(`${STREAMING_ATTR}="true"`);
  });

  it('keeps the declared language instead of forcing hljs auto-detection', () => {
    // The old incomplete-fence path emitted a bare <pre><code> with no class,
    // which made highlight.js scan every registered grammar on every tick.
    const out = renderMarkdown(partial, { streaming: true });
    expect(out).toContain('language-html');
  });

  it('does not leak the literal ```lang line into the rendered block', () => {
    const out = renderMarkdown(partial, { streaming: true });
    expect(out).not.toContain('```html');
    expect(out).not.toContain('```');
  });

  it('treats an unterminated block as final once streaming is over', () => {
    const out = renderMarkdown(partial, { streaming: false });
    expect(out).not.toContain(STREAMING_ATTR);
    expect(out).toContain('language-html');
  });

  it('marks an unclosed block with no language too', () => {
    const out = renderMarkdown('```\nsome text', { streaming: true });
    expect(out).toContain(`${STREAMING_ATTR}="true"`);
  });

  it('emits monotonically growing content as the block streams in', () => {
    let prevLen = 0;
    for (let n = 10; n <= HTML_DOC.length; n += 10) {
      const out = renderMarkdown('```html\n' + HTML_DOC.slice(0, n), { streaming: true });
      const body = out.slice(out.indexOf('>', out.indexOf('<code')) + 1, out.indexOf('</code>'));
      expect(body.length).toBeGreaterThanOrEqual(prevLen);
      prevLen = body.length;
    }
  });

  it('renders text before the open fence as normal markdown', () => {
    const out = renderMarkdown('Some **intro**.\n\n```html\n<div>', { streaming: true });
    expect(out).toContain('<strong>intro</strong>');
    expect(out).toContain(`${STREAMING_ATTR}="true"`);
  });
});

describe('markdownPipeline — resilience', () => {
  it('returns escaped text rather than throwing on non-string input', () => {
    expect(() => renderMarkdown('', {})).not.toThrow();
    expect(renderMarkdown('', {})).toBe('');
  });

  it('restores console.error even when showdown throws', () => {
    const original = console.error;
    renderMarkdown('a'.repeat(100), {});
    expect(console.error).toBe(original);
  });

  it('is deterministic — same input, same output', () => {
    const input = '```html\n<div>x</div>\n```\n\n$$x^2$$';
    expect(renderMarkdown(input, {})).toBe(renderMarkdown(input, {}));
  });
});
