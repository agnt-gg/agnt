import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


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
      // Import AuthManager dynamically to avoid path issues
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const apiKey = await AuthManager.getValidAccessToken(workflowEngine.userId, 'firecrawl');

      if (!apiKey) {
        throw new Error('No valid API key found. Please configure your Firecrawl API key.');
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
