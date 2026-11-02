import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * web_scrape is LOCAL: the user's own Chrome, no account, no allowance, no
 * per-page refusal, and any number at once. It returns scrape.agnt.gg's body.
 *
 * Two regressions pinned here:
 *  - The local scraper's default export is a tool DESCRIPTOR
 *    (`{ description, parameters, execute }`), not a function. Calling
 *    `scrapeUtil(url)` type-checks, builds, and fails at runtime for every
 *    scrape. Only invoking the tool catches it.
 *  - A failed scrape was reported as success: the wrapper dropped the check
 *    that turned the scraper's "ERROR: ..." text into success:false (9ccd4393),
 *    so a PDF that yielded nothing read as "extracted successfully". Failures
 *    are typed now, and the wrapper must pass them through as failures.
 */
const page = (url) => ({
  success: true, url, finalUrl: url, statusCode: 200, title: 'T',
  formats: { markdown: { requested: true, success: true, data: '# text of ' + url } }, isPartial: false,
});
const scrape = vi.fn(async ({ url }) => page(url));
vi.mock('../../utils/webScrape.js', () => ({ default: { description: 'scrape', parameters: {}, execute: scrape } }));

describe('web_scrape uses the local scraper', () => {
  // A block body: vitest runs a function RETURNED from beforeEach as teardown, and
  // mockClear() returns the mock, which would then be "called" with no arguments.
  beforeEach(() => {
    scrape.mockClear();
  });

  it('calls it as a descriptor and returns the hosted body unchanged', async () => {
    const { TOOLS } = await import('./tools.js');
    const result = JSON.parse(await TOOLS.web_scrape.execute({ url: 'https://example.com' }));
    expect(scrape).toHaveBeenCalledWith({ url: 'https://example.com', formats: undefined, mainContentOnly: undefined, waitForMs: undefined, pageRange: undefined });
    expect(result).toEqual(page('https://example.com'));
    // The first import of tools.js boots the whole tool registry and the
    // database; under a loaded parallel run that alone passed the 5s default
    // ("Test timed out in 5000ms" in the orchestrator suite on a 20-core box).
  }, 30000);

  it('passes the caller\'s formats and options through, and nothing else', async () => {
    const { TOOLS } = await import('./tools.js');
    await TOOLS.web_scrape.execute({ url: 'https://x.test/a.pdf', formats: ['markdown', 'links'], mainContentOnly: false, waitForMs: 500, pageRange: '2-3', allowLocal: true, extra: 'ignored' });
    expect(scrape.mock.calls[0][0]).toStrictEqual({ url: 'https://x.test/a.pdf', formats: ['markdown', 'links'], mainContentOnly: false, waitForMs: 500, pageRange: '2-3', allowLocal: true });
  });

  it('reports a failed scrape as a failure, with its code and sentence', async () => {
    const { TOOLS } = await import('./tools.js');
    scrape.mockResolvedValueOnce({ success: false, error: 'pdf_images_only', message: 'The PDF has no text layer.', url: 'https://x.test/scan.pdf' });
    const result = JSON.parse(await TOOLS.web_scrape.execute({ url: 'https://x.test/scan.pdf' }));
    expect(result).toEqual({ success: false, error: 'pdf_images_only', message: 'The PDF has no text layer.', url: 'https://x.test/scan.pdf' });
  });

  // The regression: handed a YouTube link, the agent scraped the watch page, hit the bot wall,
  // and called the video unwatchable while youtube_api GET_TRANSCRIPTION sat unloaded.
  it('points a YouTube video at the transcript tool, first, whether the scrape worked or not', async () => {
    const { TOOLS } = await import('./tools.js');
    const url = 'https://www.youtube.com/watch?v=3199TC7Pt_o&list=PL5Y2vlXT60eRaQ3CtoC-zm_lRb7GtUfFw';
    const worked = await TOOLS.web_scrape.execute({ url });
    expect(Object.keys(JSON.parse(worked))[0]).toBe('transcriptHint');
    expect(JSON.parse(worked)).toMatchObject({ ...page(url), transcriptHint: expect.stringContaining('GET_TRANSCRIPTION') });
    scrape.mockResolvedValueOnce({ success: false, error: 'page_blocked', message: 'blocked', url });
    const blocked = JSON.parse(await TOOLS.web_scrape.execute({ url }));
    expect(blocked).toMatchObject({ success: false, error: 'page_blocked', transcriptHint: expect.stringContaining('videoId "3199TC7Pt_o"') });
  });

  it('adds nothing for a YouTube page that is not a single video', async () => {
    const { TOOLS } = await import('./tools.js');
    const url = 'https://www.youtube.com/@DaveShap';
    expect(JSON.parse(await TOOLS.web_scrape.execute({ url }))).toEqual(page(url));
  });

  it('asks the model for the URL only; every option is optional and formats are the hosted set', async () => {
    const { TOOLS } = await import('./tools.js');
    const { parameters } = TOOLS.web_scrape.schema.function;
    expect(parameters.required).toEqual(['url']);
    expect(Object.keys(parameters.properties).sort()).toEqual(['allowLocal', 'formats', 'mainContentOnly', 'pageRange', 'url', 'waitForMs']);
    expect(parameters.properties.allowLocal.type).toBe('boolean');
    expect(parameters.properties.formats.items.enum).toEqual(['markdown', 'html', 'text', 'links', 'code', 'screenshot', 'bytes']);
  });

  it('runs any number in parallel with nothing serialising them', async () => {
    const { TOOLS } = await import('./tools.js');
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/${i}`);
    const results = await Promise.all(urls.map((url) => TOOLS.web_scrape.execute({ url })));
    expect(results.every((r) => JSON.parse(r).success)).toBe(true);
    expect(scrape).toHaveBeenCalledTimes(25);
  });
});
