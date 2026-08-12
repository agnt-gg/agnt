import { describe, expect, it } from 'vitest';
import { buildArtifactPreviewBaseUrl, injectArtifactPreviewBase } from './artifactPreviewBase.js';

const ROOT = 'C:\\Users\\Studio\\AppData\\Roaming\\AGNT\\projects';

describe('Artifacts HTML preview base URL', () => {
  it('anchors nested runtime-created assets to the HTML file directory', () => {
    expect(buildArtifactPreviewBaseUrl(ROOT, 'magazine-flip-showcase/index.html')).toContain(
      '/local-file/C:/Users/Studio/AppData/Roaming/AGNT/projects/magazine-flip-showcase/',
    );
  });

  it('anchors root-level HTML to the workspace root', () => {
    expect(buildArtifactPreviewBaseUrl(ROOT, 'index.html')).toContain('/local-file/C:/Users/Studio/AppData/Roaming/AGNT/projects/');
  });

  it('injects one base element before scripts execute', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><html><head><script>window.image = "assets/page.jpg"</script></head><body></body></html>',
      'text/html',
    );

    const href = injectArtifactPreviewBase(doc, ROOT, 'magazine-flip-showcase/index.html');
    const bases = doc.querySelectorAll('base[data-agnt-artifact-base]');
    expect(bases).toHaveLength(1);
    expect(bases[0].getAttribute('href')).toBe(href);
    expect(new URL('assets/page.jpg', href).pathname).toContain(
      '/local-file/C:/Users/Studio/AppData/Roaming/AGNT/projects/magazine-flip-showcase/assets/page.jpg',
    );
  });

  it('does nothing until both workspace root and file path are known', () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    expect(injectArtifactPreviewBase(doc, '', 'index.html')).toBe('');
    expect(doc.querySelector('base')).toBeNull();
  });
});
