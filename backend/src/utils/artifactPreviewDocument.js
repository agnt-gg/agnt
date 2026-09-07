import { load } from 'cheerio';
import { fileURLToPreviewURL, rewritePreviewCSS, PREVIEW_MESSAGE, PREVIEW_CHANNEL_PARAM } from './artifactPreviewUrls.js';

export const MAX_PREVIEW_TEXT_BYTES = 8 * 1024 * 1024;

export function previewResourceURL(value, prefix = '/api/local-preview/') {
  if (/^file:\/\//i.test(value || '')) return fileURLToPreviewURL(value,prefix);
  // Only known local API forms. Never rewrite an unrelated remote service.
  return value.replace(/^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/local-file\//i,prefix);
}

/** Reports load/errors, not correctness. Existing CSP may deliberately block it. */
export function previewReporterSource(channel) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(channel || '')) return '';
  return `(()=>{const channel=${JSON.stringify(channel)},type=${JSON.stringify(PREVIEW_MESSAGE)};let errors=0;const report=(state,detail='')=>parent.postMessage({type,channel,state,detail},'*');addEventListener('error',event=>{if(errors++>=10)return;const tag=event.target?.tagName;report('warning',tag?'Could not load '+tag.toLowerCase()+' resource.': 'The artifact reported a script error.');},true);addEventListener('unhandledrejection',()=>{if(errors++<10)report('warning','The artifact reported an unhandled promise rejection.');});const loaded=()=>report('loaded');if(document.readyState==='complete')loaded();else addEventListener('load',loaded,{once:true});})();`;
}

/** Preserve source bytes outside edited attributes/styles; never rewrite JavaScript. */
export function preparePreviewHTML(source,{documentURL, prefix='/api/local-preview/', channel=''}={}) {
  const $=load(source,{sourceCodeLocationInfo:true});
  const edits=[];
  const resolve=value=>previewResourceURL(value,prefix);
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
  let hasBase=false;
  for(const element of $('*').toArray()) {
    const location=element.sourceCodeLocation;if(!location)continue;
    for(const [name,value] of Object.entries(element.attribs||{})) {
      if(element.name==='base'&&name==='href')hasBase=true;
      const attr=location.attrs?.[name];if(!attr)continue;
      let replacement=value;
      if(['src','href','poster','data','xlink:href'].includes(name))replacement=resolve(value);
      else if(name==='style')replacement=rewritePreviewCSS(value,resolve);
      else if(name==='srcset'||name==='imagesrcset') {
        // Replace only explicit local URL tokens, preserving data URI commas.
        replacement=value.replace(/(?:file:\/\/|\/api\/local-file\/)[^\s,]+/gi,resolve);
      }
      if(replacement!==value)edits.push({start:attr.startOffset,end:attr.endOffset,text:`${name}="${escape(replacement)}"`});
    }
    if(element.name==='style'&&location.startTag&&location.endTag) {
      const start=location.startTag.endOffset,end=location.endTag.startOffset;
      const content=source.slice(start,end),replacement=rewritePreviewCSS(content,resolve);
      if(replacement!==content)edits.push({start,end,text:replacement});
    }
  }
  let additions='';
  // Use the actual resolved file, not a stale requested path, as the relative base.
  if(!hasBase&&documentURL)additions+=`<base href="${escape(documentURL)}">`;
  const reporter=previewReporterSource(channel);
  if(reporter) {
    // Append after the author's CSP, never before it. A restrictive policy may
    // block diagnostics; the parent reports an unconfirmed load in that case.
    const at=$('body')[0]?.sourceCodeLocation?.endTag?.startOffset ?? source.length;
    edits.push({start:at,end:at,text:`<script>${reporter}</script>`});
  }
  if(additions) {
    const head=$('head')[0]?.sourceCodeLocation?.startTag;
    const html=$('html')[0]?.sourceCodeLocation?.startTag;
    const doctype=/^\s*<!doctype[^>]*>/i.exec(source);
    const policies = $('meta[http-equiv]').toArray().filter(element =>
      element.attribs['http-equiv'].toLowerCase() === 'content-security-policy'
    ).map(element => element.sourceCodeLocation?.endOffset || 0);
    const at=Math.max(head?.endOffset ?? html?.endOffset ?? doctype?.[0].length ?? 0, ...policies);
    edits.push({start:at,end:at,text:additions});
  }
  let result=source,boundary=source.length;
  for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end)) {
    if(edit.end>boundary)throw new Error('Overlapping preview edits');
    result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);boundary=edit.start;
  }
  return result;
}

export function previewChannel(query) {
  const value=query?.[PREVIEW_CHANNEL_PARAM];
  return typeof value==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(value)?value:'';
}
