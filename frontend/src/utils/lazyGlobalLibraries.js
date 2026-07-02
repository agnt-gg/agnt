const scriptPromises = new Map();

const loadScript = (id, src, options = {}) => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (scriptPromises.has(id)) return scriptPromises.get(id);

  const existing = document.getElementById(id);
  if (existing?.dataset.loaded === 'true') {
    const promise = Promise.resolve(existing);
    scriptPromises.set(id, promise);
    return promise;
  }

  const promise = new Promise((resolve, reject) => {
    const script = existing || document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = options.async ?? true;
    script.defer = options.defer ?? true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve(script);
    };
    script.onerror = () => {
      scriptPromises.delete(id);
      reject(new Error(`Failed to load script: ${src}`));
    };
    if (!existing) document.head.appendChild(script);
  });

  scriptPromises.set(id, promise);
  return promise;
};

export const loadHljs = async () => {
  if (!window.hljs) {
    await loadScript('Highlight-script', '/js/libs/highlight.js');
  }
  if (window.hljs?.configure) {
    window.hljs.configure({ ignoreUnescapedHTML: true });
  }
  return window.hljs;
};

export const highlightCodeBlocks = async (root) => {
  const blocks = root?.querySelectorAll?.('pre code:not([highlighted]), pre code:not(.hljs)');
  if (!blocks?.length) return;

  const hljs = await loadHljs();
  if (!hljs) return;

  blocks.forEach((el) => {
    hljs.highlightElement(el);
    el.setAttribute('highlighted', 'true');
  });
};

const configureMathJax = () => {
  if (window.MathJax) return;
  window.MathJax = {
    tex: {
      inlineMath: [['\\(', '\\)']],
      displayMath: [
        ['\\[', '\\]'],
        ['$$', '$$'],
      ],
      processEscapes: true,
      processEnvironments: true,
      packages: { '[+]': ['mhchem'] },
    },
    svg: {
      fontCache: 'global',
    },
    loader: {
      load: ['[tex]/mhchem'],
    },
    startup: {
      typeset: false,
      pageReady: () => window.MathJax.startup.defaultPageReady(),
    },
  };
};

export const loadMathJax = async () => {
  if (!window.MathJax?.typesetPromise) {
    configureMathJax();
    await loadScript('MathJax-script', 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js');
    if (window.MathJax?.startup?.promise) {
      await window.MathJax.startup.promise;
    }
  }
  return window.MathJax;
};

export const typesetMath = async (elements) => {
  const targets = Array.isArray(elements) ? elements.filter(Boolean) : [elements].filter(Boolean);
  if (!targets.length) return;

  const hasMath = targets.some((el) => /\\\(|\\\[|\$\$|<math[\s>]/.test(el.textContent || el.innerHTML || ''));
  if (!hasMath) return;

  const mathJax = await loadMathJax();
  if (!mathJax?.typesetPromise) return;

  targets.forEach((el) => {
    try {
      mathJax.typesetClear?.([el]);
    } catch (error) {
      // It is safe to typeset without clearing if MathJax has no previous state for this node.
    }
  });
  await mathJax.typesetPromise(targets);
};

export const loadPdfExportLibraries = async () => {
  await loadScript('HTML2Canvas-script', '/js/libs/html2canvas.js');
  await loadScript('JSPDF-script', '/js/libs/jspdf.js');
  await loadScript('JSPDF-Autotable-script', '/js/libs/jspdf-autotable.js');

  return {
    html2canvas: window.html2canvas,
    jspdf: window.jspdf,
  };
};
