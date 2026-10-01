import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Web Scrape workflow node is a thin adapter over the local scraper. What it owns:
 *  - its DEFAULT formats are what it has always returned (text, links, code), because the
 *    editor writes that default into every node of every workflow it opens, and saved
 *    workflows reference {{Node.textContent}}, .links and .codeContent;
 *  - each requested format lands in exactly ONE flat output, so nothing comes back twice;
 *  - a failure is success:false with a sentence and a code (NodeExecutor fails the node).
 */
const scrape = vi.fn();
vi.mock('../../../utils/webScrape.js', () => ({ default: { execute: scrape } }));
const { default: node } = await import('./web-scrape.js');

const body = (formats) => ({
  success: true, url: 'https://x.test/', finalUrl: 'https://x.test/final', statusCode: 200, title: 'Title', isPartial: false,
  formats: Object.fromEntries(Object.entries(formats).map(([name, data]) => [name, { requested: true, success: true, data }])),
});

describe('Web Scrape node', () => {
  // A block body: vitest runs a function RETURNED from beforeEach as teardown.
  beforeEach(() => {
    scrape.mockReset();
  });

  it.each([[undefined], [null], ['']])('keeps its historical outputs when formats is %s', async (formats) => {
    scrape.mockResolvedValue(body({ text: 'plain', links: ['https://a.test/'], code: '```js\nx\n```' }));
    const out = await node.execute({ url: 'https://x.test/', formats });
    expect(scrape.mock.calls[0][0].formats).toBe('text,links,code');
    expect(out).toMatchObject({ success: true, textContent: 'plain', links: ['https://a.test/'], codeContent: '```js\nx\n```', title: 'Title', finalUrl: 'https://x.test/final', statusCode: 200, error: null });
  });

  it('returns only the formats asked for, each once', async () => {
    scrape.mockResolvedValue(body({ markdown: '# Title' }));
    const out = await node.execute({ url: 'https://x.test/', formats: 'markdown' });
    expect(scrape.mock.calls[0][0].formats).toBe('markdown');
    expect(out.markdown).toBe('# Title');
    for (const absent of ['textContent', 'links', 'codeContent', 'html', 'screenshot', 'bytes']) expect(out).not.toHaveProperty(absent);
  });

  it('maps every hosted format to its output and carries document metadata for files', async () => {
    scrape.mockResolvedValue({ ...body({ markdown: 'm', text: 't', links: [], code: 'c', html: '<p>', screenshot: 'data:image/jpeg;base64,x', bytes: 'data:application/pdf;base64,y' }), document: { type: 'pdf', pages: 3 } });
    const out = await node.execute({ url: 'https://x.test/a.pdf', formats: 'markdown,text,links,code,html,screenshot,bytes' });
    expect(out).toMatchObject({ markdown: 'm', textContent: 't', links: [], codeContent: 'c', html: '<p>', screenshot: 'data:image/jpeg;base64,x', bytes: 'data:application/pdf;base64,y', document: { type: 'pdf', pages: 3 } });
  });

  it('passes the options through; an untouched pageRange field is no page range', async () => {
    scrape.mockResolvedValue(body({ markdown: 'm' }));
    await node.execute({ url: 'https://x.test/', formats: 'markdown', mainContentOnly: false, waitForMs: 250, pageRange: '' });
    expect(scrape).toHaveBeenCalledWith({ url: 'https://x.test/', formats: 'markdown', mainContentOnly: false, waitForMs: 250, pageRange: undefined });
  });

  it('reports a failure as success:false with a sentence and a code', async () => {
    scrape.mockResolvedValue({ success: false, error: 'page_blocked', message: 'The site refused automated access.' });
    expect(await node.execute({ url: 'https://x.test/' })).toEqual({ success: false, error: 'The site refused automated access.', errorCode: 'page_blocked' });
  });

  it('asks for nothing but the URL: every option has a default and says it is optional', () => {
    const { parameters } = node.constructor.schema;
    const mandatory = Object.entries(parameters).filter(([, def]) => def.required !== false && (def.default === undefined || !def.default)).map(([name]) => name);
    expect(mandatory).toEqual(['url']);
    expect(parameters.formats.default).toBe('text,links,code');
  });
});
