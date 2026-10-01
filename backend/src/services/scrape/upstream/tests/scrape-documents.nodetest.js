import test from 'node:test';import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {convertDocument,detectKind} from '../src/services/scrape/documents.js';
import {runConversion} from '../src/services/scrape/convert.js';
import {SCRAPE_FILE_TYPES,SCRAPE_LIMITS} from '../src/services/ScrapePolicy.js';
// Real files, built here so every structural detail is visible in the test.
function pdf(pages,{title,link}={}){
 const objects=[],esc=text=>text.replace(/[\\()]/g,ch=>'\\'+ch);
 objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
 objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
 objects[4]='<< /Title ('+esc(title||'')+') >>';
 const kids=[];
 pages.forEach((lines,index)=>{
  const page=5+index*3,content=page+1,annot=page+2;kids.push(page+' 0 R');
  const stream=lines?'BT /F1 12 Tf 14 TL 72 720 Td '+lines.map(line=>'('+esc(line)+') Tj T*').join(' ')+' ET':'';
  objects[content]='<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream';
  objects[annot]=link&&index===0?'<< /Type /Annot /Subtype /Link /Rect [72 700 300 720] /Border [0 0 0] /A << /S /URI /URI ('+link+') >> >>':'<< >>';
  objects[page]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+content+' 0 R'+(link&&index===0?' /Annots ['+annot+' 0 R]':'')+' >>';
 });
 objects[2]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages.length+' >>';
 let out='%PDF-1.4\n';const offsets=[];
 for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(out,'latin1');out+=i+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=Buffer.byteLength(out,'latin1');
 out+='xref\n0 '+objects.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
 out+='trailer\n<< /Size '+objects.length+' /Root 1 0 R /Info 4 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 return Buffer.from(out,'latin1');
}
const W='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const core=title=>'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'+title+'</dc:title></cp:coreProperties>';
const zip=files=>Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,typeof text==='string'?strToU8(text):text]))));
const docx=()=>zip({
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+REL+'/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+REL+'/styles" Target="styles.xml"/><Relationship Id="rId2" Type="'+REL+'/hyperlink" Target="https://agnt.gg/" TargetMode="External"/></Relationships>',
 'word/styles.xml':'<w:styles '+W+'><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
 'word/document.xml':'<w:document '+W+'><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly Report</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Revenue</w:t></w:r><w:r><w:t xml:space="preserve"> grew. See </w:t></w:r><w:hyperlink r:id="rId2"><w:r><w:t>AGNT</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>EU|West</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
 'docProps/core.xml':core('Q3 Report'),
});
const S='xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="'+REL+'"';
const xlsx=()=>zip({
 'xl/workbook.xml':'<workbook '+S+'><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+REL+'/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="'+REL+'/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
 'xl/sharedStrings.xml':'<sst '+S+'><si><t>Item</t></si><si><t>Qty</t></si><si><r><t>Wid</t></r><r><t>get &amp; co</t></r></si></sst>',
 'xl/worksheets/sheet1.xml':'<worksheet '+S+'><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>In stock</t></is></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12.5</v></c><c r="C2" t="b"><v>1</v></c></row><row r="3"/><row r="4"><c r="C4"><v>7</v></c></row></sheetData></worksheet>',
 'xl/worksheets/sheet2.xml':'<worksheet '+S+'><sheetData/></worksheet>',
});
const P='xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="'+REL+'" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const shape=(type,...lines)=>'<p:sp><p:nvSpPr><p:nvPr>'+(type?'<p:ph type="'+type+'"/>':'')+'</p:nvPr></p:nvSpPr><p:txBody>'+lines.map(line=>'<a:p><a:r><a:t>'+line+'</a:t></a:r></a:p>').join('')+'<a:p/></p:txBody></p:sp>';
const pptx=()=>zip({
 'ppt/presentation.xml':'<p:presentation '+P+'><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
 'ppt/_rels/presentation.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="'+REL+'/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="'+REL+'/slide" Target="slides/slide2.xml"/></Relationships>',
 'ppt/slides/slide1.xml':'<p:sld '+P+'><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Plan</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Price</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Pro</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>$15</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
 'ppt/slides/slide2.xml':'<p:sld '+P+'><p:cSld><p:spTree>'+shape('title','Roadmap')+shape('','Ship Scrape','Add PDFs &amp; Office')+'</p:spTree></p:cSld></p:sld>',
 'ppt/slides/_rels/slide2.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="'+REL+'/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
 'ppt/notesSlides/notesSlide1.xml':'<p:notes '+P+'><p:cSld><p:spTree>'+shape('body','Mention pricing')+shape('sldNum','2')+'</p:spTree></p:cSld></p:notes>',
 'docProps/core.xml':core('Launch deck'),
});
const convert=(bytes,options)=>convertDocument(bytes,{formats:['markdown','text','links','html','code'],...options});
test('every advertised extension routes to a converter',()=>{
 assert.ok(Object.keys(SCRAPE_FILE_TYPES).length>=40,'40+ file types');
 for(const [extension,kind] of Object.entries(SCRAPE_FILE_TYPES)){
  if(['pdf','docx','xlsx','pptx','image'].includes(kind))continue;// binary formats are recognised by signature, tested below
  assert.equal(detectKind({extension,bytes:Buffer.from('x')})?.kind,kind,extension);
 }
});
test('PDF: per-page markdown, title from metadata, link annotations, and a page range',async()=>{
 const file=pdf([['Attention Is All You Need','We propose the Transformer.'],['Section two (results)','BLEU improved.'],['Appendix','See https://arxiv.org/abs/1706.03762.']],{title:'Transformer Paper',link:'https://agnt.gg/paper'});
 const out=await convert(file,{url:'https://example.com/paper.pdf',contentType:'application/pdf'});
 assert.equal(out.title,'Transformer Paper');assert.equal(out.document.type,'pdf');assert.equal(out.document.pages,3);
 const md=out.formats.markdown.data;
 assert.match(md,/^# Transformer Paper\n\n## Page 1\n\nAttention Is All You Need\nWe propose the Transformer\./);
 assert.match(md,/## Page 2\n\nSection two \(results\)/);
 assert.deepEqual(out.formats.links.data.sort(),['https://agnt.gg/paper','https://arxiv.org/abs/1706.03762']);
 assert.match(out.formats.html.data,/<h2>Page 3<\/h2>/);
 const ranged=await convert(file,{contentType:'application/pdf',pageRange:'2-9'});
 assert.ok(!/## Page 1\b/.test(ranged.formats.markdown.data)&&/## Page 3/.test(ranged.formats.markdown.data),'from page 2, clamped to the last page');
 assert.deepEqual(ranged.document.pagesConverted,[2,3]);
 await assert.rejects(convert(file,{contentType:'application/pdf',pageRange:'9'}),/invalid_page_range/);
});
test('PDF without a text layer is reported, not returned empty; a short real page is text',async()=>{
 await assert.rejects(convert(pdf([null,null]),{extension:'pdf'}),/pdf_images_only/);
 const short=await convert(pdf([['Invoice 42']]),{extension:'pdf'});
 assert.match(short.formats.markdown.data,/Invoice 42/,'one short line is a text document, not a scan');
});
test('Word: headings, bold, links, and a table with an escaped pipe',async()=>{
 const out=await convert(docx(),{filename:'report.docx'});
 const md=out.formats.markdown.data;
 assert.equal(out.title,'Q3 Report');assert.equal(out.document.type,'docx');
 assert.match(md,/^# Quarterly Report/);
 assert.match(md,/\*\*Revenue\*\* grew\. See \[AGNT\]\(https:\/\/agnt\.gg\/\)/);
 assert.match(md,/\| Region \| Sales \|\n\| --- \| --- \|\n\| EU\\\|West \| 42 \|/);
 assert.deepEqual(out.formats.links.data,['https://agnt.gg/']);
});
test('Excel: sheets as tables, shared, inline and boolean cells, empty sheets named',async()=>{
 const out=await convert(xlsx(),{filename:'stock.xlsx'});
 const md=out.formats.markdown.data;
 assert.equal(out.document.sheets,2);
 assert.match(md,/## Sales\n\n\| Item \| Qty \| In stock \|\n\| --- \| --- \| --- \|\n\| Widget & co \| 12\.5 \| TRUE \|\n\|  \|  \| 7 \|/);
 assert.match(md,/## Empty\n\n_Empty sheet_/);
});
test('PowerPoint: presentation order, titles, tables and speaker notes (not slide numbers)',async()=>{
 const out=await convert(pptx(),{filename:'deck.pptx'});
 const md=out.formats.markdown.data;
 assert.equal(out.title,'Launch deck');assert.equal(out.document.slides,2);
 assert.ok(md.indexOf('## Slide 1: Roadmap')<md.indexOf('## Slide 2'),'sldIdLst order, not file names');
 assert.match(md,/Ship Scrape\n\nAdd PDFs & Office/);
 assert.match(md,/### Speaker notes\n\nMention pricing/);
 assert.ok(!/Speaker notes\n\nMention pricing\n\n2/.test(md),'slide number placeholder skipped');
 assert.match(md,/\| Plan \| Price \|\n\| --- \| --- \|\n\| Pro \| \$15 \|/);
});
test('CSV and TSV: quoted delimiters, doubled quotes and line breaks',async()=>{
 const out=await convert(Buffer.from('name,note\n"Smith, J","He said ""hi"""\n"Lee","two\nlines"\n'),{extension:'csv'});
 assert.match(out.formats.markdown.data,/\| name \| note \|\n\| --- \| --- \|\n\| Smith, J \| He said "hi" \|\n\| Lee \| two lines \|/);
 const tsv=await convert(Buffer.from('a\tb\n1\t2\n'),{contentType:'text/tab-separated-values'});
 assert.match(tsv.formats.markdown.data,/\| a \| b \|/);
});
test('Data and source files come back fenced with their language',async()=>{
 const json=await convert(Buffer.from('{"a":1,"b":[1,2]}'),{contentType:'application/json; charset=utf-8'});
 assert.equal(json.formats.markdown.data,'```json\n{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n```');
 const py=await convert(Buffer.from('def hi():\n    return "```"\n'),{url:'https://raw.githubusercontent.com/x/y/main/app.py',contentType:'text/plain'});
 assert.match(py.formats.markdown.data,/^````python\ndef hi\(\):/,'text/plain source keeps its language and survives embedded fences');
 const yaml=await convert(Buffer.from('a: 1\n'),{extension:'yml'});assert.equal(yaml.formats.markdown.data,'```yaml\na: 1\n```');
 const md=await convert(Buffer.from('# Notes\n\nSee https://agnt.gg.\n'),{extension:'md'});
 assert.equal(md.title,'Notes');assert.deepEqual(md.formats.links.data,['https://agnt.gg']);
 assert.equal(md.formats.html.success,false,'no html is invented for markdown');
});
test('RSS feeds become a readable list; summaries are text, never markup',async()=>{
 const feed='<?xml version="1.0"?><rss version="2.0"><channel><title>AGNT Blog</title><item><title>Scrape ships</title><link>https://agnt.gg/blog/scrape</link><pubDate>Wed, 24 Sep 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Any page &lt;script&gt;alert(1)&lt;/script&gt;ready.&lt;/p&gt;</description></item><item><title>Second</title><link>https://agnt.gg/blog/2</link></item></channel></rss>';
 const out=await convert(Buffer.from(feed),{contentType:'application/rss+xml'});
 const md=out.formats.markdown.data;
 assert.equal(out.document.type,'feed');assert.equal(out.document.items,2);
 assert.match(md,/^# AGNT Blog\n\n## \[Scrape ships\]\(https:\/\/agnt\.gg\/blog\/scrape\)\n\n_Wed, 24 Sep 2026 10:00:00 GMT_\n\nAny page/);
 assert.ok(!/<script|alert\(1\)/.test(md),'feed markup is flattened to text');
});
test('RTF, images and HTML uploads',async()=>{
 const rtf=await convert(Buffer.from("{\\rtf1\\ansi{\\fonttbl\\f0 Arial;}{\\*\\generator Word;}\\f0 Hello \\b world\\b0\\par Caf\\'e9 \\u8364?\\par}",'latin1'),{extension:'rtf'});
 assert.equal(rtf.formats.text.data,'Hello world\nCafé €');
 const png=Buffer.alloc(33);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png);png.writeUInt32BE(640,16);png.writeUInt32BE(480,20);
 const image=await convert(png,{url:'https://example.com/logo.png'});
 assert.equal(image.document.width,640);assert.match(image.formats.markdown.data,/^!\[logo\.png\]\(https:\/\/example\.com\/logo\.png\)\n\n_PNG image, 640×480px/);
 const page=await convert(Buffer.from('<html><head><title>Upload</title></head><body><nav>menu</nav><main><h1>Body</h1></main></body></html>'),{extension:'html'});
 assert.equal(page.formats.markdown.data,'# Body');
});
test('formats are answered one by one: bytes returned, screenshot unavailable, partial flagged',async()=>{
 const out=await convertDocument(Buffer.from('a,b\n1,2\n'),{extension:'csv',contentType:'text/csv',formats:['markdown','bytes','screenshot']});
 assert.equal(out.formats.bytes.data,'data:text/csv;base64,'+Buffer.from('a,b\n1,2\n').toString('base64'));
 assert.equal(out.formats.screenshot.success,false);assert.equal(out.isPartial,true);
});
test('unknown, mislabelled and hostile files are refused cleanly',async()=>{
 await assert.rejects(convert(Buffer.from('MZ\x90\x00binary'),{extension:'exe'}),/unsupported_file_type/);
 await assert.rejects(convert(zip({'readme.txt':'hi'}),{extension:'zip'}),/unsupported_file_type/,'a zip that is not an Office file');
 await assert.rejects(convert(Buffer.from('not a pdf'),{contentType:'application/pdf'}),/unsupported_file_type/,'a PDF label without a PDF signature');
 const renamed=await convert(docx(),{extension:'txt',contentType:'text/plain'});assert.equal(renamed.document.type,'docx','the signature wins over the label');
 // An archive declaring more than the unzip budget is refused before anything is inflated.
 const bomb=zip({'[Content_Types].xml':'<Types/>','word/document.xml':new Uint8Array(SCRAPE_LIMITS.maxUnzippedBytes+1)});
 assert.ok(bomb.length<1024*1024,'fixture compresses to under 1 MB');
 await assert.rejects(convert(bomb,{extension:'docx'}),/result_too_large/);
 await assert.rejects(convert(Buffer.alloc(SCRAPE_LIMITS.fileBytes+1),{extension:'txt'}),/result_too_large/);
});
test('conversion runs in a bounded thread: results cross back, and a deadline terminates it',async()=>{
 const file=pdf([['Thread-safe text']]);
 const out=await runConversion(file,{contentType:'application/pdf',formats:['markdown']},{timeoutMs:20000});
 assert.match(out.formats.markdown.data,/Thread-safe text/);
 await assert.rejects(runConversion(file,{contentType:'application/pdf',formats:['markdown']},{timeoutMs:1}),/scrape_timeout/);
 await assert.rejects(runConversion(Buffer.from('MZ'),{extension:'exe',formats:['markdown']},{timeoutMs:20000}),/unsupported_file_type/,'known errors cross the thread boundary intact');
});
