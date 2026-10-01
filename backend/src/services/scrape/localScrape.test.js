import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { getBestChromePath } from '../../utils/chrome-detector.js';
import { scrapeUrl, normalizeScrapeInput, closeScrapeBrowser, scrapeBrowserIsOpen, SCRAPE_ERROR_MESSAGES } from './localScrape.js';

/**
 * The desktop scraper against a local server, in real Chrome. What each case pins came out of
 * a side-by-side run against scrape.agnt.gg's pipeline (2026-10-01), where the old scraper:
 * returned no file content at all (PDF, Word, Excel, CSV, JSON...), flattened tables, lost
 * shadow-DOM code, returned 404 pages and bot walls as content, and reported failures as
 * success. The conversion itself is covered by the hosted suites (upstream.integrity.test.js).
 */
describe('normalizeScrapeInput', () => {
  it('defaults to markdown only, like the hosted API', () => {
    expect(normalizeScrapeInput({ url: 'example.com' })).toEqual({ url: 'https://example.com/', formats: ['markdown'], mainContentOnly: true, waitForMs: 0, allowLocal: false });
  });

  it('accepts formats as an array, a comma list or an object, in the hosted order', () => {
    for (const formats of [['links', 'markdown'], 'links,markdown', { markdown: true, links: true }]) {
      expect(normalizeScrapeInput({ url: 'https://x.test', formats }).formats).toEqual(['markdown', 'links']);
    }
  });

  it('takes the loose types editors and models send', () => {
    expect(normalizeScrapeInput({ url: 'https://x.test', formats: null, mainContentOnly: 'false', waitForMs: '250', pageRange: 5 }))
      .toMatchObject({ formats: ['markdown'], mainContentOnly: false, waitForMs: 250, pageRange: '5' });
  });

  it('allows any port: it runs as the user, not as a shared cloud worker', () => {
    expect(normalizeScrapeInput({ url: 'https://example.com:8443/app' }).url).toBe('https://example.com:8443/app');
  });

  it('reads allowLocal as editors and models send it; anything else is not a yes', () => {
    expect(normalizeScrapeInput({ url: 'http://localhost:5173/', allowLocal: true }).allowLocal).toBe(true);
    expect(normalizeScrapeInput({ url: 'http://localhost:5173/', allowLocal: 'true' }).allowLocal).toBe(true);
    expect(normalizeScrapeInput({ url: 'http://localhost:5173/', allowLocal: 'false' }).allowLocal).toBe(false);
    expect(normalizeScrapeInput({ url: 'http://localhost:5173/', allowLocal: null }).allowLocal).toBe(false);
    expect(() => normalizeScrapeInput({ url: 'http://localhost:5173/', allowLocal: 'yes' })).toThrow('invalid_request');
    expect(() => normalizeScrapeInput({ url: 'http://localhost:5173/', allowLocal: 1 })).toThrow('invalid_request');
  });

  it.each([
    [{ url: 'file:///C:/Windows/win.ini' }, 'invalid_url'],
    [{ url: 'javascript:alert(1)' }, 'invalid_url'],
    [{ url: '' }, 'invalid_url'],
    [{ url: 'https://x.test', formats: ['pdf'] }, 'invalid_formats'],
    [{ url: 'https://x.test', waitForMs: 60000 }, 'invalid_request'],
    [{ url: 'https://x.test', pageRange: '9-2' }, 'invalid_page_range'],
  ])('refuses %j with %s', (input, code) => {
    expect(() => normalizeScrapeInput(input)).toThrow(code);
  });

  it('has a sentence for every error it can return', () => {
    for (const code of ['invalid_url', 'invalid_formats', 'invalid_request', 'invalid_page_range', 'destination_not_allowed']) expect(SCRAPE_ERROR_MESSAGES[code]).toBeTruthy();
  });
});

// A minimal real PDF with a text layer (the hosted documents suite builds the same shape).
function pdf(lines) {
  const stream = 'BT /F1 12 Tf 14 TL 72 720 Td ' + lines.map((line) => `(${line}) Tj T*`).join(' ') + ' ET';
  const objects = [null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) { offsets[i] = Buffer.byteLength(out, 'latin1'); out += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

// A minimal real .docx: the three parts Word and mammoth require.
const docx = () => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p><w:p><w:r><w:t>Revenue grew.</w:t></w:r></w:p></w:body></w:document>'),
}));

const ARTICLE = `<!doctype html><html><head><title>Guide</title></head><body>
<nav><a href="/home">Home</a></nav>
<main><h1>Install</h1><p>Read the <a href="/docs/next">next step</a>.</p>
<table><tr><td>Plan</td><td>Price</td></tr><tr><td>Pro</td><td>$15</td></tr></table>
<pre><code class="language-bash">npm install agnt</code></pre>
<mdn-code-example><template shadowrootmode="open"><pre><code class="language-js">const shadow = true;</code></pre></template></mdn-code-example>
</main><footer>Copyright junk</footer></body></html>`;

const ROUTES = {
  '/article': [200, 'text/html; charset=utf-8', ARTICLE],
  '/missing': [404, 'text/html', '<html><body><h1>Not here</h1></body></html>'],
  '/forbidden': [403, 'text/html', '<html><body>Forbidden</body></html>'],
  '/challenge': [200, 'text/html', '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'],
  '/report.pdf': [200, 'application/pdf', pdf(['Attention is all you need', 'Page one text'])],
  '/report.docx': [200, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx(), { 'Content-Disposition': 'attachment; filename="report.docx"' }],
  '/data.csv': [200, 'text/csv', 'name,price\n"Pro, yearly",150\nStarter,5\n'],
  '/data.json': [200, 'application/json', '{"name":"agnt","tags":["a","b"]}'],
  '/empty': [200, 'text/html', '<html><body></body></html>'],
};

