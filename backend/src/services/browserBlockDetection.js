/**
 * Recognise a bot-protection block page, so the browser tool can say "blocked"
 * instead of reporting a successful navigation to a wall.
 *
 * WHY: blocked pages come back as ordinary loads. On homedepot.com the tool
 * returned `success` for every page while each one was a 403 "Oops!! Something
 * went wrong", and the model spent a dozen calls working that out by hand. A
 * named block ends that loop: the model is told what stopped it and to stop
 * retrying.
 *
 * FALSE POSITIVES ARE THE EXPENSIVE ERROR. Calling a real page "blocked"
 * makes the agent abandon a site that works, so every rule needs either a
 * vendor-specific marker, a vendor-specific title, or a SHORT page (a block
 * page is a few lines; an article that mentions "captcha" is not).
 */

/** Longer than any challenge page seen; shorter than any real content page. */
const SHORT_PAGE_CHARS = 1500;

/** [vendor, pattern] tested against the title. Titles of challenge pages are fixed strings. */
const TITLE_RULES = [
  ['Cloudflare', /^just a moment\b|attention required! \| cloudflare/i],
  ['PerimeterX (HUMAN)', /access to this page has been denied/i],
  ['bot check', /^robot or human\??$/i],
  ['Reddit', /prove your humanity/i],
  ['Imperva', /pardon our interruption/i],
];

/** [vendor, pattern] tested against the visible text, ONLY on short pages. */
const SHORT_TEXT_RULES = [
  ['PerimeterX (HUMAN)', /press (?:&|and) hold/i],
  ['Cloudflare', /checking if the site connection is secure|verify you are human by completing/i],
  ['Amazon', /click the button below to continue shopping/i],
  ['Google', /unusual traffic from your computer network/i],
  ['Imperva', /request unsuccessful\. incapsula/i],
  ['Reddit', /whoa there, pardner|blocked by network security/i],
  ['the site', /you(?:'ve| have) been blocked/i],
];

/**
 * In-page probe, evaluated with Runtime.evaluate (no Runtime.enable needed).
 * Returns a JSON string so the result survives returnByValue unchanged.
 */
export const BLOCK_PROBE_EXPRESSION = `(() => {
  const text = (document.body && document.body.innerText) || '';
  return JSON.stringify({
    probe: 'agnt-block-probe',
    title: document.title || '',
    text: text.slice(0, ${SHORT_PAGE_CHARS}),
    textLength: text.length,
    markers: {
      pxCaptcha: !!document.querySelector('#px-captcha, [id^="px-captcha"]'),
      dataDome: !!document.querySelector('iframe[src*="captcha-delivery.com"]'),
      cloudflare: typeof window._cf_chl_opt !== 'undefined' || !!document.querySelector('#challenge-form, #cf-challenge-running'),
      akamaiReference: /Reference\\s*#\\s*[0-9a-f.]+/i.test(text.slice(0, ${SHORT_PAGE_CHARS})),
    },
  });
})()`;

/**
 * @param {{ title?: string, text?: string, textLength?: number,
 *           markers?: object, status?: number|null }} probe
 * @returns {{ by: string, evidence: string } | null}
 */
export function classifyBlockPage(probe) {
  if (!probe || typeof probe !== 'object') return null;
  const title = String(probe.title || '').trim();
  const text = String(probe.text || '');
  const textLength = Number.isFinite(probe.textLength) ? probe.textLength : text.length;
  const markers = probe.markers || {};
  const status = Number(probe.status) || null;
  const short = textLength < SHORT_PAGE_CHARS;

  // Vendor markers: elements that only exist on a challenge page.
  if (markers.pxCaptcha) return { by: 'PerimeterX (HUMAN)', evidence: 'press-and-hold captcha on the page' };
  if (markers.dataDome) return { by: 'DataDome', evidence: 'DataDome captcha on the page' };
  if (markers.cloudflare) return { by: 'Cloudflare', evidence: 'Cloudflare challenge on the page' };

  for (const [by, pattern] of TITLE_RULES) {
    if (pattern.test(title)) return { by, evidence: `page title "${title.slice(0, 80)}"` };
  }
  if (/^access denied$/i.test(title)) {
    return { by: markers.akamaiReference ? 'Akamai' : 'the site', evidence: 'page title "Access Denied"' };
  }

  if (short) {
    for (const [by, pattern] of SHORT_TEXT_RULES) {
      const hit = pattern.exec(text);
      if (hit) return { by, evidence: `page says "${hit[0]}"` };
    }
    // A short page served with 403/429 is a refusal whatever its wording
    // (homedepot.com's is "Oops!! Something went wrong").
    if (status === 403 || status === 429) {
      return { by: 'the site', evidence: `HTTP ${status} with a ${textLength}-character page` };
    }
  }
  return null;
}

/** What the agent is told when a block survives the retry. */
export function blockedHint(block) {
  return `The site's bot protection (${block.by}) blocked this page: ${block.evidence}. `
    + 'Retrying the same page will not help. Tell the user it is blocked, or get the information from another source.';
}
