import { describe,it,expect } from 'vitest';
import { fileURLToPreviewURL, rewritePreviewCSS } from './artifactPreviewUrls.js';
import { preparePreviewHTML, previewResourceURL, previewReporterSource } from './artifactPreviewDocument.js';
const resolve=value=>previewResourceURL(value);
describe('preview URL boundaries',()=>{
  it.each([
    ['file:///C:/My%20Files/a%23b.html#view','/api/local-preview/C:/My%20Files/a%23b.html#view'],
    ['file:///home/user/a%3Fb.html?x=1#v','/api/local-preview//home/user/a%3Fb.html?x=1#v'],
    ['file:///C:/caf%C3%A9/a.html','/api/local-preview/C:/caf%C3%A9/a.html'],
    ['file://server/share/a.html','file://server/share/a.html'],
    ['https://example.com/api/local-file/a.html','https://example.com/api/local-file/a.html'],
  ])('resolves %s', (input,output)=>expect(fileURLToPreviewURL(input)).toBe(output));
  it('does not modify a remote API that happens to contain local-file',()=>{
    expect(resolve('https://third-party.example/api/local-file/a.html')).toBe('https://third-party.example/api/local-file/a.html');
  });
});
describe('CSS token handling',()=>{
  it('rewrites fonts, imports, escaped spaces and unquoted URLs',()=>{
    const css=`@import 'file:///C:/x/base.css';@font-face{src:url("file:///C:/x/a.woff2")}div{background:url(file:///C:/x/a\\ b.svg#icon)}`;
    const result=rewritePreviewCSS(css,resolve);
    expect(result).not.toContain('file:///');
    expect(result).toContain('a%20b.svg#icon');
  });
  it('does not rewrite comments, ordinary strings or data URLs',()=>{
    const css=`/* url(file:///C:/ignored) */p::after{content:'url(file:///C:/text)';background:url(data:image/svg+xml;base64,abcd)}`;
    expect(rewritePreviewCSS(css,resolve)).toBe(css);
  });
  it('does not hang on malformed CSS',()=>{
    expect(rewritePreviewCSS('div{background:url("file:///unterminated',resolve)).toBe('div{background:url("file:///unterminated');
  });
});
describe('HTML source preservation',()=>{
  it('preserves CSP, JavaScript, event handlers and injects the reporter after CSP',()=>{
    const html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'"></head><body onclick="run()"><script>const x='file:///C:/code';</script><img src="file:///C:/x/a.svg"></body></html>`;
    const rendered=preparePreviewHTML(html,{documentURL:'/api/local-preview/C:/x/a.html',channel:'0123456789abcdef'});
    expect(rendered).toContain('content="script-src \'none\'"');
    expect(rendered).toContain("const x='file:///C:/code';");
    expect(rendered).toContain('onclick="run()"');
    expect(rendered.indexOf('agnt:artifact-preview')).toBeGreaterThan(rendered.indexOf('Content-Security-Policy'));
    expect(rendered).toContain('<base href="/api/local-preview/C:/x/a.html">');
  });
  it('preserves an explicit remote base and transforms a local base',()=>{
    const remote='<html><head><base href="https://example.com/"></head></html>';
    expect(preparePreviewHTML(remote,{documentURL:'/api/local-preview/a.html'})).toBe(remote);
    expect(preparePreviewHTML('<base href="file:///C:/x/"><img src="relative.png">')).toContain('href="/api/local-preview/C:/x/"');
  });
  it('handles source sets without corrupting data URL commas',()=>{
    const html='<img srcset="data:image/png;base64,ABC 1x, file:///C:/x/a.png 2x">';
    expect(preparePreviewHTML(html)).toContain('data:image/png;base64,ABC 1x, /api/local-preview/C:/x/a.png 2x');
  });
  it('refuses injected reporter identifiers',()=>{
    expect(previewReporterSource('</script><script>evil()')).toBe('');
    expect(()=>new Function(previewReporterSource('0123456789abcdef'))).not.toThrow();
  });
});
