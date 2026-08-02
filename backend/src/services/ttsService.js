/**
 * ttsService — text to speech, provider-pluggable.
 *
 * WHY THIS IS A REGISTRY AND NOT A FUNCTION
 * -----------------------------------------
 * Voice output has one hard requirement and one soft one. The hard requirement
 * is that it ALWAYS works: an assistant that cannot speak because a key is
 * missing or the network is down is not an assistant with degraded audio, it is
 * a broken feature. The soft requirement is that it sound good.
 *
 * Those pull in opposite directions, so they are separated. The browser's own
 * speech synthesiser is the floor — no key, no network, no model download, no
 * cost, works offline, ships on every OS AGNT runs on. It is handled entirely
 * in the renderer and never reaches this module. Everything here is an
 * OPTIONAL upgrade: better prosody in exchange for a key and a round trip.
 *
 * So the contract for this service is narrow and honest: given a provider that
 * the user has already connected, return audio bytes. If no provider is
 * available, say so clearly and quickly (`available: false`) so the client can
 * fall back without a timeout. Never throw a 500 for "not configured" — that
 * is a normal state, not an error, and treating it as one produces a scary log
 * line for a working install.
 *
 * ADDING A PROVIDER is a single entry in ENGINES: declare how to build the
 * request and what content type comes back. No other file changes.
 */

import authManager from './auth/AuthManager.js';

/** Hard cap on a single synthesis request. Guards cost and latency alike. */
export const MAX_TTS_CHARS = 4000;

/**
 * Engine definitions.
 *
 * `build` returns a plain fetch description so the engines stay declarative and
 * unit-testable without a network: given inputs, assert the URL, headers, and
 * body rather than mocking a socket.
 */
export const ENGINES = Object.freeze({
  openai: {
    id: 'openai',
    label: 'OpenAI',
    providerId: 'openai',
    defaultVoice: 'alloy',
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    defaultModel: 'gpt-4o-mini-tts',
    contentType: 'audio/mpeg',
    build({ text, voice, model, speed, apiKey }) {
      return {
        url: 'https://api.openai.com/v1/audio/speech',
        options: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model || 'gpt-4o-mini-tts',
            voice: voice || 'alloy',
            input: text,
            // The API rejects out-of-range values outright, so clamp rather
            // than pass a user-supplied number straight through.
            speed: Math.min(4, Math.max(0.25, Number(speed) || 1)),
            response_format: 'mp3',
          }),
        },
      };
    },
  },

  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    providerId: 'elevenlabs',
    defaultVoice: '21m00Tcm4TlvDq8ikWAM', // "Rachel", the documented default
    voices: [],
    defaultModel: 'eleven_turbo_v2_5',
    contentType: 'audio/mpeg',
    build({ text, voice, model, apiKey }) {
      const voiceId = voice || '21m00Tcm4TlvDq8ikWAM';
      return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        options: {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: model || 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        },
      };
    },
  },
});

export function listEngines() {
  return Object.values(ENGINES).map((e) => ({
    id: e.id,
    label: e.label,
    voices: e.voices,
    defaultVoice: e.defaultVoice,
    defaultModel: e.defaultModel,
  }));
}

/**
 * Which engines can actually run for this user right now.
 * Resolution order per engine is whatever AuthManager already implements
 * (env var, then the local encrypted key store, then the remote vault) — this
 * module deliberately does not reimplement any of it.
 */
export async function availableEngines(userId) {
  const out = [];
  for (const engine of Object.values(ENGINES)) {
    try {
      const key = await authManager.getValidAccessToken(userId, engine.providerId);
      if (key) out.push(engine.id);
    } catch {
      // A provider that cannot be interrogated is simply not available. This is
      // a capability probe, not an operation — it must never throw.
    }
  }
  return out;
}

/**
 * Synthesise speech.
 *
 * @returns {Promise<{ available: boolean, reason?: string, audio?: Buffer, contentType?: string, engine?: string }>}
 *   `available: false` is a NORMAL result (no key configured), not an error.
 *   Genuine failures — a bad key, a provider outage — throw.
 */
export async function synthesize({ text, engine = 'openai', voice, model, speed, userId } = {}) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) return { available: false, reason: 'empty-text' };

  const def = ENGINES[engine];
  if (!def) return { available: false, reason: `unknown-engine:${engine}` };

  const input = clean.length > MAX_TTS_CHARS ? clean.slice(0, MAX_TTS_CHARS) : clean;

  let apiKey = null;
  try {
    apiKey = await authManager.getValidAccessToken(userId, def.providerId);
  } catch {
    apiKey = null;
  }
  if (!apiKey) return { available: false, reason: `no-credentials:${def.providerId}` };

  const { url, options } = def.build({ text: input, voice, model, speed, apiKey });

  const res = await fetch(url, options);
  if (!res.ok) {
    // Read the body for the message but NEVER echo headers or the key back.
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      detail = '';
    }
    const err = new Error(`TTS provider ${def.id} failed (${res.status}): ${detail}`);
    err.status = res.status;
    throw err;
  }

  const audio = Buffer.from(await res.arrayBuffer());
  return { available: true, audio, contentType: def.contentType, engine: def.id };
}

export default { synthesize, listEngines, availableEngines, ENGINES, MAX_TTS_CHARS };