const chrome = getBestChromePath();

describe.skipIf(!chrome)('scrapeUrl in real Chrome', () => {
  let server;
  let base;
  const hits = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      hits.push(new URL(request.url, 'http://x').pathname);
      const route = ROUTES[new URL(request.url, 'http://x').pathname];
      if (!route) { response.writeHead(500).end(); return; }
      const [status, type, body, headers = {}] = route;
      response.writeHead(status, { 'Content-Type': type, ...headers });
      response.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await closeScrapeBrowser();
    await new Promise((resolve) => server.close(resolve));
  });

  it('refuses this computer by default, before a single request reaches it', async () => {
    hits.length = 0;
    for (const url of [`${base}/article`, `${base}/report.pdf`, base.replace('127.0.0.1', 'localhost') + '/article']) {
      expect(await scrapeUrl({ url })).toEqual({ success: false, error: 'destination_not_allowed', message: SCRAPE_ERROR_MESSAGES.destination_not_allowed, url });
    }
    expect(hits).toEqual([]);
  });

  it('a page: markdown with its table, code and shadow-DOM code; navigation and footer dropped', async () => {
    const result = await scrapeUrl({ allowLocal: true, url: `${base}/article` });
    expect(result).toMatchObject({ success: true, statusCode: 200, title: 'Guide', isPartial: false });
    expect(Object.keys(result.formats)).toEqual(['markdown']);
    const markdown = result.formats.markdown.data;
    expect(markdown).toMatch(/^# Install/m);
    expect(markdown).toMatch(/\| Plan \| Price \|\n\| --- \| --- \|\n\| Pro \| \$15 \|/);
    expect(markdown).toContain('```bash\nnpm install agnt\n```');
    expect(markdown).toContain('```js\nconst shadow = true;\n```');
    expect(markdown).toContain(`[next step](${base}/docs/next)`);
    expect(markdown).not.toMatch(/Copyright junk|Home/);
  }, 60000);

  it('returns exactly the formats asked for, from one visit', async () => {
    const result = await scrapeUrl({ allowLocal: true, url: `${base}/article`, formats: ['links', 'code', 'screenshot', 'bytes'] });
    expect(Object.keys(result.formats).sort()).toEqual(['bytes', 'code', 'links', 'screenshot']);
    expect(result.formats.links.data).toEqual([`${base}/home`, `${base}/docs/next`]);
    expect(result.formats.screenshot.data).toMatch(/^data:image\/jpeg;base64,/);
    expect(Buffer.from(result.formats.bytes.data.split(',')[1], 'base64').toString()).toBe(ARTICLE);
  }, 60000);

  it.each([
    ['/missing', 'page_not_found'],
    ['/forbidden', 'page_blocked'],
    ['/challenge', 'page_blocked'],
    ['/empty', 'extraction_failed'],
  ])('%s is a typed failure, never content', async (path, code) => {
    const result = await scrapeUrl({ allowLocal: true, url: base + path });
    expect(result).toEqual({ success: false, error: code, message: SCRAPE_ERROR_MESSAGES[code], url: base + path });
  }, 60000);

  it('an unreachable site is destination_unavailable', async () => {
    const result = await scrapeUrl({ allowLocal: true, url: 'http://127.0.0.1:1/' });
    expect(result.error).toBe('destination_unavailable');
  }, 60000);

  it('a PDF Chrome would show in its viewer comes back as per-page markdown', async () => {
    const result = await scrapeUrl({ allowLocal: true, url: `${base}/report.pdf` });
    expect(result).toMatchObject({ success: true, document: { type: 'pdf', pages: 1 } });
    expect(result.formats.markdown.data).toContain('## Page 1');
    expect(result.formats.markdown.data).toContain('Attention is all you need');
  }, 60000);

  it('a Word file Chrome would only download is fetched and converted', async () => {
    const result = await scrapeUrl({ allowLocal: true, url: `${base}/report.docx` });
    expect(result).toMatchObject({ success: true, document: { type: 'docx' } });
    expect(result.formats.markdown.data).toMatch(/# Quarterly report\n\nRevenue grew\./);
  }, 60000);

  it('data files: CSV becomes a table, JSON a fenced block', async () => {
    const [csv, json] = await Promise.all([scrapeUrl({ allowLocal: true, url: `${base}/data.csv` }), scrapeUrl({ allowLocal: true, url: `${base}/data.json` })]);
    expect(csv.formats.markdown.data).toContain('| Pro, yearly | 150 |');
    expect(json.formats.markdown.data).toBe('```json\n{\n  "name": "agnt",\n  "tags": [\n    "a",\n    "b"\n  ]\n}\n```');
  }, 60000);

  it('runs in parallel on one shared browser, and closes it on request', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => scrapeUrl({ allowLocal: true, url: `${base}/article`, formats: ['text'] })));
    expect(results.every((r) => r.success && r.formats.text.data.includes('Install'))).toBe(true);
    expect(scrapeBrowserIsOpen()).toBe(true);
    await closeScrapeBrowser();
    expect(scrapeBrowserIsOpen()).toBe(false);
    // ...and relaunches on demand.
    expect((await scrapeUrl({ allowLocal: true, url: `${base}/article` })).success).toBe(true);
  }, 90000);
});
