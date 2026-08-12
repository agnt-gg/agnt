import { buildLocalFileUrl } from './localFileUrl.js';

/**
 * Resolve an Artifacts workspace-relative HTML path to the directory URL that
 * a srcdoc iframe should use for relative resources created at runtime.
 *
 * Static DOM/CSS URLs can be rewritten before the iframe starts, but URLs
 * created later by page JavaScript cannot. A real <base> makes both paths obey
 * normal browser URL resolution while preserving srcdoc for unsaved edits.
 */
export function buildArtifactPreviewBaseUrl(workspaceRoot, htmlPath) {
  if (!workspaceRoot || !htmlPath) return '';

  const root = String(workspaceRoot).replace(/\\/g, '/').replace(/\/+$/, '');
  const relativePath = String(htmlPath).replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = relativePath.lastIndexOf('/');
  const relativeDir = slash >= 0 ? relativePath.slice(0, slash) : '';
  const absoluteDir = relativeDir ? `${root}/${relativeDir}/` : `${root}/`;
  return buildLocalFileUrl(absoluteDir);
}

export function injectArtifactPreviewBase(doc, workspaceRoot, htmlPath) {
  const href = buildArtifactPreviewBaseUrl(workspaceRoot, htmlPath);
  if (!href) return '';

  let head = doc.querySelector('head');
  if (!head) {
    head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
  }

  let base = head.querySelector('base[data-agnt-artifact-base]');
  if (!base) {
    base = doc.createElement('base');
    base.setAttribute('data-agnt-artifact-base', '');
    head.insertBefore(base, head.firstChild);
  }
  base.setAttribute('href', href);
  return href;
}
