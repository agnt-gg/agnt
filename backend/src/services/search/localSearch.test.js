import { describe, it, expect, afterAll } from 'vitest';
import { getBestChromePath } from '../../utils/chrome-detector.js';
import { SEARCH_CHROME_ARGS, searchLocally, closeSearchBrowser } from './localSearch.js';

describe('the search browser launch', () => {
  it('does not announce automation: without this Google refused 6 of 6 searches', () => {
    expect(SEARCH_CHROME_ARGS).toContain('--disable-blink-features=AutomationControlled');
  });

  it('stays off screen and never asks for the visible headless mode', () => {
    expect(SEARCH_CHROME_ARGS).toContain('--window-position=-32000,-32000');
    expect(SEARCH_CHROME_ARGS.some((arg) => arg.startsWith('--headless'))).toBe(false);
  });

  it('regression: the window is the page\'s size, because a 1x1 window stops drawing on Linux', () => {
    expect(SEARCH_CHROME_ARGS).toContain('--window-size=1366,900');
  });
});

/**
 * One real Google search, in real Chrome, from this computer's connection. Opt-in only
 * (AGNT_LIVE_SEARCH=1): a test suite that searched Google on every run is exactly the traffic
 * that gets a developer's address captcha'd.
 */
describe.skipIf(!process.env.AGNT_LIVE_SEARCH || !getBestChromePath())('live Google search', () => {
  afterAll(() => closeSearchBrowser());

  it('returns resolved results for a real query', async () => {
    const answer = await searchLocally({ query: 'sqlite wal mode', count: 5 });
    expect(answer.status).toBe('ok');
    expect(answer.results.length).toBeGreaterThanOrEqual(3);
    for (const result of answer.results) {
      expect(result.link).toMatch(/^https?:\/\//);
      expect(result.link).not.toMatch(/google\./);
      expect(result.title).toBeTruthy();
      expect(result.source).toBeTruthy();
    }
  }, 60_000);
});
