// *** USER CONFIGURATIONS ***
// ***************************

// TODO: MOVE TO SETTINGS REGISTRY OR SOMETHING???
// SHOULD BE STORED IN THE DATABASE AND CHANGED BY THE USER ON SETTINGS PAGE

// EMAIL DOMAIN TO USE FOR SENDING / RECEIVING
export const IMAP_EMAIL_DOMAIN = {
  BASE_DOMAIN: 'agnt.gg', // CHANGE THIS TO YOUR EMAIL DOMAIN!
};

// *** DEPLOYMENT CONFIG ***
// Set DISABLE_LOCAL_LLM=true in hosted environments to prevent CORS errors
// from polling localhost:1234 for LM Studio
export const DEPLOYMENT_CONFIG = {
  DISABLE_LOCAL_LLM: typeof window !== 'undefined' && localStorage.getItem('AGNT_DISABLE_LOCAL_LLM') === 'true',
};

// ADD LLM PROVIDERS / MODELS TO FRONT END
// NOTE: Models are now fetched dynamically from the backend API endpoints
// This config only defines the available providers
const baseProviders = ['Anthropic', 'Cerebras', 'DeepSeek', 'Gemini', 'GrokAI', 'Groq', 'OpenAI', 'OpenAI-Codex', 'OpenRouter', 'TogetherAI'];
const providers = DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM ? baseProviders : [...baseProviders, 'Local'];

export const AI_PROVIDERS_CONFIG = {
  providers,
  // Models are fetched dynamically from API - no hardcoded models!
  modelsByProvider: {
    Anthropic: [], // Fetched from /api/models/anthropic/models
    Cerebras: [], // Fetched from /api/models/cerebras/models
    DeepSeek: [], // Fetched from /api/models/deepseek/models
    Gemini: [], // Fetched from /api/models/gemini/models
    GrokAI: [], // Fetched from /api/models/grokai/models
    Groq: [], // Fetched from /api/models/groq/models
    Local: [], // Fetched from LM Studio at http://127.0.0.1:1234/v1/models
    OpenAI: [], // Fetched from /api/models/openai/models
    'OpenAI-Codex': [], // Fetched from /api/models/openai-codex/models
    OpenRouter: [], // Fetched from /api/models/openrouter/models
    TogetherAI: [], // Fetched from /api/models/togetherai/models
  },
};

// *** DEFAULT SERVER CONFIGURATION ***
// ************************************

// Fully Local Configuration
// export const API_CONFIG = {
//   BASE_URL: "http://localhost:3333/api", // local backend url
//   FRONTEND_URL: "http://localhost:5173", // local frontend url
//   WEBHOOK_URL: "http://localhost:3001", // local webhook url
//   REMOTE_URL: "http://localhost:3333/api", // local url for sharing, login, app auths, and webhooks if not using remote
//   // REMOTE_URL: "https://api.agnt.gg", // remote url for sharing, login, app auths, and webhooks
// };

// Semi Local Configuration
// Dynamically detect backend URL based on how the frontend is served
const isDevServer = typeof window !== 'undefined' && window.location.port === '5173';
const backendBaseUrl = isDevServer
  ? 'http://localhost:3333/api'
  : `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3333'}/api`;

export const API_CONFIG = {
  BASE_URL: backendBaseUrl, // dynamically set based on frontend port
  FRONTEND_URL: 'http://localhost:5173', // local frontend url (dev server)
  WEBHOOK_URL: 'https://api.agnt.gg', // remote webhook url
  REMOTE_URL: 'https://api.agnt.gg', // remote url for sharing, login, app auths, and webhooks
};

// Remote Configuration
// export const API_CONFIG = {
//   BASE_URL: "https://api.agnt.gg", // local backend url
//   FRONTEND_URL: "https://alpha.agnt.gg", // local frontend url
//   WEBHOOK_URL: "https://api.agnt.gg", // local webhook url
//   // REMOTE_URL: "http://localhost:3333/api", // remote url for sharing, login, app auths, and webhooks
//   REMOTE_URL: "https://api.agnt.gg", // remote url for sharing, login, app auths, and webhooks
// };
