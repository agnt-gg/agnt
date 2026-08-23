/**
 * markdownPipeline.js
 *
 * The chat markdown -> HTML pipeline, lifted out of MessageItem.vue so it can be
 * unit-tested on its own. Pure string -> string: no DOM, no Vue, no side effects.
 *
 * Order matters:
 *   1. extractFencedBlocks  - pull outermost fenced blocks out (showdown cannot
 *                             handle nested fences), leaving <!--CBLKn--> markers.
 *   2. protectMath          - hide math from showdown, which eats backslashes.
 *   3. showdown.makeHtml    - markdown -> HTML for everything that is left.
 *   4. restoreMath          - put math back inside stable .math-container nodes.
 *   5. restoreFencedBlocks  - put code back as <pre><code> / viz containers.
 *
 * STREAMING CONTRACT
 * ------------------
 * While a message is still streaming, a code block's closing fence has not arrived
 * yet. Those blocks are emitted with data-streaming="true" so the renderer can
 * refuse to run highlight.js on them. That marker exists because highlighting a
 * block that is still growing caused two real defects:
 *
 *   1. highlight.js mutates the DOM out of band - it adds the .hljs class and
 *      replaces the text node with token spans. The next morphdom patch reconciles
 *      against freshly rendered HTML that has neither, so .hljs is stripped and the
 *      block snaps back to unstyled. At a 66ms render tick against a 300ms
 *      highlight debounce that is a visible styled/unstyled flash several times a
 *      second, for the whole duration of the block.
 *   2. Re-tokenising the entire block on every debounce tick is O(n^2) in the
 *      block's length, all of it on the main thread.
 *
 * Highlighting a block that is still growing is wasted work in every case, so the
 * pipeline labels those blocks and the renderer highlights once, on close.
 */
import showdown from 'showdown';

export const STREAMING_ATTR = 'data-streaming';

/**
 * The selector the renderer must use to find code blocks that are ready for
 * highlight.js: not already highlighted, and not still being written.
 *
 * It lives here, next to STREAMING_ATTR, so the marker and the thing that honours
 * it cannot drift apart — and so a test can pin it. Dropping the
 * :not([data-streaming]) clause reintroduces the streaming flash.
 */
export const HIGHLIGHTABLE_CODE_SELECTOR = `pre code:not(.hljs):not([${STREAMING_ATTR}])`;

// Simple showdown converter like in response.js
const markdownConverter = new showdown.Converter({
  tables: true,
  strikethrough: true,
  literalMidWordUnderscores: true,
  omitExtraWLInCodeBlocks: false,
  simpleLineBreaks: true,
  ghCodeBlocks: true,
  preserveIndent: true,
  extensions: [
    function () {
      return [
        {
          type: 'output',
          filter: function (text) {
            // Simple hash for deterministic IDs from content
            const hashCode = (s) => {
              let h = 0;
              for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h + s.charCodeAt(i)) | 0;
              }
              return Math.abs(h).toString(36);
            };

            // Convert ```chartjs code blocks into chart containers
            let blockIndex = 0;
            let result = text.replace(/<pre><code class="[^"]*language-chartjs[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, config) => {
              const id = 'chart-' + hashCode(config) + '-' + blockIndex++;
              return `<div class="chartjs-container" data-chart-id="${id}"><canvas id="${id}"></canvas><code class="chartjs-config" style="display:none">${config}</code></div>`;
            });
            // Convert ```d3 code blocks into D3 containers
            result = result.replace(/<pre><code class="[^"]*language-d3[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
              const id = 'd3-' + hashCode(code) + '-' + blockIndex++;
              return `<div class="d3-container" data-d3-id="${id}"><code class="d3-code" style="display:none">${code}</code></div>`;
            });
            // Convert ```threejs code blocks into Three.js containers
            result = result.replace(/<pre><code class="[^"]*language-threejs[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
              const id = 'three-' + hashCode(code) + '-' + blockIndex++;
              return `<div class="threejs-container" data-three-id="${id}"><code class="threejs-code" style="display:none">${code}</code></div>`;
            });
            // Convert ```mermaid code blocks into Mermaid containers (PRD-017)
            result = result.replace(/<pre><code class="[^"]*language-mermaid[^"]*">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
              const id = 'mermaid-' + hashCode(code) + '-' + blockIndex++;
              return `<div class="mermaid-container" data-mermaid-id="${id}"><code class="mermaid-code" style="display:none">${code}</code></div>`;
            });
            return result;
          },
        },
      ];
    },
  ],
});

