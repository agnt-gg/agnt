/** Native wire allowlist pinned to backend codexRealtimeVoiceService (see notices). */
export const CODEX_VOICE_PROVIDERS = Object.freeze(['openai-codex', 'openai-codex-2']);
export const CODEX_VOICES = Object.freeze(['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove']);
export const CODEX_VOICE_DEFAULTS = Object.freeze({ engine: 'legacy', provider: 'openai-codex', voice: 'cove' });
export function validCodexAudioConfig(value) {
  return Boolean(value && CODEX_VOICE_PROVIDERS.includes(value.provider) && CODEX_VOICES.includes(value.voice));
}
export const LOCAL_STREAM_PROVIDERS = Object.freeze(['pocket-tts-cpu', 'faster-qwen-candidate']);
export function validNarrationConfig({output = 'webspeech', providerEngine} = {}) {
  return ['webspeech', 'local-stream'].includes(output) &&
    (providerEngine === undefined || LOCAL_STREAM_PROVIDERS.includes(providerEngine)) &&
    (output !== 'local-stream' || LOCAL_STREAM_PROVIDERS.includes(providerEngine));
}
export function validatedCodexProfile(value) {
  if (!validCodexAudioConfig(value) || !['legacy', 'codex', 'local'].includes(value.engine)) return null;
  if (!validNarrationConfig(value)) return null;
  return { engine: value.engine, provider: value.provider, voice: value.voice, ...(value.output === undefined ? {} : {output:value.output}), ...(value.providerEngine === undefined ? {} : {providerEngine:value.providerEngine}) };
}
