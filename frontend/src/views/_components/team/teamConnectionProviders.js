/** The providers a team connection can be made for, as [id, label]. */
export const TEAM_CONNECTION_PROVIDERS = Object.freeze([
  ['agnt', 'AGNT Flash (included)'],
  ['github', 'GitHub'],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['groq', 'Groq'],
  ['deepseek', 'DeepSeek'],
  ['grokai', 'Grok'],
  ['openrouter', 'OpenRouter'],
]);

export const teamProviderLabel = (id) => TEAM_CONNECTION_PROVIDERS.find(([value]) => value === id)?.[1] || id;
