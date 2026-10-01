import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { getBestChromePath } from '../../utils/chrome-detector.js';

/**
 * The destination guard WIRING, in real Chrome: a URL that starts somewhere allowed must not
 * be able to reach somewhere refused through a redirect, a subresource, a script, or the
 * file-download path (which follows its own redirects outside Chrome).
 *
 * The test server is on this machine, so the address CLASSIFICATION is replaced: 127.0.0.1
 * plays "a public site" and `localhost` plays "inside". Classification itself is covered by
 * destinationGuard.test.js. Every refusal is paired with an allowLocal control showing the
 * same request DOES arrive when permitted, so "zero hits" proves blocking, not a dead route.
 */
vi.mock('./destinationGuard.js', () => ({
  createDestinationGuard: () => ({
    verdict: async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'allow';
      return parsed.hostname === 'localhost' ? 'deny' : 'allow';
    },
  }),
}));

const { scrapeUrl, closeScrapeBrowser, SCRAPE_ERROR_MESSAGES } = await import('./localScrape.js');

const docx = (heading) => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${heading}</w:t></w:r></w:p></w:body></w:document>`),
}));
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const chrome = getBestChromePath();

describe.skipIf(!chrome)('the destination guard in real Chrome', () => {
  let server;
  let port;
  let allowed; // "public": http://127.0.0.1:<port>
  let inside; // "inside": http://localhost:<port>
  const secretHits = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const path = new URL(request.url, 'http://x').pathname;
      if (path.startsWith('/secret')) {
        secretHits.push(path);
        if (path === '/secret.docx') {
          response.writeHead(200, { 'Content-Type': DOCX, 'Content-Disposition': 'attachment; filename="secret.docx"' });
          response.end(docx('Secret plans'));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html><body><main><h1>Router admin</h1><p>Secret page</p></main></body></html>');
        return;
      }
      if (path === '/to-inside') {
        response.writeHead(302, { Location: `${inside}/secret-page` });
        response.end();
        return;
      }
      if (path === '/fetches-inside') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(`<html><body><main><h1>Public page</h1><p>Visible text.</p>
          <img src="${inside}/secret-img.png" alt="">
          <script>fetch('${inside}/secret-fetch').catch(() => {});</script></main></body></html>`);
        return;
      }
      if (path === '/attach.docx') {
        // Chrome navigates (Accept: text/html...) and hands the attachment to its download
        // manager; the scraper then fetches the file itself (Accept: */*). Only that second
        // fetch is redirected inside, so this exercises the download path's own redirects.
        if (request.headers.accept === '*/*') {
          response.writeHead(302, { Location: `${inside}/secret.docx` });
          response.end();
          return;
        }
        response.writeHead(200, { 'Content-Type': DOCX, 'Content-Disposition': 'attachment; filename="attach.docx"' });
        response.end(docx('Attachment'));
        return;
      }
      if (path === '/report.docx') {
        response.writeHead(200, { 'Content-Type': DOCX, 'Content-Disposition': 'attachment; filename="report.docx"' });
        response.end(docx('Quarterly report'));
        return;
      }
      response.writeHead(404).end();
    });
    // Dual-stack, so `localhost` reaches it whether Chrome resolves it to ::1 or 127.0.0.1:
    // a refused request must be refused by the guard, never by a missing listener.
    await new Promise((resolve) => server.listen({ port: 0, host: '::', ipv6Only: false }, resolve));
    port = server.address().port;
    allowed = `http://127.0.0.1:${port}`;
    inside = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await closeScrapeBrowser();
    await new Promise((resolve) => server.close(resolve));
  });

  it('a redirect from an allowed site to an inside one is refused before it is sent', async () => {
    secretHits.length = 0;
    const result = await scrapeUrl({ url: `${allowed}/to-inside` });
    expect(result).toEqual({ success: false, error: 'destination_not_allowed', message: SCRAPE_ERROR_MESSAGES.destination_not_allowed, url: `${allowed}/to-inside` });
    expect(secretHits).toEqual([]);

    const control = await scrapeUrl({ url: `${allowed}/to-inside`, allowLocal: true });
    expect(control.formats.markdown.data).toContain('Router admin');
    expect(secretHits).toEqual(['/secret-page']);
  }, 60000);

  it('an allowed page cannot pull anything from inside: images and scripts are dropped, the page still scrapes', async () => {
    secretHits.length = 0;
    const result = await scrapeUrl({ url: `${allowed}/fetches-inside` });
    expect(result.success).toBe(true);
    expect(result.formats.markdown.data).toContain('Visible text.');
    expect(secretHits).toEqual([]);

    await scrapeUrl({ url: `${allowed}/fetches-inside`, allowLocal: true });
    expect(secretHits.sort()).toEqual(['/secret-fetch', '/secret-img.png']);
  }, 60000);

  it('the file download follows redirects through the guard too', async () => {
    secretHits.length = 0;
    const result = await scrapeUrl({ url: `${allowed}/attach.docx` });
    expect(result.error).toBe('destination_not_allowed');
    expect(secretHits).toEqual([]);

    const control = await scrapeUrl({ url: `${allowed}/attach.docx`, allowLocal: true });
    expect(control.formats.markdown.data).toContain('Secret plans');
    expect(secretHits).toEqual(['/secret.docx']);
  }, 60000);

  it('checking every request does not get in the way of an ordinary file', async () => {
    const result = await scrapeUrl({ url: `${allowed}/report.docx` });
    expect(result).toMatchObject({ success: true, document: { type: 'docx' } });
    expect(result.formats.markdown.data).toContain('# Quarterly report');
  }, 60000);
});
