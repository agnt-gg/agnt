/**
 * morphHtmlDirective.js
 *
 * v-morph-html — patches a container's DOM toward new HTML with morphdom instead of
 * blowing it away with innerHTML (v-html). During streaming the same message is
 * re-rendered many times a second, so a naive innerHTML swap would destroy every
 * stateful node inside it: Chart.js canvases, live iframes, MathJax output.
 *
 * Anything the app mutates OUT OF BAND (highlight.js token spans, imperatively
 * injected action buttons, typeset math) is invisible to the freshly rendered HTML,
 * so morphdom would happily undo it. shouldPreserve() is the list of things it must
 * not touch. Callers are responsible for not starting out-of-band work on content
 * that is still changing — see the data-streaming contract in markdownPipeline.js.
 *
 * Extracted from MessageItem.vue so the streaming-stability behaviour is testable.
 */
import morphdom from 'morphdom';

const PRESERVE_SELECTORS = [
  '.html-inline-preview-wrapper',
  '[data-buttons-added]',
  '[data-image-buttons-added]',
  '.math-container[data-math-rendered]',
].join(',');

// A viz container is "rendered" once its output element exists. Preserving on data-source-code
// alone strands stubs that lost their canvas (morphdom + duplicate-id race during streaming).
function isRenderedVizContainer(el) {
  if (!el || !el.classList) return false;
  if (el.classList.contains('chartjs-container')) return !!el.querySelector('canvas');
  if (el.classList.contains('d3-container')) return !!el.querySelector('.d3-chart');
  if (el.classList.contains('threejs-container')) return !!el.querySelector('canvas.threejs-canvas');
  if (el.classList.contains('mermaid-container')) return !!el.querySelector('svg');
  return false;
}

function shouldPreserve(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'CANVAS') return true;
  if (el.tagName === 'IFRAME') return true;
  if (isRenderedVizContainer(el)) return true;
  try {
    return el.matches(PRESERVE_SELECTORS);
  } catch {
    return false;
  }
}

const vMorphHtml = {
  mounted(el, binding) {
    el.innerHTML = binding.value || '';
    el._morphHtml = binding.value;
  },
  updated(el, binding) {
    const newHtml = binding.value || '';
    if (newHtml === el._morphHtml) return;
    el._morphHtml = newHtml;

    if (!el.childNodes.length) {
      el.innerHTML = newHtml;
      return;
    }

    const wrapper = document.createElement(el.tagName);
    wrapper.innerHTML = newHtml;

    morphdom(el, wrapper, {
      childrenOnly: true,
      onBeforeElUpdated(fromEl, toEl) {
        if (shouldPreserve(fromEl)) return false;
        if (fromEl.tagName === 'CODE' && fromEl.classList.contains('hljs') && fromEl.textContent === toEl.textContent) return false;
        return true;
      },
      onBeforeNodeDiscarded(node) {
        if (node.nodeType === 1 && shouldPreserve(node)) return false;
        if (node.nodeType === 1) {
          try {
            if (node.matches('.viz-action-buttons')) {
              // Keep action buttons only when their container is still a rendered viz; otherwise
              // the parent is a stub being replaced and the buttons go with it.
              return !isRenderedVizContainer(node.parentElement);
            }
            if (node.matches('.assistant-image-wrapper, .html-code-actions')) return false;
          } catch {}
        }
        return true;
      },
    });
  },
};

export { vMorphHtml, shouldPreserve, isRenderedVizContainer, PRESERVE_SELECTORS };
export default vMorphHtml;
