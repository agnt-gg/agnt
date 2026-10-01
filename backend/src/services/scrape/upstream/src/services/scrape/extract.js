import {JSDOM} from 'jsdom';
import TurndownService from 'turndown';
import gfm from 'turndown-plugin-gfm';
// Page furniture that is never the content a caller asked for.
const JUNK=['header','footer','nav','aside','script','style','noscript','link','iframe','svg','form','[role="navigation"]','[role="banner"]','[role="complementary"]','[role="search"]','.devsite-header','.devsite-book-nav','.devsite-footer','.devsite-page-nav','#sidenav','#sidebar','.sidebar','.breadcrumb','.toc','.table-of-contents','.cookie-banner','#cookie-consent','.ad','.advertisement','[aria-hidden="true"]','.noprint'];
const MAIN='article, main, [role="main"], #main-content, #main, .main, #content, .content';
const turndown=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'_'});
// GitHub-flavoured tables and strikethrough. Rules added later take precedence, so the
// overrides below refine the plugin's rules.
turndown.use([gfm.tables,gfm.strikethrough]);
turndown.remove(['script','style','noscript','template']);
// A pipe or line break inside a cell would end the row early; escape one, fold the other.
turndown.addRule('tableCellEscaped',{filter:['th','td'],replacement:(content,node)=>{const index=Array.prototype.indexOf.call(node.parentNode.children,node);return (index===0?'| ':' ')+content.replace(/[ \t]*\n+[ \t]*/g,' ').replace(/\|/g,'\\|').trim()+' |';}});
// Keep the language hint on fenced code, which is what agents most often need verbatim.
turndown.addRule('fencedCodeWithLanguage',{filter:node=>node.nodeName==='PRE',replacement:(_content,node)=>{const code=node.querySelector('code');const lang=code?(code.className.match(/language-([\w+-]+)/)||[])[1]||'':'';return '\n\n```'+lang+'\n'+(node.textContent||'').replace(/\n$/,'')+'\n```\n\n';}});
// Compact list items ("- item", "1. item"): turndown's default pads markers to four columns.
turndown.addRule('compactListItem',{filter:'li',replacement:(content,node,options)=>{const parent=node.parentNode;let prefix=options.bulletListMarker+' ';if(parent.nodeName==='OL'){const start=Number(parent.getAttribute('start'))||1;prefix=(start+Array.prototype.indexOf.call(parent.children,node))+'. ';}content=content.replace(/^\n+/,'').replace(/\n+$/,'\n').replace(/\n/gm,'\n'+' '.repeat(prefix.length));return prefix+content+(node.nextSibling&&!/\n$/.test(content)?'\n':'');}});
// Shadow DOM arrives serialized as declarative <template shadowrootmode> blocks. jsdom keeps them as
// inert templates, so their content (code examples, in MDN's case) would be invisible. Inline them.
function parse(html,url){
 const dom=new JSDOM(html,url?{url}:undefined),document=dom.window.document;
 for(let pass=0;pass<8;pass++){const templates=document.querySelectorAll('template[shadowrootmode]');if(!templates.length)break;for(const template of templates)template.replaceWith(template.content.cloneNode(true));}
 return dom;
}
const clean=text=>text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'');
// Markdown tables need a header row, and only data belongs in them. A table that holds other
// tables (or says it is presentational) is page layout: flatten it to blocks. A data table with
// no header gets its first row promoted, so it renders as a table instead of raw HTML.
function prepareTables(root){
 const document=root.ownerDocument;
 for(const table of Array.from(root.querySelectorAll('table'))){
  const rows=Array.from(table.rows);
  if(!rows.length){table.remove();continue;}
  if(table.querySelector('table')||/^(presentation|none)$/i.test(table.getAttribute('role')||'')){
   const box=document.createElement('div');
   for(const row of rows){const line=document.createElement('div');for(const cell of Array.from(row.cells)){const part=document.createElement('div');while(cell.firstChild)part.appendChild(cell.firstChild);line.appendChild(part);}box.appendChild(line);}
   table.replaceWith(box);continue;
  }
  const first=rows[0];
  if(!Array.from(first.cells).some(cell=>cell.nodeName==='TH'))for(const cell of Array.from(first.cells)){const th=document.createElement('th');while(cell.firstChild)th.appendChild(cell.firstChild);cell.replaceWith(th);}
 }
 return root;
}
// Extracts every requested format from ONE rendered document.
export function extract(html,url,{formats=['markdown'],mainContentOnly=true}={}){
 const dom=parse(html,url);const document=dom.window.document;
 const want=new Set(formats),out={title:(document.title||'').trim()};
 // Links and code come from the untouched document so nothing is lost to cleanup.
 if(want.has('links'))out.links=[...new Set(Array.from(document.querySelectorAll('a[href]')).map(a=>{try{return new URL(a.getAttribute('href'),url).href;}catch{return null;}}).filter(href=>href&&/^https?:/.test(href)))];
 if(want.has('code'))out.code=Array.from(document.querySelectorAll('pre')).map(pre=>{const code=pre.querySelector('code');const lang=code?(code.className.match(/language-([\w+-]+)/)||[])[1]||'':'';return '```'+lang+'\n'+(pre.textContent||'').trim()+'\n```';}).join('\n\n');
 if(mainContentOnly)document.querySelectorAll(JUNK.join(', ')).forEach(element=>element.remove());
 // Markdown and HTML leave the page: every link and image must resolve on its own.
 for(const [selector,attribute] of [['a[href]','href'],['img[src]','src']])for(const element of document.querySelectorAll(selector)){try{element.setAttribute(attribute,new URL(element.getAttribute(attribute),url).href);}catch{element.removeAttribute(attribute);}}
 const root=(mainContentOnly&&document.querySelector(MAIN))||document.body||document.documentElement;
 const text=clean((root?.textContent||'').replace(/\s\s+/g,' ').trim());
 if(want.has('text'))out.text=text;
 if(want.has('html'))out.html=mainContentOnly?root.outerHTML:html;
 // Tables are reshaped on a copy: the html format returns the page as it was.
 if(want.has('markdown'))out.markdown=clean(turndown.turndown(prepareTables(root.cloneNode(true)).innerHTML||'').replace(/\n{3,}/g,'\n\n').trim());
 dom.window.close();
 // A page with no readable text is an extraction failure, not a billable page.
 const textual=['markdown','html','text','code','links'].some(name=>want.has(name));
 if(textual&&!text&&!(out.links?.length)&&!out.code)throw Error('extraction_failed');
 return out;
}
// Signals that the document we received is a bot wall, not the page.
const WALL_TITLES=/^(just a moment|attention required|access denied|verify you are human|are you a robot|pardon our interruption|request blocked|security check|please verify|captcha)/i;
const WALL_MARKERS=/(cf-chl-|challenge-platform|cf_chl_opt|_Incapsula_Resource|datadome|px-captcha|perimeterx|g-recaptcha|hcaptcha\.com\/1\/api|captcha-delivery\.com)/i;
export function blocked({status,title,html,textLength=0}){
 if([401,403,429].includes(status))return true;
 if(WALL_TITLES.test((title||'').trim()))return true;
 // Markers only count when there is almost no readable text: real pages often embed
 // a captcha widget for a contact form or comments, and those are not walls.
 return WALL_MARKERS.test(html||'')&&textLength<1500;
}
export function visibleTextLength(html){const dom=parse(html);const document=dom.window.document;document.querySelectorAll('script,style,noscript').forEach(e=>e.remove());const length=(document.body?.textContent||'').replace(/\s+/g,' ').trim().length;dom.window.close();return length;}
