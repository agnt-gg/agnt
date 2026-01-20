import BaseAction from '../BaseAction.js';
import axios from 'axios';

// Cache for Google Search keys to avoid repeated API calls
let cachedGoogleSearchKeys = null;

class WebSearch extends BaseAction {
  static schema = {
    title: 'Google Web Search API',
    category: 'action',
    type: 'web-search',
    icon: 'web',
    description: 'This action node performs a web search using Google Custom Search API and returns the top results.',
    parameters: {
      searchQuery: {
        type: 'string',
        inputType: 'text',
        description: 'The search query to be executed',
      },
      numResults: {
        type: 'text',
        inputType: 'text',
        description: 'The number of results to return (default: 5)',
        default: 3,
      },
      sort: {
        type: 'string',
        inputType: 'select',
        options: ['date', 'relevance'],
        description: 'Sort order for the results',
        default: 'date',
      },
    },
    outputs: {
      results: {
        type: 'array',
        description: 'An array of search result objects',
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

  async getGoogleSearchKeys() {
    // Return cached keys if available
    if (cachedGoogleSearchKeys) {
      return cachedGoogleSearchKeys;
    }

    try {
      // Fetch keys from remote API
      const response = await axios.get(`${process.env.REMOTE_URL}/auth/google-search-keys`);

      cachedGoogleSearchKeys = {
        apiKey: response.data.apiKey,
        searchEngineId: response.data.searchEngineId,
      };

      return cachedGoogleSearchKeys;
    } catch (error) {
      console.error('Error fetching Google Search keys from remote:', error.message);

      // Fallback to local environment variables if remote fetch fails
      console.log('Falling back to local environment variables');
      return {
        apiKey: process.env.GOOGLE_SEARCH_API_KEY,
        searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
      };
    }
  }

  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    try {
      // Get Google Search keys from remote API
      const { apiKey, searchEngineId } = await this.getGoogleSearchKeys();

      if (!apiKey || !searchEngineId) {
        throw new Error('Google Search API credentials not configured');
      }

      const { searchQuery, numResults = 5, sort = 'relevance' } = params;

      let url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&num=${numResults}&q=${encodeURIComponent(
        searchQuery
      )}`;

      if (sort !== 'relevance') {
        url += `&sort=${sort}`;
      }

      const response = await axios.get(url);

      if (response.data.items && Array.isArray(response.data.items)) {
        const results = response.data.items.map((item) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
        }));

        return this.formatOutput({
          success: true,
          results,
          error: null,
        });
      } else {
        return this.formatOutput({
          success: true,
          results: [],
          error: null,
        });
      }
    } catch (error) {
      console.error('Error in WebSearch:', error);
      return this.formatOutput({
        success: false,
        results: [],
        error: error.message,
      });
    }
  }
  validateParams(params) {
    if (!params.searchQuery) {
      throw new Error('Search query is required for web search');
    }
  }
}

export default new WebSearch();
