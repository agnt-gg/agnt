/** Safe cross-HTTP speech failure contract. Never includes a provider body/key. */
export class TtsError extends Error {
  constructor(code, { providerStatus = null } = {}) {
    super(providerStatus ? `Speech synthesis failed (${providerStatus})` : 'Speech synthesis failed');
    this.name = 'TtsError';
    this.code = code;
    this.providerStatus = providerStatus;
    // Kept for existing service consumers. HTTP exposes only the allowlist below.
    this.status = providerStatus || 502;
  }
}

export function ttsErrorResponse(error) {
  const typed = error instanceof TtsError;
  const providerStatus = typed ? error.providerStatus : null;
  const demote = [401, 403, 429].includes(providerStatus);
  return {
    status: demote ? providerStatus : 502,
    body: {
      success: false,
      error: 'Speech synthesis failed',
      code: typed ? error.code : 'tts-internal-error',
      providerStatus,
      demote,
    },
  };
}