// --- Fenced code block extraction (handles nested fences) ---
// Showdown can't handle nested fences (```markdown containing ```bash etc.)
// We extract outermost blocks first, let showdown process the rest, then restore.
// Uses a stack: ```lang pushes, bare ``` pops. When stack empties, outermost block is complete.
const fencedBlockStore = [];

const extractFencedBlocks = (text) => {
  fencedBlockStore.length = 0;
  const lines = text.split('\n');
  const result = [];
  const fenceStack = []; // stack of { char, len }
  let blockLines = [];
  let blockLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trimStart();
    const fenceMatch = stripped.match(/^(`{3,}|~{3,})(.*)/);

    if (!fenceMatch) {
      if (fenceStack.length > 0) {
        blockLines.push(line);
      } else {
        result.push(line);
      }
      continue;
    }

    const char = fenceMatch[1][0];
    const len = fenceMatch[1].length;
    const info = fenceMatch[2].trim();

    // Closing fence: no info string, same char, >= same length as top of stack
    if (!info && fenceStack.length > 0) {
      const top = fenceStack[fenceStack.length - 1];
      if (top.char === char && len >= top.len) {
        fenceStack.pop();
        if (fenceStack.length === 0) {
          // Outermost fence closed — save the block
          fencedBlockStore.push({ content: blockLines.join('\n'), lang: blockLang });
          result.push(`<!--CBLK${fencedBlockStore.length - 1}-->`);
          blockLines = [];
          blockLang = '';
          continue;
        } else {
          // Inner fence closed — keep as block content
          blockLines.push(line);
          continue;
        }
      }
    }

    // Opening fence
    if (fenceStack.length === 0) {
      // Outermost opening
      blockLang = info.split(/\s/)[0] || '';
      blockLines = [];
    } else {
      // Inner opening — keep as block content
      blockLines.push(line);
    }
    fenceStack.push({ char, len });
  }

  // Unclosed outermost fence (streaming)
  if (fenceStack.length > 0 && blockLines.length > 0) {
    fencedBlockStore.push({ content: blockLines.join('\n'), lang: blockLang, unclosed: true });
    result.push(`<!--CBLK${fencedBlockStore.length - 1}-->`);
  }

  return result.join('\n');
};

const restoreFencedBlocks = (html, streaming) => {
  const hashCode = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  };
  let vizIdx = 0;

  return html.replace(/(?:<p>\s*)?<!--CBLK(\d+)-->(?:\s*<\/p>)?/g, (_, idx) => {
    const block = fencedBlockStore[parseInt(idx)];
    if (!block) return '';

    const escaped = block.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Sanitize language name to prevent injection
    const safeLang = (block.lang || '').replace(/[^a-zA-Z0-9_+-]/g, '');

    // Unclosed block — the closing fence has not arrived yet.
    //
    // While streaming we tag it so the renderer leaves it alone: the text still
    // changes on every tick, so highlighting it is both wasted work and the direct
    // cause of the styled/unstyled flash (see STREAMING CONTRACT above).
    //
    // Once the message is complete (streaming === false) an unterminated block is
    // all we are ever going to get, so it is treated as final and highlighted.
    if (block.unclosed) {
      const langClass = safeLang ? ` class="${safeLang} language-${safeLang}"` : '';
      const streamAttr = streaming ? ` ${STREAMING_ATTR}="true"` : '';
      return `<pre${streamAttr}><code${langClass}${streamAttr}>${escaped}</code></pre>`;
    }

    // Handle special viz languages (morphdom preserves these during streaming)
    if (safeLang === 'chartjs') {
      const id = 'chart-' + hashCode(block.content) + '-' + vizIdx++;
      return `<div class="chartjs-container" data-chart-id="${id}"><canvas id="${id}"></canvas><code class="chartjs-config" style="display:none">${escaped}</code></div>`;
    }
    if (safeLang === 'd3') {
      const id = 'd3-' + hashCode(block.content) + '-' + vizIdx++;
      return `<div class="d3-container" data-d3-id="${id}"><code class="d3-code" style="display:none">${escaped}</code></div>`;
    }
    if (safeLang === 'threejs') {
      const id = 'three-' + hashCode(block.content) + '-' + vizIdx++;
      return `<div class="threejs-container" data-three-id="${id}"><code class="threejs-code" style="display:none">${escaped}</code></div>`;
    }
    if (safeLang === 'mermaid') {
      const id = 'mermaid-' + hashCode(block.content) + '-' + vizIdx++;
      return `<div class="mermaid-container" data-mermaid-id="${id}"><code class="mermaid-code" style="display:none">${escaped}</code></div>`;
    }

    const langClass = safeLang ? ` class="${safeLang} language-${safeLang}"` : '';
    return `<pre><code${langClass}>${escaped}</code></pre>`;
  });
};

// Protect math from showdown (which eats backslashes). HTML comments survive all contexts.
// Code blocks are already extracted upstream, so only inline math needs protection here.
const mathStore = [];
const protectMath = (text) => {
  mathStore.length = 0;
  const save = (match) => {
    mathStore.push(match);
    return `<!--M${mathStore.length - 1}-->`;
  };
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, save);
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, save);
  text = text.replace(/\\\([\s\S]+?\\\)/g, save);
  return text;
};
const restoreMath = (html) => {
  let mathIdx = 0;
  return html.replace(/<!--M(\d+)-->/g, (_, i) => {
    let m = (mathStore[parseInt(i)] || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    // Hash the content for a stable ID across re-renders
    let h = 0;
    for (let c = 0; c < m.length; c++) h = ((h << 5) - h + m.charCodeAt(c)) | 0;
    const id = 'math-' + Math.abs(h).toString(36) + '-' + mathIdx++;
    // Wrap in stable container — morphdom preserves these after MathJax typesets them
    if (m.startsWith('$$') && m.endsWith('$$')) {
      return `<div class="math-container" id="${id}">\\[${m.slice(2, -2)}\\]</div>`;
    } else if (m.startsWith('\\[') && m.endsWith('\\]')) {
      return `<div class="math-container" id="${id}">${m}</div>`;
    } else if (m.startsWith('\\(') && m.endsWith('\\)')) {
      return `<span class="math-container" id="${id}">${m}</span>`;
    }
    return m;
  });
};

/**
 * Repair run-together sentences ("Done.Next step" -> "Done. Next step"), which
 * models emit often enough that the heuristic earns its place in prose.
 *
 * It must run AFTER fenced blocks and math have been swapped out for
 * `<!--CBLKn-->` / `<!--Mn-->` markers. Applied to the raw message it rewrites
 * the user's own code — `<!DOCTYPE html>` becomes `<! DOCTYPE html>`, and a
 * ternary `a?B:c` becomes `a? B:c`. That is not just a display defect: a code
 * block is paired with the file it was read from by comparing contents, so a
 * single injected space silently breaks the pairing for essentially every real
 * HTML document, and the preview falls back to srcdoc instead of the file.
 *
 * The markers are safe by construction: `<!--` is `<!` followed by `-`, which
 * the pattern does not match.
 */
const separateRunTogetherSentences = (text) => text.replace(/([.!?:])([A-Z])/g, '$1 $2');

// Wrapper to suppress showdown's noisy "maximum nesting of 10 spans" console.error
// This warning fires during streaming when incomplete markdown creates recursive span patterns - harmless
const safeMarkdownToHtml = (text, { streaming = false } = {}) => {
  const origError = console.error;
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('maximum nesting')) return;
    origError.apply(console, args);
  };
  try {
    // 1. Extract fenced code blocks (handles nested fences that showdown can't)
    const withoutBlocks = extractFencedBlocks(text);
    // 2. Protect math from showdown mangling
    const safe = protectMath(withoutBlocks);
    // 3. Repair run-together prose — only now that code and math are hidden
    const spaced = separateRunTogetherSentences(safe);
    // 4. Convert markdown → HTML
    let html = restoreMath(markdownConverter.makeHtml(spaced));
    // 5. Restore code blocks as proper <pre><code> (or viz containers)
    html = restoreFencedBlocks(html, streaming);
    return html;
  } catch (e) {
    // Showdown can stack-overflow on pathological content (deeply nested spans, etc.)
    console.warn('[MessageItem] Markdown rendering failed, falling back to escaped text:', e.message);
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  } finally {
    console.error = origError;
  }
};

/**
 * Convert chat markdown to HTML (still needs sanitising by the caller).
 *
 * @param {string} text                        Raw markdown from the model.
 * @param {object} [options]
 * @param {boolean} [options.streaming=false]  When true, a code block whose closing
 *        fence has not arrived yet is marked with data-streaming="true" so the
 *        caller can defer syntax highlighting. When false (message complete) an
 *        unterminated block is treated as final and highlighted normally, which
 *        preserves the previous end-state behaviour exactly.
 * @returns {string} HTML
 */
export function renderMarkdown(text, options = {}) {
  return safeMarkdownToHtml(text, { streaming: !!options.streaming });
}

export default renderMarkdown;
