import test from 'node:test';import assert from 'node:assert/strict';
import {extract,blocked,visibleTextLength} from '../src/services/scrape/extract.js';
const article=`<!doctype html><html><head><title>Guide</title><style>.x{}</style></head><body>
<header><nav><a href="/home">Home</a></nav></header>
<main><h1>Install</h1><p>Run the <strong>installer</strong> and read the <a href="/docs/next">next step</a>.</p>
<ul><li>First</li><li>Second</li></ul>
<pre><code class="language-bash">npm install agnt
agnt start</code></pre></main>
<footer>Copyright junk</footer><script>track()</script></body></html>`;
test('every format comes from one document, main content only by default',()=>{
 const out=extract(article,'https://docs.example.com/guide',{formats:['markdown','html','text','links','code']});
 assert.equal(out.title,'Guide');
 assert.match(out.markdown,/^# Install/);assert.match(out.markdown,/\*\*installer\*\*/);assert.match(out.markdown,/\[next step\]\(https:\/\/docs\.example\.com\/docs\/next\)/);
 assert.match(out.markdown,/```bash\nnpm install agnt\nagnt start\n```/,'fenced code keeps its language');
 assert.match(out.markdown,/- First\n- Second/);
 assert.ok(!/Copyright junk|Home|track\(\)/.test(out.markdown),'header, footer, nav and scripts removed');
 assert.ok(!/Copyright junk/.test(out.text));assert.ok(out.html.startsWith('<main>'));
 assert.deepEqual(out.links,['https://docs.example.com/home','https://docs.example.com/docs/next'],'links are absolute and come from the whole page');
 assert.match(out.code,/```bash\nnpm install agnt/);
});
test('shadow DOM content (MDN code examples) is extracted, not lost',()=>{
 // The exact production shape: an empty custom element whose code lives in its shadow root.
 const html='<html><head><title>Using Fetch</title></head><body><main><h1>Using Fetch</h1><p>Call fetch:</p><mdn-code-example class="brush: js notranslate"><template shadowrootmode="open"><style>.hl{}</style><div class="wrap"><template shadowrootmode="closed"><span>inner</span></template><pre><code class="language-js">const response = await fetch(url);</code></pre></div></template></mdn-code-example><p>Then read the body.</p></main></body></html>';
 const out=extract(html,'https://developer.mozilla.org/x',{formats:['markdown','code','text']});
 assert.match(out.markdown,/```js\nconst response = await fetch\(url\);\n```/,'code fence recovered from the shadow root');
 assert.match(out.code,/```js\nconst response = await fetch\(url\);/);
 assert.match(out.text,/inner/,'nested shadow roots are inlined too');
 assert.ok(!/\.hl\{\}/.test(out.markdown),'shadow styles do not leak into content');
 assert.ok(visibleTextLength(html)>40,'wall detection counts shadow text as real text');
});
test('tables: data tables become markdown, headerless ones get a header, layout tables are flattened',()=>{
 const html='<html><body><main><table><tr><th>Plan</th><th>Note</th></tr><tr><td>Pro</td><td>a|b<br>c</td></tr></table>'+
  '<table><tr><td>2026</td><td>up</td></tr><tr><td>2027</td><td>flat</td></tr></table>'+
  '<table><tr><td><table><tr><th>Inner</th></tr><tr><td>x</td></tr></table></td><td>Side text</td></tr></table></main></body></html>';
 const out=extract(html,'https://a.com/',{formats:['markdown','html']});
 assert.match(out.markdown,/\| Plan \| Note \|\n\| --- \| --- \|\n\| Pro \| a\\\|b c \|/,'pipes escaped, line breaks folded');
 assert.match(out.markdown,/\| 2026 \| up \|\n\| --- \| --- \|\n\| 2027 \| flat \|/,'first row promoted to a header');
 assert.match(out.markdown,/\| Inner \|\n\| --- \|\n\| x \|\n\nSide text/,'layout table flattened, the data table inside it kept');
 assert.ok(!/<table|<td/.test(out.markdown),'no raw table HTML leaks into markdown');
 assert.match(out.html,/<td>2026<\/td>/,'the html format is the page as it was');
});
test('mainContentOnly false keeps the full page',()=>{
 const out=extract(article,'https://docs.example.com/guide',{formats:['text','html'],mainContentOnly:false});
 assert.match(out.text,/Copyright junk/);assert.match(out.html,/<footer>/);
});
test('only requested formats are produced',()=>{
 const out=extract(article,'https://docs.example.com/',{formats:['markdown']});
 assert.deepEqual(Object.keys(out).sort(),['markdown','title']);
});
test('an empty page is an extraction failure, not a billable page',()=>{
 assert.throws(()=>extract('<html><body><script>x()</script></body></html>','https://a.com/',{formats:['markdown']}),/extraction_failed/);
});
test('bot walls are recognised; real pages with a captcha widget are not',()=>{
 const cloudflare='<html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div></body></html>';
 assert.equal(blocked({status:403,title:'Just a moment...',html:cloudflare,textLength:visibleTextLength(cloudflare)}),true);
 assert.equal(blocked({status:200,title:'Just a moment...',html:cloudflare,textLength:visibleTextLength(cloudflare)}),true,'challenge served with 200');
 const datadome='<html><head><title>example.com</title></head><body><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>';
 assert.equal(blocked({status:200,title:'example.com',html:datadome,textLength:visibleTextLength(datadome)}),true);
 assert.equal(blocked({status:429,title:'Too Many Requests',html:'',textLength:0}),true);
 const contact='<html><head><title>Contact us</title></head><body><main>'+'We answer every message within a day. '.repeat(80)+'<div class="g-recaptcha"></div></main></body></html>';
 assert.equal(blocked({status:200,title:'Contact us',html:contact,textLength:visibleTextLength(contact)}),false,'a long real page with a form captcha is content');
 assert.equal(blocked({status:200,title:'Guide',html:article,textLength:visibleTextLength(article)}),false);
});
