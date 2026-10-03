/**
 * Reads a Google results page. The only file that knows Google's markup.
 *
 * `parseSerpDocument` is deliberately self-contained (no imports, no closures, DOM APIs only):
 * localSearch.js hands it to `page.evaluate`, which serialises the function source and runs it
 * inside Chrome, and the tests run the very same function over saved pages in jsdom. One
 * parser, two runtimes, no drift.
 *
 * What the page looks like (Chrome 154, October 2026):
 *  - organic results are `#rso a > h3`. The link is `/goto?url=<opaque>` (older pages:
 *    `/url?q=`), never the destination: there is no outbound URL anywhere in the page, so
 *    localSearch.js resolves each one through Google's own 302.
 *  - the AI Overview also renders `a > h3` inside `#rso`, under `[data-subtree="aimc"]`; those
 *    are Google's summary, not results.
 *  - a refusal is a redirect to `/sorry/` or an "unusual traffic" interstitial.
 *
 * @param {Document} document  the rendered page
 * @param {string}   pageUrl   where the page ended up (a /sorry/ redirect is a refusal)
 * @returns {{ blocked: boolean, results: Array<{ title: string, href: string, displayUrl: string|null, snippet: string|null }> }}
 */
export function parseSerpDocument(document, pageUrl) {
  const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const bodyText = clean(document.body ? document.body.textContent : '');
  const path = (() => {
    try { return new URL(pageUrl).pathname; } catch { return ''; }
  })();
  const blocked = path.startsWith('/sorry') || Boolean(document.querySelector('#captcha-form'))
    || /unusual traffic from your computer network|I'm not a robot/i.test(bodyText);
  if (blocked) return { blocked: true, results: [] };

  const results = [];
  const seen = new Set();
  const root = document.querySelector('#rso');
  if (!root) return { blocked: false, results };
  for (const heading of root.querySelectorAll('a h3')) {
    const anchor = heading.closest('a');
    const href = anchor ? anchor.getAttribute('href') || '' : '';
    if (!href || seen.has(href) || anchor.closest('[data-subtree="aimc"]')) continue;
    const title = clean(heading.textContent);
    if (!title) continue;
    seen.add(href);
    // The result's own block: the widest ancestor that still holds exactly one titled link.
    let block = anchor;
    while (block.parentElement && block.parentElement !== root && block.parentElement.querySelectorAll('a h3').length === 1) {
      block = block.parentElement;
    }
    const cite = block.querySelector('cite');
    const snippetElement = block.querySelector('.VwiC3b, [data-sncf]');
    let snippet = null;
    if (snippetElement) {
      // The snippet carries a "Read more" link of its own; its text is not the snippet's.
      const copy = snippetElement.cloneNode(true);
      for (const link of copy.querySelectorAll('a')) link.remove();
      snippet = clean(copy.textContent) || null;
    }
    results.push({ title, href, displayUrl: cite ? clean(cite.textContent) : null, snippet });
  }
  return { blocked: false, results };
}

/** Does this result link need resolving through Google, or does it already point outside? */
export function isGoogleRedirect(href) {
  return href.startsWith('/goto?') || href.startsWith('/url?');
}

/**
 * The hosted search response's `source` field: the destination's host name.
 * @returns {string|null} null for anything that is not an absolute http(s) URL outside Google
 */
export function sourceOf(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (/(^|\.)google\.[a-z.]+$/i.test(url.hostname)) return null;
    return url.hostname;
  } catch {
    return null;
  }
}
