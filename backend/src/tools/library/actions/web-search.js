import BaseAction from '../BaseAction.js';
import { serviceFailure } from '../../../services/agntServices.js';
import { searchWeb } from '../../../services/search/searchRouter.js';

/**
 * Web search, included with AGNT Pro: Google in an invisible Chrome on this computer when it
 * can, search.agnt.gg when it cannot (services/search/searchRouter.js). Same results either
 * way; the chat tool web_search takes the same path.
 */
class WebSearch extends BaseAction {
  static schema = {
    title: 'Web Search',
    category: 'action',
    type: 'web-search',
    icon: 'web',
    description: 'Searches the web with Google and returns the top results. Included with AGNT Pro.',
    parameters: {
      searchQuery: {
        type: 'string',
        inputType: 'text',
        description: 'The search query to be executed',
      },
      numResults: {
        type: 'text',
        inputType: 'text',
        description: 'The number of results to return (1-10, default: 5)',
        default: 5,
      },
    },
    outputs: {
      results: {
        type: 'array',
        description: 'An array of search result objects: title, link, snippet, source',
      },
      error: {
        type: 'string',
        description: 'Error message if the search failed',
      },
    },
  };

  constructor() {
    super('webSearch');
  }

  async execute(params) {
    this.validateParams(params);
    const query = String(params.searchQuery || '').trim();
    if (!query) return this.formatOutput({ results: [], error: 'searchQuery is required' });
    const count = Math.max(1, Math.min(10, parseInt(params.numResults, 10) || 5));
    try {
      const data = await searchWeb({ query, count });
      return this.formatOutput({ results: data.results, error: null });
    } catch (error) {
      const failure = serviceFailure(error);
      return this.formatOutput({ results: [], error: failure.message || failure.error, ...failure });
    }
  }
}

export default new WebSearch();
