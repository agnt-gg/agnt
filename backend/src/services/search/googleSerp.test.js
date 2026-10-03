import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { parseSerpDocument, isGoogleRedirect, sourceOf } from './googleSerp.js';

/**
 * fixtures/google-serp.html is a real results page ("serper api pricing", Chrome 154, October
 * 2026) with scripts, styles, images and tracking attributes stripped and the AI Overview cut
 * down to one link. When Google changes its markup, capture a fresh page the same way and these
 * are the expectations to re-check.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const page = (html) => new JSDOM(html).window.document;
const SEARCH_URL = 'https://www.google.com/search?q=serper+api+pricing&hl=en&gl=us';

describe('parseSerpDocument on a real results page', () => {
  const parsed = parseSerpDocument(page(fs.readFileSync(path.join(HERE, 'fixtures', 'google-serp.html'), 'utf8')), SEARCH_URL);

  it('finds every organic result, in page order', () => {
    expect(parsed.blocked).toBe(false);
    expect(parsed.results).toHaveLength(9);
    expect(parsed.results[0].title).toBe('What Type of Search API Do You Need? (2026 ...');
    expect(parsed.results[1].title).toBe('Serper API - Callio: The API Gateway for AI Agents');
  });

  it("skips the AI Overview's own links", () => {
    expect(parsed.results.some((r) => r.href.includes('AI-OVERVIEW-SOURCE'))).toBe(false);
  });

  it("reads each result's Google link, display URL and snippet", () => {
    for (const result of parsed.results) {
      expect(isGoogleRedirect(result.href)).toBe(true);
      expect(result.displayUrl).toMatch(/^https:\/\//);
      expect(result.snippet).toBeTruthy();
    }
    expect(parsed.results[0].displayUrl).toBe('https://keirolabs.cloud › blogs › comparisons › top-8-ai...');
  });

  it('keeps the snippet text and drops the "read more" link inside it', () => {
    expect(parsed.results[0].snippet).toMatch(/^Jul 11, 2026 — Price from \$1\/1k/);
    expect(new Set(parsed.results.map((r) => r.href)).size).toBe(9);
  });
});

describe('parseSerpDocument refusals and empties', () => {
  it('reads a /sorry/ redirect as a refusal', () => {
    expect(parseSerpDocument(page('<div id="rso"><a href="/goto?url=x"><h3>t</h3></a></div>'), 'https://www.google.com/sorry/index?continue=x'))
      .toEqual({ blocked: true, results: [] });
  });

  it('reads the "unusual traffic" interstitial as a refusal', () => {
    const html = '<body>Our systems have detected unusual traffic from your computer network.</body>';
    expect(parseSerpDocument(page(html), SEARCH_URL).blocked).toBe(true);
  });

  it('reads the captcha form as a refusal', () => {
    expect(parseSerpDocument(page('<form id="captcha-form"></form>'), SEARCH_URL).blocked).toBe(true);
  });

  it('returns no results, and no refusal, for a page without a results list', () => {
    expect(parseSerpDocument(page('<body>Your search did not match any documents.</body>'), SEARCH_URL)).toEqual({ blocked: false, results: [] });
  });

  it('runs from its own source text, the way localSearch.js runs it inside Chrome', () => {
    const fromSource = new Function(`return (${parseSerpDocument})`)();
    const document = page('<div id="rso"><div><a href="/goto?url=a"><h3>A title</h3></a><div class="VwiC3b">A snippet</div></div></div>');
    expect(fromSource(document, SEARCH_URL).results).toEqual([{ title: 'A title', href: '/goto?url=a', displayUrl: null, snippet: 'A snippet' }]);
  });
});

describe('links', () => {
  it('knows which links go through Google', () => {
    expect(isGoogleRedirect('/goto?url=abc')).toBe(true);
    expect(isGoogleRedirect('/url?q=https://x.test')).toBe(true);
    expect(isGoogleRedirect('https://x.test/')).toBe(false);
  });

  it('names the destination host, and refuses Google itself or non-web links', () => {
    expect(sourceOf('https://www.reddit.com/r/x')).toBe('www.reddit.com');
    expect(sourceOf('https://www.google.com/search?q=x')).toBeNull();
    expect(sourceOf('https://maps.google.co.uk/')).toBeNull();
    expect(sourceOf('javascript:alert(1)')).toBeNull();
    expect(sourceOf('/goto?url=abc')).toBeNull();
  });
});
