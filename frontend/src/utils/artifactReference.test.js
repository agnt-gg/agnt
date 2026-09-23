import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdownPipeline.js';
import { rewriteLocalFileURLsInHTML } from './localFileUrl.js';
const block = value => '```artifact\n'+value+'\n```';
describe('first-class artifact references',()=>{
  it('renders a saved HTML reference as one iframe without repeating the document',()=>{
    const html=renderMarkdown(block(JSON.stringify({path:'C:/My Files/report.html',title:'Report',view:'summary'})));
    const document=new DOMParser().parseFromString(html,'text/html');
    const frame=document.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('src')).toContain('/api/local-preview/C:/My%20Files/report.html#summary');
    expect(frame.getAttribute('title')).toBe('Report');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });
  it.each(['{','{"path":"https://evil.example/report.html"}','{"path":"relative.html"}','{"path":"C:/x/script.js"}'])('leaves invalid references readable instead of executing: %s',value=>{
    const document=new DOMParser().parseFromString(renderMarkdown(block(value)),'text/html');
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('code').textContent).toBe(value);
  });
  it('does not execute an incomplete streaming reference',()=>{
    const html=renderMarkdown('```artifact\n{"path":"C:/x/a.html"}',{streaming:true});
    expect(html).not.toContain('<iframe');
  });
  it('escapes titles and does not accept token/query parameters',()=>{
    const html=renderMarkdown(block(JSON.stringify({path:'C:/x/a.html',title:'"><img src=x onerror=evil()>',token:'secret'})));
    const document=new DOMParser().parseFromString(html,'text/html');
    expect(document.querySelector('iframe')?.title).toContain('<img');
    expect(document.querySelector('img')).toBeNull();
    expect(html).not.toContain('secret');
  });
  it('handles inline CSS fonts alongside nested file frames',()=>{
    const html=rewriteLocalFileURLsInHTML('<html><head><style>@font-face{src:url("file:///C:/demo/font.woff2")}</style></head><body><iframe src="file:///C:/demo/child.html#tab"></iframe></body></html>');
    expect(html).not.toContain('file:///');
    expect(html).toContain('/local-preview/C:/demo/child.html#tab');
    expect(html).toContain('/local-preview/C:/demo/font.woff2');
  });
});
