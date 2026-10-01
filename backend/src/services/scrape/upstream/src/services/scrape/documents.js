import {unzipSync,zipSync,strFromU8} from 'fflate';
import {JSDOM} from 'jsdom';
import {extract} from './extract.js';
import {SCRAPE_LIMITS,SCRAPE_FILE_TYPES,codeLanguage} from '../ScrapePolicy.js';
// Converts one file (a URL's response, or an upload) into the same formats a web page gets.
// Runs inside a bounded worker thread (convert.js); every size limit below is enforced here too.
export const DOCUMENT_ERRORS=Object.freeze(['unsupported_file_type','pdf_images_only','invalid_page_range','extraction_failed','result_too_large']);
export const isHtmlContentType=contentType=>!contentType||/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
const MIME_KINDS=Object.freeze({
 'application/pdf':'pdf','application/x-pdf':'pdf',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.ms-excel.sheet.macroenabled.12':'xlsx',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
 'text/csv':'csv','application/csv':'csv','text/tab-separated-values':'tsv',
 'application/json':'json','application/ld+json':'json','application/geo+json':'json',
 'application/yaml':'yaml','application/x-yaml':'yaml','text/yaml':'yaml','text/x-yaml':'yaml',
 'application/xml':'xml','text/xml':'xml','application/rss+xml':'xml','application/atom+xml':'xml','image/svg+xml':'svg',
 'text/html':'html','application/xhtml+xml':'html','text/markdown':'markdown','text/x-markdown':'markdown','text/plain':'text',
 'application/rtf':'rtf','text/rtf':'rtf','application/javascript':'code','text/javascript':'code','text/css':'code',
});
const GENERIC=new Set(['','application/octet-stream','binary/octet-stream','application/download','application/x-download','application/force-download']);
const extensionOf=value=>{try{const last=decodeURIComponent(new URL(value).pathname.split('/').pop()||'');return /\.([a-z0-9]{1,10})$/i.exec(last)?.[1]?.toLowerCase()||'';}catch{return /\.([a-z0-9]{1,10})$/i.exec(String(value||''))?.[1]?.toLowerCase()||'';}};
const filenameOf=value=>{try{return decodeURIComponent(new URL(value).pathname.split('/').pop()||'');}catch{return '';}};
function sniff(bytes){
 if(!bytes?.length)return null;
 const head=bytes.subarray(0,1024);
 if(head.includes(0x25)&&Buffer.from(head).toString('latin1').includes('%PDF-'))return 'pdf';
 if(bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04)return 'zip';
 if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return 'image';
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image';
 if(bytes[0]===0x47&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x38)return 'image';
 if(bytes.length>12&&Buffer.from(bytes.subarray(0,4)).toString('latin1')==='RIFF'&&Buffer.from(bytes.subarray(8,12)).toString('latin1')==='WEBP')return 'image';
 return null;
}
// Reads an archive, deciding what to inflate from its directory. Totals are enforced against the
// sizes the archive declares, and fflate inflates each entry into a buffer of exactly that size,
// so a file that lies about its size cannot expand past it. Nothing is inflated until the whole
// directory has been checked.
function readZip(bytes,keep=()=>true){
 let total=0,count=0;
 try{
  return unzipSync(bytes,{filter:file=>{
   if(++count>SCRAPE_LIMITS.maxZipEntries)throw Error('result_too_large');
   total+=file.originalSize;
   if(file.originalSize>SCRAPE_LIMITS.maxUnzippedBytes||total>SCRAPE_LIMITS.maxUnzippedBytes)throw Error('result_too_large');
   return keep(file.name);
  }});
 }catch(error){throw Error(error.message==='result_too_large'?'result_too_large':'extraction_failed');}
}
function officeKind(bytes){
 const names=new Set();readZip(bytes,name=>{names.add(name);return false;});
 return names.has('word/document.xml')?'docx':names.has('xl/workbook.xml')?'xlsx':names.has('ppt/presentation.xml')?'pptx':null;
}
export function detectKind({contentType='',extension='',url,filename,bytes}){
 const ext=String(extension||extensionOf(filename)||extensionOf(url)).toLowerCase().replace(/^\./,'');
 const mime=String(contentType).split(';')[0].trim().toLowerCase();
 // Magic bytes outrank labels: servers mislabel files, and a renamed upload is still what it is.
 const magic=sniff(bytes);
 if(magic==='pdf')return {kind:'pdf',ext};
 if(magic==='zip'){const kind=officeKind(bytes);return kind?{kind,ext}:null;}
 if(magic==='image')return {kind:'image',ext};
 let kind=MIME_KINDS[mime]||(mime.endsWith('+json')?'json':mime.endsWith('+xml')?'xml':mime.startsWith('image/')?'image':null);
 const byExtension=SCRAPE_FILE_TYPES[ext];
 // Raw source and data files are usually served as text/plain or octet-stream: the extension is more specific.
 if(byExtension&&(!kind||kind==='text'||GENERIC.has(mime)))kind=byExtension;
 if(!kind||['pdf','docx','xlsx','pptx','image'].includes(kind))return null;// a binary format without its signature is not that format
 return {kind,ext};
}
const esc=value=>String(value).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
const xmlText=value=>String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(match,entity)=>{if(entity[0]!=='#')return ENTITIES[entity]??match;const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);try{return String.fromCodePoint(code);}catch{return '';}});
const attr=(tag,name)=>{const match=new RegExp('\\s'+name.replace(':','\\:')+'="([^"]*)"').exec(tag);return match?xmlText(match[1]):'';};
function decodeText(bytes,contentType=''){
 if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.subarray(2));
 if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes.subarray(2));
 const charset=/charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
 let decoder;try{decoder=new TextDecoder(charset||'utf-8');}catch{decoder=new TextDecoder('utf-8');}
 return decoder.decode(bytes).replace(/^\uFEFF/,'');
}
const URL_PATTERN=/\bhttps?:\/\/[^\s<>"'`)\]]+/g;
const urlsIn=text=>[...new Set((text.match(URL_PATTERN)||[]).map(url=>url.replace(/[.,;:!?]+$/,'')))].slice(0,1000);
const fencedBlocks=markdown=>(markdown.match(/```[^\n]*\n[\s\S]*?\n```/g)||[]).join('\n\n');
const fence=(language,body)=>{const ticks=body.includes('```')?'````':'```';return ticks+language+'\n'+body.replace(/\n+$/,'')+'\n'+ticks;};
// HTML-producing converters share the web page pipeline, so a Word table and a web table read the same.
function fromHtml(html,{url,mainContentOnly=false,type,meta={},title}){
 const out=extract(html,url,{formats:['markdown','html','text','links','code'],mainContentOnly});
 return {title:title||out.title,markdown:out.markdown,html:out.html,text:out.text,links:out.links,code:out.code,type,meta};
}
function table(rows){
 if(!rows.length)return '';
 const width=Math.max(...rows.map(row=>row.length));
 const cells=(row,tag)=>Array.from({length:width},(_,i)=>'<'+tag+'>'+esc(row[i]??'')+'</'+tag+'>').join('');
 return '<table><thead><tr>'+cells(rows[0],'th')+'</tr></thead><tbody>'+rows.slice(1).map(row=>'<tr>'+cells(row,'td')+'</tr>').join('')+'</tbody></table>';
}
function range(pageRange,total){
 if(!pageRange)return [1,total];
 const [from,to=from]=pageRange.split('-').map(Number);
 if(from>total)throw Error('invalid_page_range');
 return [from,Math.min(to,total)];
}
async function convertPdf(bytes,{pageRange,url,filename}){
 const {getDocumentProxy}=await import('unpdf');
 let pdf;try{pdf=await getDocumentProxy(new Uint8Array(bytes));}catch{throw Error('extraction_failed');}
 try{
  const total=pdf.numPages;let [from,to]=range(pageRange,total);
  const truncated=to-from+1>SCRAPE_LIMITS.maxPdfPages;if(truncated)to=from+SCRAPE_LIMITS.maxPdfPages-1;
  const pages=[],links=new Set();
  for(let number=from;number<=to;number++){
   const page=await pdf.getPage(number);
   const content=await page.getTextContent();
   const text=content.items.map(item=>(item.str??'')+(item.hasEOL?'\n':'')).join('').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
   pages.push({number,text,characters:text.replace(/\s/g,'').length});
   for(const annotation of await page.getAnnotations().catch(()=>[]))if(annotation.subtype==='Link'&&/^https?:/i.test(annotation.url||''))links.add(annotation.url);
   page.cleanup?.();
  }
  // No text layer on any page: a scan or a picture of text. Reported, never billed; OCR is not
  // offered. A single page with a short real line is still a text document.
  if(pages.every(page=>page.characters<5))throw Error('pdf_images_only');
  const info=(await pdf.getMetadata().catch(()=>null))?.info||{};
  // The document's own title heads the markdown; a file name is only a label, not a heading.
  const heading=String(info.Title||'').trim(),title=heading||filename||'';
  for(const url of urlsIn(pages.map(page=>page.text).join('\n')))links.add(url);
  const note=truncated?'\n\n_Only pages '+from+'–'+to+' of '+total+' were converted. Request a pageRange for the rest._':'';
  const markdown=(heading?'# '+heading+'\n\n':'')+pages.map(page=>'## Page '+page.number+'\n\n'+(page.text||'_No text on this page._')).join('\n\n')+note;
  const html='<article>'+(heading?'<h1>'+esc(heading)+'</h1>':'')+pages.map(page=>'<section><h2>Page '+page.number+'</h2><p>'+esc(page.text).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')+'</p></section>').join('')+'</article>';
  return {title,markdown,html,text:pages.map(page=>page.text).join('\n\n'),links:[...links],code:'',type:'pdf',meta:{pages:total,pagesConverted:[from,to]}};
 }finally{await pdf.destroy?.().catch?.(()=>{});}
}
const coreTitle=files=>{const xml=files['docProps/core.xml'];return xml?xmlText(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(strFromU8(xml))?.[1]||'').trim():'';};
async function convertDocx(bytes,{url,filename}){
 const files=readZip(bytes);
 if(!files['word/document.xml'])throw Error('extraction_failed');
 const mammoth=(await import('mammoth')).default;
 // mammoth reads its own copy of the archive: hand it the bounded entries, re-stored, never the original.
 // Word's Title and Subtitle styles are headings to a reader, not body paragraphs.
 const {value}=await mammoth.convertToHtml({buffer:Buffer.from(zipSync(files,{level:0}))},{styleMap:["p[style-name='Title'] => h1:fresh","p[style-name='Subtitle'] => h2:fresh"],convertImage:mammoth.images.imgElement(async()=>({src:''}))});
 const title=coreTitle(files)||filename||'';
 return fromHtml('<article>'+value.replace(/<img\b[^>]*>/g,'')+'</article>',{url,type:'docx',title});
}
function relationships(xml){const map={};for(const match of (xml||'').matchAll(/<Relationship\b[^>]*>/g))map[attr(match[0],'Id')]=attr(match[0],'Target');return map;}
const resolveTarget=(base,target)=>target.startsWith('/')?target.slice(1):new URL(target,'zip:/'+base).pathname.slice(1);
function columnIndex(reference){const letters=/^([A-Z]+)/.exec(reference||'')?.[1];if(!letters)return -1;let index=0;for(const ch of letters)index=index*26+ch.charCodeAt(0)-64;return index-1;}
async function convertXlsx(bytes,{url,filename}){
 const files=readZip(bytes,name=>/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$|^docProps\/core\.xml$/.test(name));
 const text=name=>files[name]?strFromU8(files[name]):'';
 const shared=[...text('xl/sharedStrings.xml').replace(/<rPh\b[\s\S]*?<\/rPh>/g,'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(item=>[...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(run=>xmlText(run[1])).join(''));
 const rels=relationships(text('xl/_rels/workbook.xml.rels'));
 const sheets=[...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map(match=>({name:attr(match[0],'name'),path:rels[attr(match[0],'r:id')]&&resolveTarget('xl/workbook.xml',rels[attr(match[0],'r:id')])}));
 const parts=[];let totalRows=0;
 for(const sheet of sheets){
  const xml=sheet.path?text(sheet.path):'';const rows=[];let truncated=false;
  for(const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)){
   if(!row[1])continue;
   const values=[];
   for(const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const column=columnIndex(attr(cell[0],'r'));if(column<0||column>=SCRAPE_LIMITS.maxSheetColumns)continue;
    const type=attr(cell[0],'t'),body=cell[2]||'',raw=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    values[column]=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?[...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(run=>xmlText(run[1])).join(''):type==='b'?(raw==='1'?'TRUE':'FALSE'):xmlText(raw??'');
   }
   if(!values.some(value=>String(value??'').trim()))continue;
   if(rows.length>=SCRAPE_LIMITS.maxSheetRows){truncated=true;break;}
   rows.push(Array.from(values,value=>value??''));
  }
  totalRows+=rows.length;
  parts.push('<h2>'+esc(sheet.name||'Sheet')+'</h2>'+(rows.length?table(rows):'<p><em>Empty sheet</em></p>')+(truncated?'<p><em>Only the first '+SCRAPE_LIMITS.maxSheetRows+' rows are included.</em></p>':''));
 }
 if(!totalRows)throw Error('extraction_failed');
 return fromHtml('<article>'+parts.join('')+'</article>',{url,type:'xlsx',title:coreTitle(files)||filename||'',meta:{sheets:sheets.length,rows:totalRows}});
}
// PowerPoint paragraph runs, in reading order, with explicit line breaks kept.
const paragraphs=xml=>[...xml.replace(/<a:p\b[^>]*\/>/g,'').matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(paragraph=>[...paragraph[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)].map(run=>run[1]!==undefined?xmlText(run[1]):'\n').join('').trim()).filter(Boolean);
async function convertPptx(bytes,{url,filename}){
 const files=readZip(bytes,name=>/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$|^docProps\/core\.xml$/.test(name));
 const text=name=>files[name]?strFromU8(files[name]):'';
 const rels=relationships(text('ppt/_rels/presentation.xml.rels'));
 let order=[...text('ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*>/g)].map(match=>rels[attr(match[0],'r:id')]).filter(Boolean).map(target=>resolveTarget('ppt/presentation.xml',target));
 if(!order.length)order=Object.keys(files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(/(\d+)\.xml$/.exec(a)[1])-Number(/(\d+)\.xml$/.exec(b)[1]));
 const sections=[];
 for(const [index,path] of order.entries()){
  const xml=text(path);if(!xml)continue;
  let heading='';const body=[];
  for(const block of xml.matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)){
   if(block[0].includes('<a:tbl')){
    const rows=[...block[0].matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map(row=>[...row[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map(cell=>paragraphs(cell[1]).join(' ')));
    if(rows.length)body.push(table(rows));continue;
   }
   const lines=paragraphs(block[0]);if(!lines.length)continue;
   if(!heading&&/<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(block[0])){heading=lines.join(' ');continue;}
   body.push(lines.map(line=>'<p>'+esc(line).replace(/\n/g,'<br>')+'</p>').join(''));
  }
  const slideRels=relationships(text(path.replace(/slides\/(slide\d+\.xml)$/,'slides/_rels/$1.rels')));
  const notesTarget=Object.values(slideRels).find(target=>/notesSlide\d+\.xml$/.test(target));
  const notesXml=notesTarget?text(resolveTarget(path,notesTarget)):'';
  // Speaker notes: the body placeholder, not the slide-number or thumbnail placeholders.
  const notes=[...notesXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].filter(shape=>/<p:ph\b[^>]*type="body"/.test(shape[0])).flatMap(shape=>paragraphs(shape[0]));
  sections.push('<section><h2>Slide '+(index+1)+(heading?': '+esc(heading):'')+'</h2>'+body.join('')+(notes.length?'<h3>Speaker notes</h3>'+notes.map(line=>'<p>'+esc(line)+'</p>').join(''):'')+'</section>');
 }
 if(!sections.length)throw Error('extraction_failed');
 return fromHtml('<article>'+sections.join('')+'</article>',{url,type:'pptx',title:coreTitle(files)||filename||'',meta:{slides:sections.length}});
}
// RFC 4180: quoted fields may hold the delimiter, doubled quotes and line breaks.
function parseDelimited(text,delimiter){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=ch;continue;}
  if(ch==='"'&&field==='')quoted=true;
  else if(ch===delimiter){row.push(field);field='';}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(value=>value!==''))rows.push(row);row=[];if(rows.length>SCRAPE_LIMITS.maxSheetRows)break;}
  else field+=ch;
 }
 if(field!==''||row.length){row.push(field);if(row.some(value=>value!==''))rows.push(row);}
 return rows;
}
function convertDelimited(bytes,{contentType,url,filename,kind}){
 const rows=parseDelimited(decodeText(bytes,contentType),kind==='tsv'?'\t':',');
 if(!rows.length)throw Error('extraction_failed');
 const truncated=rows.length>SCRAPE_LIMITS.maxSheetRows;
 const shown=rows.slice(0,SCRAPE_LIMITS.maxSheetRows).map(row=>row.slice(0,SCRAPE_LIMITS.maxSheetColumns));
 return fromHtml('<article>'+table(shown)+(truncated?'<p><em>Only the first '+SCRAPE_LIMITS.maxSheetRows+' rows are included.</em></p>':'')+'</article>',{url,type:kind,title:filename||'',meta:{rows:shown.length}});
}
function convertFeed(xml,{url,filename}){
 const dom=new JSDOM(xml,{contentType:'text/xml'});const document=dom.window.document;
 const pick=(node,...names)=>{for(const name of names){const found=node.getElementsByTagName(name)[0];if(found)return found;}return null;};
 // Summaries are HTML: keep the words, drop anything that is code rather than prose.
 const plain=html=>{const fragment=JSDOM.fragment('<div>'+html+'</div>');fragment.querySelectorAll('script,style,noscript,template,iframe,object').forEach(node=>node.remove());return (fragment.textContent||'').replace(/\s+/g,' ').trim();};
 const channel=pick(document,'channel','feed')||document.documentElement;
 const title=(pick(channel,'title')?.textContent||filename||'').trim();
 const items=Array.from(document.getElementsByTagName('item')).concat(Array.from(document.getElementsByTagName('entry'))).slice(0,500).map(item=>{
  const link=pick(item,'link');const href=link?.getAttribute('href')||link?.textContent||'';
  const summary=plain(pick(item,'description','summary','content','content:encoded')?.textContent||'');
  return '<section><h2>'+(href?'<a href="'+esc(href.trim())+'">'+esc(pick(item,'title')?.textContent?.trim()||href)+'</a>':esc(pick(item,'title')?.textContent?.trim()||'Untitled'))+'</h2>'+
   ((pick(item,'pubDate','published','updated','dc:date')?.textContent||'').trim()?'<p><em>'+esc(pick(item,'pubDate','published','updated','dc:date').textContent.trim())+'</em></p>':'')+
   (summary?'<p>'+esc(summary.length>600?summary.slice(0,600)+'…':summary)+'</p>':'')+'</section>';
 });
 dom.window.close();
 if(!items.length)throw Error('extraction_failed');
 return fromHtml('<article><h1>'+esc(title)+'</h1>'+items.join('')+'</article>',{url,type:'feed',title,meta:{items:items.length}});
}
function convertXml(bytes,{contentType,url,filename,kind}){
 const xml=decodeText(bytes,contentType);
 if(kind==='xml'&&/<(rss|feed)\b/.test(xml.slice(0,4096))&&/<(item|entry)\b/.test(xml))return convertFeed(xml,{url,filename});
 const text=xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
 return {title:filename||'',markdown:fence('xml',xml),text:xmlText(text),links:urlsIn(xml),code:fence('xml',xml),type:kind,meta:{}};
}
// Minimal RTF reader: text, paragraph and tab breaks, \' and \u escapes; skips fonts, colours, pictures and metadata.
const RTF_SKIP=new Set(['fonttbl','colortbl','stylesheet','info','pict','header','footer','headerl','headerr','footerl','footerr','object','themedata','datastore','xmlnstbl','listtable','listoverridetable','rsidtbl','generator','latentstyles','mmathPr','fldinst']);
function rtfToText(rtf){
 const cp1252=new TextDecoder('windows-1252');const out=[],stack=[];let skip=false,i=0;
 while(i<rtf.length){
  const ch=rtf[i];
  if(ch==='{'){stack.push(skip);i++;continue;}
  if(ch==='}'){skip=stack.pop()??false;i++;continue;}
  if(ch==='\\'){
   const match=/^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\([\s\S])/.exec(rtf.slice(i,i+48));
   if(!match){i++;continue;}
   i+=match[0].length;
   if(match[3]){if(!skip)out.push(cp1252.decode(Uint8Array.of(parseInt(match[3],16))));continue;}
   if(match[4]!==undefined){if(match[4]==='*')skip=true;else if(!skip&&'\\{}'.includes(match[4]))out.push(match[4]);else if(!skip&&match[4]==='~')out.push(' ');else if(!skip&&(match[4]==='\n'||match[4]==='\r'))out.push('\n');continue;}
   const word=match[1];
   if(RTF_SKIP.has(word)){skip=true;continue;}
   if(skip)continue;
   if(word==='par'||word==='line'||word==='row'||word==='sect'||word==='page')out.push('\n');
   else if(word==='tab'||word==='cell')out.push('\t');
   else if(word==='u'&&match[2]){let code=Number(match[2]);if(code<0)code+=65536;out.push(String.fromCharCode(code));if(rtf.startsWith("\\'",i))i+=4;else if(rtf[i]&&!'\\{}'.includes(rtf[i]))i++;}
   continue;
  }
  if(ch!=='\r'&&ch!=='\n'&&!skip)out.push(ch);
  i++;
 }
 return out.join('').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function imageSize(bytes){
 const b=Buffer.from(bytes);
 try{
  if(b[0]===0x89&&b[1]===0x50)return {format:'PNG',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(b[0]===0x47&&b[1]===0x49)return {format:'GIF',width:b.readUInt16LE(6),height:b.readUInt16LE(8)};
  if(b[0]===0x42&&b[1]===0x4d)return {format:'BMP',width:b.readInt32LE(18),height:Math.abs(b.readInt32LE(22))};
  if(b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP'){
   const chunk=b.toString('latin1',12,16);
   if(chunk==='VP8 ')return {format:'WebP',width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};
   if(chunk==='VP8L'){const bits=b.readUInt32LE(21);return {format:'WebP',width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1};}
   if(chunk==='VP8X')return {format:'WebP',width:b.readUIntLE(24,3)+1,height:b.readUIntLE(27,3)+1};
  }
  if(b[0]===0xff&&b[1]===0xd8){
   let p=2;
   while(p+9<b.length){if(b[p]!==0xff){p++;continue;}const marker=b[p+1];if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return {format:'JPEG',width:b.readUInt16BE(p+7),height:b.readUInt16BE(p+5)};p+=2+b.readUInt16BE(p+2);}
   return {format:'JPEG'};
  }
 }catch{}
 return {format:'image'};
}
function convertText(bytes,{kind,ext,contentType,url,filename,mainContentOnly}){
 if(kind==='rtf'){const text=rtfToText(decodeText(bytes,'charset=latin1'));if(!text)throw Error('extraction_failed');return {title:filename||'',markdown:text,text,links:urlsIn(text),code:'',type:'rtf',meta:{}};}
 const text=decodeText(bytes,contentType);
 if(kind==='html')return fromHtml(text,{url,mainContentOnly,type:'html'});
 if(!text.trim())throw Error('extraction_failed');
 if(kind==='json'){let body=text;try{body=JSON.stringify(JSON.parse(text),null,2);}catch{}return {title:filename||'',markdown:fence('json',body),text,links:urlsIn(text),code:fence('json',body),type:'json',meta:{}};}
 if(kind==='yaml')return {title:filename||'',markdown:fence('yaml',text),text,links:urlsIn(text),code:fence('yaml',text),type:'yaml',meta:{}};
 if(kind==='code'){const language=codeLanguage(ext)||(/javascript/.test(contentType)?'javascript':/css/.test(contentType)?'css':'');return {title:filename||'',markdown:fence(language,text),text,links:urlsIn(text),code:fence(language,text),type:'code',meta:{language}};}
 if(kind==='markdown')return {title:/^#\s+(.+)$/m.exec(text)?.[1]?.trim()||filename||'',markdown:text.trim(),text,links:urlsIn(text),code:fencedBlocks(text),type:'markdown',meta:{}};
 return {title:filename||'',markdown:text.trim(),text,links:urlsIn(text),code:'',type:'text',meta:{}};
}
const CONVERTERS={pdf:convertPdf,docx:convertDocx,xlsx:convertXlsx,pptx:convertPptx,csv:convertDelimited,tsv:convertDelimited,xml:convertXml,svg:convertXml};
export async function convertDocument(bytes,{contentType='',extension='',url,filename,formats=['markdown'],pageRange,mainContentOnly=true}={}){
 if(bytes.length>SCRAPE_LIMITS.fileBytes)throw Error('result_too_large');
 const detected=detectKind({contentType,extension,url,filename,bytes});
 if(!detected)throw Error('unsupported_file_type');
 const name=filename||filenameOf(url);
 const context={...detected,contentType,url,filename:name,pageRange,mainContentOnly};
 let doc;
 if(detected.kind==='image'){
  const size=imageSize(bytes);const dimensions=size.width?size.width+'×'+size.height+'px, ':'';
  const line=size.format+' image, '+dimensions+Math.ceil(bytes.length/1024)+' KB';
  doc={title:name,markdown:(url?'!['+name.replace(/[[\]]/g,'')+']('+url+')\n\n':'')+'_'+line+'_',text:line,links:url?[url]:[],code:'',type:'image',meta:size};
 }else doc=await (CONVERTERS[detected.kind]||convertText)(bytes,context);
 // Every requested format is answered on its own, as for web pages.
 const outputs={};
 for(const format of formats){
  let data=null;
  if(format==='markdown'||format==='text')data=doc[format]??null;
  else if(format==='html')data=doc.html??null;
  else if(format==='links')data=doc.links??[];
  else if(format==='code')data=doc.code??fencedBlocks(doc.markdown||'');
  else if(format==='bytes'&&bytes.length<=SCRAPE_LIMITS.bytesFormatBytes)data='data:'+((contentType.split(';')[0].trim())||'application/octet-stream')+';base64,'+Buffer.from(bytes).toString('base64');
  outputs[format]={requested:true,success:data!==null&&data!==undefined,data:data??null};
 }
 if(!Object.values(outputs).some(output=>output.success))throw Error('extraction_failed');
 return {title:doc.title||name||'',formats:outputs,isPartial:Object.values(outputs).some(output=>!output.success),document:{type:doc.type,contentType:contentType.split(';')[0].trim()||null,bytes:bytes.length,...doc.meta}};
}
