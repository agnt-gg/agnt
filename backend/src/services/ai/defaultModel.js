/**
 * defaultModel.js — the model a provider gets when the caller names none.
 *
 * ONE resolver. There used to be three: StreamEngine and generate-with-ai-llm
 * took `recommendedModels[0]` straight from the static registry, and only the
 * browser tool checked it against what the vendor actually lists. The static
 * arrays are a hand-maintained guess about an open world, and they go stale
 * silently. Measured live 2026-09-30, the registry default no longer existed
 * at the vendor for DeepSeek (deepseek-chat), Groq (llama-3.3-70b-versatile),
 * xAI (grok-4-0709), OpenAI (gpt-5.6), Cerebras, Together, OpenRouter and
 * Chutes — so any unmodelled generate on those providers was a hard API error.
 *
 * Rule: a preferred pick the live catalogue confirms, else the first live chat
 * model, else (catalogue never fetched) the first preferred pick unverified.
 */

import { getProviderConfig, buildBaseURLs } from './providerConfigs.js';
import { getLastSuccessfulModels } from './lastModelsCache.js';

/**
 * Ids that are in a provider's catalogue but cannot hold a conversation. Every
 * list is polluted with these — Groq alone ships whisper, TTS and prompt-guard
 * models in the same array as its chat models.
 */
export const NOT_A_CHAT_MODEL = /whisper|tts|embed|moderat|guard|rerank|transcrib|speech|audio|image|dall-e|orpheus|sora|veo|imagen|lyria/i;

const LOCAL_LIST_TIMEOUT_MS = 3000;

/**
 * The ids AGNT's live fetch last saw for this provider, in vendor order, or
 * null if it has never been fetched. Read under the registry key and, for
 * lists saved by older versions, the lowercased display name.
 */
export function liveModelIds(config) {
  if (!config) return null;
  const models = getLastSuccessfulModels(config.key) || getLastSuccessfulModels(config.name) || null;
  if (!models) return null;
  const ordered = models.map((m) => m?.id).filter((id) => typeof id === 'string' && id.length > 0);
  return ordered.length > 0 ? { ids: new Set(ordered), ordered } : null;
}

/**
 * @param {string} providerKey
 * @param {{ preferred?: string[] }} [options] ordered picks to try first;
 *   defaults to the registry's recommended then fallback lists.
 * @returns {string|null}
 */
export function resolveDefaultModel(providerKey, { preferred } = {}) {
  const config = getProviderConfig(providerKey);
  if (!config) return null;

  const picks = (preferred || [...(config.recommendedModels || []), ...(config.fallbackModels || [])])
    .filter((id) => typeof id === 'string' && id.length > 0);

  const live = liveModelIds(config);
  if (live) {
    const confirmed = picks.find((id) => live.ids.has(id));
    if (confirmed) return confirmed;
    const usable = live.ordered.find((id) => !NOT_A_CHAT_MODEL.test(id));
    if (usable) return usable;
  }
  return picks[0] || null;
}

/**
 * Same, including `local` — which has no registry entry because it is whatever
 * the user is running, so it is asked directly. Returns null when the local
 * server is unreachable: every request to it would fail anyway, and "no model"
 * is a clearer error than a guessed id.
 */
export async function resolveDefaultModelAsync(providerKey, options = {}) {
  if (providerKey !== 'local') return resolveDefaultModel(providerKey, options);
  const baseURL = String(buildBaseURLs().local || '').replace(/\/$/, '');
  try {
    const res = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(LOCAL_LIST_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.json();
    const ids = (body?.data || []).map((m) => m?.id).filter((id) => typeof id === 'string');
    return ids.find((id) => !NOT_A_CHAT_MODEL.test(id)) || null;
  } catch (error) {
    console.warn(`[defaultModel] Local model server unreachable at ${baseURL}: ${error.message}`);
    return null;
  }
}
