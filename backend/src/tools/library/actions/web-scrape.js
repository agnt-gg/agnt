import BaseAction from '../BaseAction.js';
import { callService, serviceFailure } from '../../../services/agntServices.js';

/**
 * Page scraping, served by search.agnt.gg and included with AGNT Pro.
 *
 * The page is rendered in a real Chrome on the service and the main text,
 * links and code blocks are extracted there — the desktop no longer needs a
 * local browser, and a free account is refused before anything is fetched.
 */
export async function scrape(url) {
  const data = await callService('search', '/scrape', { method: 'POST', idempotent: true, timeoutMs: 90000, body: { url } });
  return {
    textContent: data.textContent || '',
    links: Array.isArray(data.links) ? data.links : [],
    codeContent: data.codeContent || '',
  };
}

class WebScrape extends BaseAction {
  static schema = {
    title: 'Web Scrape',
    category: 'action',
    type: 'web-scrape',
    icon: 'web',
    description:
      'Scrapes a URL to extract main text content, all links, AND all code snippets on the page. Use the returned `links` array for recursive research and `codeContent` to build documentation. Included with AGNT Pro.',
    parameters: {
      url: {
        type: 'string',
        inputType: 'text',
        description: 'The URL to scrape.',
      },
    },
    outputs: {
      textContent: {
        type: 'string',
        description: 'The main text content extracted from the page',
      },
      links: {
        type: 'array',
        description: 'Array of all links found on the page',
      },
      codeContent: {
        type: 'string',
        description: 'All code snippets found on the page',
      },
      error: {
        type: 'string',
        description: 'Error message if the scraping failed',
      },
    },
  };

  constructor() {
    super('web-scrape');
  }

  async execute(params) {
    this.validateParams(params);
    try {
      const result = await scrape(params.url);
      return this.formatOutput({ success: true, ...result, error: null });
    } catch (error) {
      const failure = serviceFailure(error);
      return this.formatOutput({ success: false, textContent: '', links: [], codeContent: '', error: failure.message || failure.error, ...failure });
    }
  }
}

export default WebScrape;
