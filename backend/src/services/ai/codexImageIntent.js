import { isCodexImageProvider } from './codexImageCapability.js';

const POLICIES = Object.freeze(['latest', 'latest-fast']);
const REASON = 'Codex subscription image selection is unverified: the endpoint accepted an invalid model. No default, other account or API-key fallback will be used.';
function denied(message, code) {
  return Object.assign(new Error(message), { code, retryable: false });
}

/** No client-provided flag/catalog may manufacture verified upstream support. */
export function codexImageChoiceStatus() {
  return {
    subscriptionSelectionVerified: false,
    choices: POLICIES.map(policy => ({ policy, available: false, reason: REASON })),
    evidence: 'https://github.com/agnt-gg/agnt/issues/105#issuecomment-5595344143',
  };
}

/** Bind browser intent once, before text routing/fallback can change context.provider. */
export function bindCodexImageIntent(raw, selectedProvider) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { throw denied('Invalid image preference.', 'CODEX_IMAGE_INVALID_INTENT'); }
  }
  const provider = String(raw?.provider || selectedProvider || '').toLowerCase();
  if (raw == null && !isCodexImageProvider(provider)) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw != null) throw denied('Invalid image preference.', 'CODEX_IMAGE_INVALID_INTENT');
  }
  if (!isCodexImageProvider(provider)) throw denied('Image preference requires an explicit Codex account.', 'CODEX_IMAGE_INVALID_INTENT');
  if (isCodexImageProvider(String(selectedProvider).toLowerCase()) && provider !== String(selectedProvider).toLowerCase()) {
    throw denied('Image preference account differs from selected Codex account.', 'CODEX_IMAGE_ACCOUNT_MISMATCH');
  }
  const policy = raw?.policy ?? 'latest';
  if (!POLICIES.includes(policy)) throw denied('Invalid image selection; use latest or latest-fast.', 'CODEX_IMAGE_INVALID_INTENT');
  return Object.freeze({ provider, enabled: raw?.enabled === true, policy });
}

/**
 * Runs before capability lookup, credential acquisition or provider dispatch.
 * Returning null leaves a non-subscription invocation unchanged. No fabricated
 * mapping to Sunburst/Flare is installed until the subscription contract is known.
 */
export function authorizeCodexImageCall(args, context = {}) {
  const bound = context.codexImageIntent;
  if (!bound) {
    if (isCodexImageProvider(args.provider)) throw denied('Subscription images require explicit user intent.', 'CODEX_IMAGE_CONSENT_REQUIRED');
    return null;
  }
  if (!bound.enabled) throw denied('Subscription image generation is disabled for this turn.', 'CODEX_IMAGE_DISABLED');
  if (args.provider && String(args.provider).toLowerCase() !== bound.provider) {
    throw denied('Image provider/account substitution is prohibited.', 'CODEX_IMAGE_ACCOUNT_MISMATCH');
  }
  if (args.model && args.model !== bound.policy) throw denied('Image selection substitution is prohibited.', 'CODEX_IMAGE_SELECTION_MISMATCH');
  throw denied(REASON, 'CODEX_IMAGE_SELECTION_UNVERIFIED');
}
