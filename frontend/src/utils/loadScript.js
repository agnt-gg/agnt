/**
 * Load a classic <script> on demand, once.
 *
 * html2canvas and jsPDF used to be parser-blocking tags in index.html: about
 * 900 KB fetched, parsed and executed before the app could start, on every
 * launch, for one feature (Tool Forge's "download as PDF"). They now load the
 * first time that feature is used.
 */
const pending = new Map();

export function loadScriptOnce(src) {
  if (pending.has(src)) return pending.get(src);
  const promise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Forget the failure so a later attempt can retry instead of replaying it.
      pending.delete(src);
      el.remove();
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(el);
  });
  pending.set(src, promise);
  return promise;
}

/** html2canvas + jsPDF, as the PDF export uses them (window globals). */
export async function loadPdfExportLibraries() {
  if (typeof window.html2canvas === 'function' && typeof window.jspdf?.jsPDF === 'function') return;
  await Promise.all([loadScriptOnce('/js/libs/html2canvas.js'), loadScriptOnce('/js/libs/jspdf.js')]);
}
