import axios from 'axios';


/**
 * Firecrawl API Plugin Tool
 *
 * This is a plugin-based tool that scrapes web content using the Firecrawl API.
 * The plugin system automatically runs `npm install` on server startup.
 */
class FirecrawlAPI {
  constructor() {
    this.name = 'firecrawl-api';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[FirecrawlPlugin] Executing Firecrawl API with params:', JSON.stringify(params, null, 2));

    try {
      const apiKey = params.__auth?.token;
      if (!apiKey) {
        throw new Error('Not connected to Firecrawl. Connect in Settings → Connections.');
      }

      const response = await axios.post(
        'https://api.firecrawl.dev/v1/scrape',
        {
          url: params.url,
          formats: [params.format.toLowerCase()],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      return {
        success: true,
        result: response.data.data,
        error: null,
      };
    } catch (error) {
      console.error('[FirecrawlPlugin] Error executing Firecrawl API:', error);
      return {
        success: false,
        result: null,
        error: error.response?.data?.message || error.message,
      };
    }
  }
}

export default new FirecrawlAPI();
