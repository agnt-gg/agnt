import BaseAction from '../BaseAction.js';
import authManager from '../../../services/auth/AuthManager.js';
import axios from 'axios';

class FirecrawlAPI extends BaseAction {
  static schema = {
    title: 'Firecrawl API',
    category: 'action',
    type: 'firecrawl-api',
    icon: 'fire',
    description: 'Scrape web content using Firecrawl API',
    authRequired: 'apiKey',
    authProvider: 'firecrawl',
    parameters: {
      url: {
        type: 'string',
        inputType: 'text',
        description: 'The URL to scrape',
      },
      format: {
        type: 'string',
        inputType: 'select',
        options: ['Markdown', 'HTML'],
        default: 'Markdown',
        description: 'The desired output format',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the scraping was successful',
      },
      result: {
        type: 'object',
        description: 'The scraped content in the selected format',
      },
      error: {
        type: 'string',
        description: 'Error message if the scraping failed',
      },
    },
  };

  constructor() {
    super('firecrawl-api');
  }
  async execute(params, inputData, workflowEngine) {
    // *Opetional* Call parent execute() to trigger automatic param & input type validation
    await super.execute(params, inputData, workflowEngine);

    params.userId = workflowEngine.userId;

    const apiKey = await authManager.getValidAccessToken(params.userId, 'firecrawl');

    console.log(params);

    try {
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
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }
}

export default new FirecrawlAPI();
