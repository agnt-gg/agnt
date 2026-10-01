import UserModel from '../../models/UserModel.js';
import { resolveTurnProvider } from '../orchestrator/resolveTurnProvider.js';
import { parseFallbackList, resolveProviderKey } from '../orchestrator/ProviderFallback.js';
import { supportsImageGeneration } from './ProviderRegistry.js';

/**
 * The provider/model for work that runs outside a chat turn: generators,
 * evals, experiments, tools, workflow nodes.
 *
 *   what the caller named -> the account default -> the account fallback chain
 *
 * There is deliberately no vendor fallback. Every one that existed named a
 * provider not every account has, usually with a retired model, so it failed
 * on every call and hid the real problem: nothing was configured. That is now
 * reported as exactly that.
 */
export class NoAiConfiguredError extends Error {
  constructor() {
    super('No AI model is configured. Choose a default model in Settings, or add a fallback provider.');
    this.name = 'NoAiConfiguredError';
    this.code = 'NO_AI_CONFIGURED';
  }
}

/**
 * @param {string|null} userId
 * @param {{provider?: string|null, model?: string|null}} [requested]
 * @returns {Promise<{provider: string, model: string, source: string}>}
 * @throws {NoAiConfiguredError}
 */
export async function resolveAccountAi(userId, { provider, model } = {}) {
  const resolved = await resolveTurnProvider({
    requestProvider: provider,
    requestModel: model,
    loadUserSettings: () => (userId ? UserModel.getUserSettings(userId) : null),
  });
  if (!resolved.provider || !resolved.model) throw new NoAiConfiguredError();
  return resolved;
}

/**
 * The provider an image request runs on when it names none: the account
 * default if it can generate images, else the first fallback tier that can.
 * Null when none of the account's providers can, so the caller can say which
 * providers would.
 */
export async function resolveAccountImageProvider(userId) {
  if (!userId) return null;
  const settings = await UserModel.getUserSettings(userId).catch(() => null);
  if (!settings) return null;
  const candidates = [
    settings.selectedProvider,
    ...(settings.fallbackEnabled ? parseFallbackList(settings.fallbackProviders).map((tier) => tier.provider) : []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = resolveProviderKey(candidate) || String(candidate).toLowerCase();
    if (supportsImageGeneration(key)) return key;
  }
  return null;
}

export default resolveAccountAi;
