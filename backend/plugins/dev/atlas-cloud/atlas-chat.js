import { BASE_V1, requireApiKey, atlasFetch } from './_atlas-core.js';

class AtlasChatTool {
  constructor() { this.name = 'atlas-chat'; }
  async execute(params) {
    try {
      const apiKey = requireApiKey(params);
      const { model, systemPrompt, userMessage, temperature, maxTokens } = params;
      if (!model) throw new Error('Parameter "model" is required');
      if (!userMessage) throw new Error('Parameter "userMessage" is required');
      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: userMessage });
      const body = { model, messages, temperature: Number(temperature ?? 0.7) };
      // Only set max_tokens when explicitly provided — letting the upstream API
      // pick its model-aware default beats truncating long responses at 2048.
      if (maxTokens !== undefined && maxTokens !== null && maxTokens !== '') {
        body.max_tokens = Number(maxTokens);
      }
      const data = await atlasFetch(`${BASE_V1}/chat/completions`, { apiKey, body });
      return { content: data?.choices?.[0]?.message?.content || '', raw: data };
    } catch (error) {
      console.error('[atlas-chat] Error:', error);
      return { error: error.message };
    }
  }
}

export default new AtlasChatTool();
