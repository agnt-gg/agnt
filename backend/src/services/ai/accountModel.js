/**
 * AGNT's own model, the default for a signed-in account that has chosen none.
 *
 * Every other provider needs a credential the user supplied, so the resolvers
 * refuse to guess one. AGNT is different: the signed-in session IS its
 * credential (AuthManager.getValidAccessToken('agnt')), so offering it is not
 * a guess. It is still offered only while that account's session is live, and
 * only after every rung the user configured, so it never overrides a choice.
 */
import { getSessionToken } from '../auth/sessionTokenCache.js';
import { resolveDefaultModel } from './defaultModel.js';

export const ACCOUNT_MODEL_PROVIDER = 'agnt';

/** @returns {{provider: string, model: string}|null} */
export function accountModelPair(userId) {
  if (!userId || !getSessionToken(userId)) return null;
  const model = resolveDefaultModel(ACCOUNT_MODEL_PROVIDER);
  return model ? { provider: ACCOUNT_MODEL_PROVIDER, model } : null;
}
