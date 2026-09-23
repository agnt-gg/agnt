import { buildLocalPreviewUrl } from './localFileUrl.js';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');

/** A closed artifact fence is data, never executable HTML supplied by the model. */
export function renderArtifactReference(source) {
  if (source.length > 8192) return '';
  let reference;
  try { reference=JSON.parse(source); } catch { return ''; }
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return '';
  const { path, title = 'HTML artifact', view = '' } = reference;
  if (typeof path !== 'string' || !/^(?:[a-z]:[\\/]|\/(?!\/))/i.test(path) || /[\x00-\x1f]/.test(path) || !/\.html?$/i.test(path)) return '';
  if (typeof title !== 'string' || title.length > 300 || typeof view !== 'string' || view.length > 500) return '';
  const src=buildLocalPreviewUrl(path)+(view?'#'+encodeURIComponent(view):'');
  return `<iframe src="${escape(src)}" title="${escape(title)}" width="100%" height="600" sandbox="allow-scripts allow-same-origin" style="display:block;width:100%;height:600px;border:0"></iframe>`;
}
