import { describe, it, expect, vi } from 'vitest';

/**
 * web_scrape is LOCAL: the user's own Chrome, no account, no allowance, no
 * per-page refusal, and any number at once.
 *
 * The regression this pins is narrow and has bitten twice: the local scraper's
 * default export is a tool DESCRIPTOR (`{ description, parameters, execute }`),
 * not a function. Calling `scrapeUtil(url)` type-checks fine, builds fine, and
 * fails at runtime with "scrapeUtil is not a function" for every scrape. Only
 * invoking the tool catches it.
 */
const scrape = vi.fn(async ({ url }) => ({ success: true, textContent: 'text of ' + url, links: ['https://a'], codeContent: '' }));
vi.mock('../../utils/webScrape.js', () => ({ default: { description: 'scrape', parameters: {}, execute: scrape } }));

describe('web_scrape uses the local scraper', () => {
  it('calls it as a descriptor and returns the page', async () => {
    const { TOOLS } = await import('./tools.js');
    const result = JSON.parse(await TOOLS.web_scrape.execute({ url: 'https://example.com' }));
    expect(scrape).toHaveBeenCalledWith({ url: 'https://example.com' });
    expect(result.success).toBe(true);
    expect(result.textContent).toBe('text of https://example.com');
  });

  it('runs any number in parallel with nothing serialising them', async () => {
    const { TOOLS } = await import('./tools.js');
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/${i}`);
    const results = await Promise.all(urls.map((url) => TOOLS.web_scrape.execute({ url })));
    expect(results.every((r) => JSON.parse(r).success)).toBe(true);
    expect(scrape).toHaveBeenCalledTimes(26);
  });
});
