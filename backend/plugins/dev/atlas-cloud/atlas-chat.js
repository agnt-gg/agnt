import { BASE_V1, requireApiKey, atlasFetch, listChatModels } from './_atlas-core.js';

// Atlas answers an id it does not serve with HTTP 400 {"msg":"not found"}.
const isUnknownModel = (error) => (error?.status === 400 || error?.status === 404) && /not\s*found/i.test(error?.upstreamMessage || error?.message || '');

/** Ids sharing the requested id's vendor or a name word come first. */
function rankLike(requested, ids) {
  const words = String(requested).toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length >= 3);
  const score = (id) => words.filter((w) => id.toLowerCase().includes(w)).length;
  return [...ids].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

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

      let data;
      try {
        data = await atlasFetch(`${BASE_V1}/chat/completions`, { apiKey, body });
      } catch (error) {
        if (!isUnknownModel(error)) throw error;
        // Say which ids exist, so the caller can pick one instead of guessing.
        let availableModels = null;
        try { availableModels = rankLike(model, await listChatModels(apiKey)); } catch { /* fall through to the plain error */ }
        if (!availableModels?.length) throw error;
        return {
          error: `Atlas Cloud has no chat model "${model}". Call again with "model" set to one of availableModels (ids are vendor/name, e.g. ${availableModels.slice(0, 3).join(', ')}).`,
          availableModels,
        };
      }

      const choice = data?.choices?.[0];
      const content = choice?.message?.content || '';
      const finishReason = choice?.finish_reason || null;
      // A reasoning model can spend the whole budget thinking and answer
      // nothing; an empty string alone reads as success.
      if (!content && finishReason === 'length') {
        return {
          content: '',
          finishReason,
          error: `"${model}" used all ${body.max_tokens ?? 'its'} output tokens reasoning before it answered. Call again without maxTokens (or with a larger one), or use a model that reasons less.`,
          raw: data,
        };
      }
      return { content, finishReason, raw: data };
    } catch (error) {
      console.error('[atlas-chat] Error:', error);
      return { error: error.message };
    }
  }
}

export default new AtlasChatTool();
