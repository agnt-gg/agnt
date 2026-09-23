// Explicit rollout gate: backend-specific image route, not a public stable API.
export function codexImagesEnabled() { return typeof process !== 'undefined' && process.env?.AGNT_CODEX_IMAGE_ENABLED === 'true'; }
export function isCodexImageProvider(provider) {
  return ['openai-codex', 'openai-codex-2'].includes(String(provider).toLowerCase());
}
export const CODEX_IMAGE_CAPABILITY = Object.freeze({
  models: ['provider-default'], operations: ['generate', 'edit'], defaultModel: 'provider-default',
  supportedSizes: { 'provider-default': ['auto'] }, supportedFormats: ['b64_json'],
  maxImages: 1, supportsQuality: false, supportsStyle: false,
  modelSelection: 'provider-selected', modelIdentityVerified: false,
});
