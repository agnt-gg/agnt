const accounts = new Set(['openai-codex', 'openai-codex-2']);
export const isCodexImageAccount = provider => accounts.has(String(provider || '').toLowerCase());
export function cleanImagePreference(value) {
  return { enabled: value?.enabled === true, policy: value?.policy === 'latest-fast' ? 'latest-fast' : 'latest' };
}
export function readImagePreferences() {
  try {
    const raw = JSON.parse(localStorage.getItem('codexImages') || '{}');
    return Object.fromEntries(Object.entries(raw).filter(([key]) => accounts.has(key)).map(([key, value]) => [key, cleanImagePreference(value)]));
  } catch { return {}; }
}
export function imageIntentFor(state, provider) {
  const key = String(provider || '').toLowerCase();
  if (!accounts.has(key)) return undefined;
  return { provider: key, ...cleanImagePreference(state?.codexImages?.[key]) };
}
