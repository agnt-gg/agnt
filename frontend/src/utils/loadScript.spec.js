import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * html2canvas and jsPDF load on the first PDF export instead of blocking every
 * app start (they were ~900 KB of parser-blocking scripts in index.html).
 */
let loadScriptOnce;
let loadPdfExportLibraries;

beforeEach(async () => {
  vi.resetModules();
  ({ loadScriptOnce, loadPdfExportLibraries } = await import('./loadScript.js'));
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  delete window.html2canvas;
  delete window.jspdf;
});

afterEach(() => {
  delete window.html2canvas;
  delete window.jspdf;
});

const injected = (src) => [...document.head.querySelectorAll('script')].filter((s) => s.getAttribute('src') === src);

describe('loadScriptOnce', () => {
  it('injects a script once, however many callers ask', async () => {
    const a = loadScriptOnce('/js/libs/x.js');
    const b = loadScriptOnce('/js/libs/x.js');
    expect(a).toBe(b);
    expect(injected('/js/libs/x.js')).toHaveLength(1);
    injected('/js/libs/x.js')[0].onload();
    await expect(a).resolves.toBeUndefined();
  });

  it('lets a failed load be retried instead of replaying the failure', async () => {
    const first = loadScriptOnce('/js/libs/y.js');
    injected('/js/libs/y.js')[0].onerror();
    await expect(first).rejects.toThrow('Could not load /js/libs/y.js');

    const second = loadScriptOnce('/js/libs/y.js');
    expect(second).not.toBe(first);
    expect(injected('/js/libs/y.js')).toHaveLength(1); // the failed tag was removed
  });
});

describe('loadPdfExportLibraries', () => {
  it('loads nothing when both libraries are already present', async () => {
    window.html2canvas = () => {};
    window.jspdf = { jsPDF: function jsPDF() {} };
    await loadPdfExportLibraries();
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('loads html2canvas and jsPDF when either is missing', async () => {
    const pending = loadPdfExportLibraries();
    for (const src of ['/js/libs/html2canvas.js', '/js/libs/jspdf.js']) {
      expect(injected(src)).toHaveLength(1);
      injected(src)[0].onload();
    }
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('index.html', () => {
  it('does not load the PDF export libraries on every start', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    for (const lib of ['html2canvas.js', 'jspdf.js', 'jspdf-autotable.js']) {
      expect(html, `${lib} is back in index.html`).not.toMatch(new RegExp(`<script[^>]+${lib.replace('.', '\\.')}`));
    }
  });
});
