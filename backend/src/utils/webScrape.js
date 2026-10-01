import { scrapeUrl, SCRAPE_FORMATS } from '../services/scrape/localScrape.js';

/**
 * The local web scrape, as a tool descriptor ({ description, parameters, execute }).
 *
 * Both the chat tool (orchestrator/tools.js web_scrape) and the workflow node
 * (tools/library/actions/web-scrape.js) call this. It runs scrape.agnt.gg's pipeline in the
 * user's own Chrome and returns the hosted API's body; see services/scrape/localScrape.js.
 *
 * The caller chooses the formats and gets only those back: markdown alone by default.
 */
export default {
  description:
    "Reads a web page or a file at a URL in the user's own Chrome and converts it exactly as scrape.agnt.gg does.",
  parameters: {
    url: { type: 'string', description: 'The URL to scrape.' },
    formats: { type: 'array', items: { type: 'string', enum: SCRAPE_FORMATS }, description: 'Outputs to return; markdown when omitted.' },
    mainContentOnly: { type: 'boolean', description: 'Drop navigation, headers, footers and sidebars (default true).' },
    waitForMs: { type: 'integer', description: 'Extra wait after load, 0-10000 ms (default 0).' },
    pageRange: { type: 'string', description: 'PDF pages to convert, e.g. "5" or "2-9".' },
    allowLocal: { type: 'boolean', description: 'Allow this computer and private networks (default false).' },
  },
  /** @returns {Promise<object>} the hosted body; never throws. */
  execute: (request) => scrapeUrl(request),
};
