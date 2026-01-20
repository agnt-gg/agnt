import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import { GoogleGenAI } from '@google/genai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import AuthManager from '../auth/AuthManager.js';
import CustomOpenAIProviderService from './CustomOpenAIProviderService.js';

const baseURLs = {
  cerebras: 'https://api.cerebras.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/',
  grokai: 'https://api.x.ai/v1/',
  groq: 'https://api.groq.com/openai/v1',
  local: 'http://127.0.0.1:1234/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  togetherai: 'https://api.together.xyz/v1',
};

/**
 * Creates and initializes an LLM client for a given provider.
 * @param {string} provider The name of the AI provider (e.g., 'openai', 'anthropic').
 * @param {string} userId The ID of the user to fetch the API key for.
 * @returns {Promise<OpenAI|Anthropic>} An initialized SDK client instance.
 * @throws {Error} If the provider is unsupported or the access token is missing.
 */
export async function createLlmClient(provider, userId) {
  const lowerCaseProvider = provider.toLowerCase();

  // Check if this is a custom provider by querying the database
  const isCustom = await CustomOpenAIProviderService.isCustomProvider(provider);
  if (isCustom) {
    const customProvider = await CustomOpenAIProviderService.getProviderCredentials(provider, userId);

    if (!customProvider) {
      throw new Error(`Custom provider not found: ${provider}`);
    }

    // Use the base_url as-is (it's already normalized when saved)
    return new OpenAI({
      apiKey: customProvider.api_key || 'not-needed', // Use dummy key if no API key
      baseURL: customProvider.base_url,
    });
  }

  // For 'local' provider, no API key is needed.
  if (lowerCaseProvider === 'local') {
    return new OpenAI({
      apiKey: 'dummy-key', // The key can be anything for local models
      baseURL: baseURLs.local,
      dangerouslyAllowBrowser: false,
      maxRetries: 0, // Disable retries for local server
      timeout: 60000, // 60 second timeout for local models
    });
  }

  const accessToken = await AuthManager.getValidAccessToken(userId, lowerCaseProvider);
  if (!accessToken) {
    throw new Error(`Missing access token for provider: ${provider}`);
  }

  switch (lowerCaseProvider) {
    case 'anthropic':
      return new Anthropic({ apiKey: accessToken });

    case 'openai':
      return new OpenAI({ apiKey: accessToken });

    case 'deepseek':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.deepseek,
      });

    case 'gemini':
      return new GoogleGenAI({
        apiKey: accessToken,
      });

    case 'grokai':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.grokai,
      });

    case 'groq':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.groq,
      });

    case 'openrouter':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.openrouter,
        defaultHeaders: {
          'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3333',
          'X-Title': process.env.SITE_NAME || 'TaskTitan',
        },
      });

    case 'togetherai':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.togetherai,
      });

    case 'cerebras':
      return new Cerebras({
        apiKey: accessToken,
        warmTCPConnection: false, // Disable TCP warming to avoid extra requests on construction
      });

    default:
      throw new Error(`Unsupported provider for LLM client factory: ${provider}`);
  }
}
