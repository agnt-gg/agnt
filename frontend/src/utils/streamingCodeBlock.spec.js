/**
 * Streaming code-block stability.
 *
 * This is the test that would have caught the "hard flashing while HTML streams" bug.
 * It drives the REAL pipeline (markdownPipeline) through the REAL directive
 * (morphHtmlDirective) with the REAL highlighter, at the same tick ratio the app uses
 * (66ms render throttle vs 300ms highlight debounce), and asserts on the two things
 * the user actually perceives:
 *
 *   1. The block must never lose its .hljs styling once it has it (each loss is a
 *      visible flash back to unstyled text).
 *   2. The block must not be re-tokenised over and over as it grows (that is the
 *      O(n^2) main-thread work that makes the flashing janky as well as ugly).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import morphdom from 'morphdom';
import hljs from 'highlight.js/lib/common';
import { renderMarkdown, HIGHLIGHTABLE_CODE_SELECTOR, STREAMING_ATTR } from './markdownPipeline.js';
import { shouldPreserve } from './morphHtmlDirective.js';

// morphdom reaches for the global HTMLElement; jsdom provides it on window.
beforeAll(() => {
  globalThis.HTMLElement = globalThis.HTMLElement || window.HTMLElement;
});

// The severity of the bug scales with block length (re-tokenisation is O(n^2)), so
// the fixture has to be the size of a real generated page, not a toy snippet.
const HTML_UNIT = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui; background: #1a1a2e; color: #e0e0e0; }
    .card { padding: 24px; border-radius: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Dashboard</h1>
    <p>Content with <strong>markup</strong> &amp; entities.</p>
  </div>
  <script>
    const data = [1, 2, 3];
    document.querySelector('h1').textContent = data.length;
  <\/script>
</body>
</html>
`;
const HTML_DOC = HTML_UNIT.repeat(6); // ~2.7KB, a modest generated page

const RENDER_TICK_CHARS = 28; // chars arriving per throttled render
const HIGHLIGHT_EVERY = 5; // 300ms debounce / 66ms render tick

/** Mirror of the directive's morph, minus the Vue binding plumbing. */
function morphInto(el, html) {
  const next = document.createElement(el.tagName);
  next.innerHTML = html;
  morphdom(el, next, {
    childrenOnly: true,
    onBeforeElUpdated(fromEl, toEl) {
      if (shouldPreserve(fromEl)) return false;
      if (fromEl.tagName === 'CODE' && fromEl.classList.contains('hljs') && fromEl.textContent === toEl.textContent) return false;
      return true;
    },
  });
}

/**
 * @param {string} selector  what highlightCode() queries for
 * @returns metrics describing what the user would see
 */
function streamMessage(selector) {
  const el = document.createElement('div');
  document.body.appendChild(el);

  let text = '';
  let tick = 0;
  let styleFlashes = 0; // .hljs present, then gone => visible restyle
  let highlightPasses = 0;
  let charsTokenised = 0;
  let detectedLanguages = new Set();

  const render = (streaming) => renderMarkdown('```html\n' + text + (streaming ? '' : '\n```'), { streaming });

  el.innerHTML = render(true);

  while (text.length < HTML_DOC.length) {
    text = HTML_DOC.slice(0, Math.min(text.length + RENDER_TICK_CHARS, HTML_DOC.length));
    tick++;

    const hadHljs = el.querySelector('code')?.classList.contains('hljs');
    morphInto(el, render(true));
    const hasHljs = el.querySelector('code')?.classList.contains('hljs');
    if (hadHljs && !hasHljs) styleFlashes++;

    if (tick % HIGHLIGHT_EVERY === 0) {
      el.querySelectorAll(selector).forEach((b) => {
        charsTokenised += b.textContent.length;
        highlightPasses++;
        hljs.highlightElement(b);
        detectedLanguages.add(b.className.match(/language-[\w-]+/)?.[0] || 'auto');
      });
    }
  }

  // Closing fence arrives — the block is final.
  morphInto(el, render(false));
  el.querySelectorAll('pre code:not(.hljs)').forEach((b) => {
    charsTokenised += b.textContent.length;
    highlightPasses++;
    hljs.highlightElement(b);
  });

  const code = el.querySelector('code');
  const result = {
    ticks: tick,
    styleFlashes,
    highlightPasses,
    charsTokenised,
    amplification: charsTokenised / HTML_DOC.length,
    languagesSeen: detectedLanguages.size,
    finalHighlighted: code.classList.contains('hljs'),
    finalText: code.textContent,
  };
  el.remove();
  return result;
}

describe('streaming code block', () => {
  const CURRENT = HIGHLIGHTABLE_CODE_SELECTOR; // the selector MessageItem actually ships

  it('the shipped selector excludes blocks that are still streaming', () => {
    // Pins the guard itself: deleting the :not([data-streaming]) clause from
    // HIGHLIGHTABLE_CODE_SELECTOR reintroduces the flash, so it must fail loudly.
    expect(HIGHLIGHTABLE_CODE_SELECTOR).toContain(`:not([${STREAMING_ATTR}])`);
    expect(HIGHLIGHTABLE_CODE_SELECTOR).toContain(':not(.hljs)');
  });

  it('never flashes: the highlighted block is never reverted to unstyled', () => {
    expect(streamMessage(CURRENT).styleFlashes).toBe(0);
  });

  it('tokenises the block exactly once, when the closing fence lands', () => {
    const m = streamMessage(CURRENT);
    expect(m.highlightPasses).toBe(1);
    expect(m.amplification).toBeCloseTo(1, 1);
  });

  it('ends up correctly highlighted with the text fully intact', () => {
    const m = streamMessage(CURRENT);
    expect(m.finalHighlighted).toBe(true);
    expect(m.finalText).toBe(HTML_DOC);
  });

  it('regression guard: without the data-streaming skip the block flashes repeatedly', () => {
    // This is the pre-fix selector. Keeping it asserted here means the fix cannot be
    // silently reverted — if someone drops :not([data-streaming]) this test tells them
    // exactly what they reintroduced.
    const broken = streamMessage('pre code:not(.hljs)');
    // Every highlight pass but the last is undone by the next morph — that is the flash.
    expect(broken.styleFlashes).toBeGreaterThanOrEqual(broken.highlightPasses - 1);
    expect(broken.styleFlashes).toBeGreaterThan(5);
    expect(broken.amplification).toBeGreaterThan(5);
  });

  it('is dramatically cheaper than the pre-fix behaviour', () => {
    const fixed = streamMessage(CURRENT);
    const broken = streamMessage('pre code:not(.hljs)');
    expect(fixed.charsTokenised).toBeLessThan(broken.charsTokenised / 5);
  });
});
