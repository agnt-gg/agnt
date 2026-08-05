/**
 * The credential resolver behind "voice works however you signed in with OpenAI".
 *
 * Both OpenAI sign-in shapes are covered here, and so is the thing that makes
 * the fallback safe: a ChatGPT OAuth token is entitled for Realtime ALONE
 * (measured 2026-08-04 — realtime/calls 201, but /v1/models 403 and
 * /v1/audio/speech, /v1/audio/transcriptions and /v1/chat/completions all 401
 * on scope). It must therefore never escape this module into the general
 * `openai` credential path, and callers must be able to tell the two kinds
 * apart when one gets rejected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getValidAccessToken = vi.fn();
const ensureValidToken = vi.fn();
const getChatGptAccountId = vi.fn();

vi.mock('./AuthManager.js', () => ({
  default: { getValidAccessToken: (...a) => getValidAccessToken(...a) },
}));
vi.mock('./CodexAuthManager.js', () => ({
  default: {
    ensureValidToken: (...a) => ensureValidToken(...a),
    getChatGptAccountId: (...a) => getChatGptAccountId(...a),
  },
}));

const {
  resolveOpenAiVoiceCredentialChain,
  resolveOpenAiVoiceCredential,
  hasOpenAiVoiceCredential,
  isBorrowedCredential,
  VOICE_CREDENTIAL_SOURCE,
} = await import('./openAiVoiceCredential.js');

beforeEach(() => {
  getValidAccessToken.mockReset();
  ensureValidToken.mockReset();
  getChatGptAccountId.mockReset();
  getValidAccessToken.mockResolvedValue(null);
  ensureValidToken.mockResolvedValue(null);
  getChatGptAccountId.mockReturnValue(null);
});

describe('every OpenAI sign-in reaches voice', () => {
  it('a platform API key works', async () => {
    getValidAccessToken.mockResolvedValue('sk-platform');
    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c).toEqual({ token: 'sk-platform', source: VOICE_CREDENTIAL_SOURCE.PLATFORM, accountId: null });
  });

  it('a ChatGPT/Codex OAuth token works when there is no platform key', async () => {
    // THE BUG THIS FIXES. This user previously got `no-credentials` and was
    // told voice did not exist, despite the token being accepted (201).
    ensureValidToken.mockResolvedValue('eyJhbGciOi.oauth.token');
    getChatGptAccountId.mockReturnValue('acct_123');

    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c.token).toBe('eyJhbGciOi.oauth.token');
    expect(c.source).toBe(VOICE_CREDENTIAL_SOURCE.CHATGPT);
    expect(c.accountId).toBe('acct_123');
  });

  it('no credential of any kind is null, not an exception', async () => {
    await expect(resolveOpenAiVoiceCredential('u1')).resolves.toBeNull();
  });

  it('asks the vault for the openai provider, for THIS user', async () => {
    getValidAccessToken.mockResolvedValue('sk-platform');
    await resolveOpenAiVoiceCredential('u9');
    expect(getValidAccessToken).toHaveBeenCalledWith('u9', 'openai');
  });
});

describe('precedence', () => {
  it('the ChatGPT subscription is preferred over a metered platform key', async () => {
    // A Realtime minute on a subscription is already paid for; the same minute
    // on a platform key is billed per token. Given both, spend the one that is
    // already spent.
    getValidAccessToken.mockResolvedValue('sk-platform');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');

    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c.token).toBe('eyJ.oauth.token');
    expect(c.source).toBe(VOICE_CREDENTIAL_SOURCE.CHATGPT);
  });

  it('offers BOTH credentials, best first, so the caller can fail over', async () => {
    // The bug this replaced: one credential was resolved eagerly and treated as
    // the answer. A key with no credit left resolves perfectly and then 429s,
    // which stranded users who had a working subscription one branch away.
    getValidAccessToken.mockResolvedValue('sk-platform');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');

    const chain = await resolveOpenAiVoiceCredentialChain('u1');
    expect(chain.map((c) => c.token)).toEqual(['eyJ.oauth.token', 'sk-platform']);
    expect(chain.map((c) => c.source)).toEqual([
      VOICE_CREDENTIAL_SOURCE.CHATGPT,
      VOICE_CREDENTIAL_SOURCE.PLATFORM,
    ]);
  });

  it('does not offer the same token twice', async () => {
    // An install-global `sk-` key can surface from BOTH stores. Retrying a
    // credential that just refused is a round trip spent to be told the same
    // thing again.
    getValidAccessToken.mockResolvedValue('sk-same');
    ensureValidToken.mockResolvedValue('sk-same');

    const chain = await resolveOpenAiVoiceCredentialChain('u1');
    expect(chain).toHaveLength(1);
  });

  it('a chain of one is what a user with only a platform key gets', async () => {
    getValidAccessToken.mockResolvedValue('sk-platform');

    const chain = await resolveOpenAiVoiceCredentialChain('u1');
    expect(chain).toEqual([
      { token: 'sk-platform', source: VOICE_CREDENTIAL_SOURCE.PLATFORM, accountId: null },
    ]);
  });

  it('no credential of any kind is an empty chain, not an exception', async () => {
    getValidAccessToken.mockRejectedValue(new Error('vault down'));
    ensureValidToken.mockRejectedValue(new Error('no auth file'));
    await expect(resolveOpenAiVoiceCredentialChain('u1')).resolves.toEqual([]);
  });

  it('an sk- key found in the Codex auth file is reported as a PLATFORM credential', async () => {
    // Source describes the KIND of credential (its scope), not where it was
    // found. An API key is full-scope wherever it lives, so its failures are
    // worth surfacing rather than swallowing.
    ensureValidToken.mockResolvedValue('sk-from-codex-file');
    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c.source).toBe(VOICE_CREDENTIAL_SOURCE.PLATFORM);
    expect(c.accountId).toBeNull();
  });
});

describe('a capability probe must never throw', () => {
  // This resolver backs GET /realtime/status. If it can throw, an unreachable
  // vault takes out the endpoint that decides whether to offer voice at all.

  it('a vault failure falls through to the Codex token instead of exploding', async () => {
    getValidAccessToken.mockRejectedValue(new Error('vault down'));
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');

    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c.source).toBe(VOICE_CREDENTIAL_SOURCE.CHATGPT);
  });

  it('a Codex refresh failure resolves to null', async () => {
    ensureValidToken.mockRejectedValue(new Error('refresh token revoked'));
    await expect(resolveOpenAiVoiceCredential('u1')).resolves.toBeNull();
  });

  it('both sides failing resolves to null', async () => {
    getValidAccessToken.mockRejectedValue(new Error('vault down'));
    ensureValidToken.mockRejectedValue(new Error('no auth file'));
    await expect(resolveOpenAiVoiceCredential('u1')).resolves.toBeNull();
  });

  it('an unreadable account id does not cost the user their session', async () => {
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    getChatGptAccountId.mockImplementation(() => {
      throw new Error('malformed jwt');
    });

    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c.token).toBe('eyJ.oauth.token');
    expect(c.accountId).toBeNull(); // the header is an optimisation, not a requirement
  });
});

describe('empty is absent', () => {
  // A blank string from a half-configured provider must not read as a
  // credential — it would produce a 401 the user cannot explain.
  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['undefined', undefined],
    ['a non-string', 12345],
  ])('a platform key that is %s falls through to Codex', async (_label, value) => {
    getValidAccessToken.mockResolvedValue(value);
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c.source).toBe(VOICE_CREDENTIAL_SOURCE.CHATGPT);
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['a non-string', {}],
  ])('a Codex token that is %s resolves to null', async (_label, value) => {
    ensureValidToken.mockResolvedValue(value);
    await expect(resolveOpenAiVoiceCredential('u1')).resolves.toBeNull();
  });

  it('trims a padded token rather than sending it padded', async () => {
    getValidAccessToken.mockResolvedValue('  sk-padded\n');
    const c = await resolveOpenAiVoiceCredential('u1');
    expect(c.token).toBe('sk-padded');
  });
});

describe('hasOpenAiVoiceCredential', () => {
  it('is true for a platform key and for a ChatGPT token alike', async () => {
    getValidAccessToken.mockResolvedValue('sk-platform');
    await expect(hasOpenAiVoiceCredential('u1')).resolves.toBe(true);

    getValidAccessToken.mockResolvedValue(null);
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    await expect(hasOpenAiVoiceCredential('u1')).resolves.toBe(true);
  });

  it('is false, not null, when there is nothing', async () => {
    await expect(hasOpenAiVoiceCredential('u1')).resolves.toBe(false);
  });
});

describe('isBorrowedCredential', () => {
  it('marks only the ChatGPT OAuth token as scope-limited', () => {
    expect(isBorrowedCredential(VOICE_CREDENTIAL_SOURCE.CHATGPT)).toBe(true);
    expect(isBorrowedCredential(VOICE_CREDENTIAL_SOURCE.PLATFORM)).toBe(false);
    expect(isBorrowedCredential(undefined)).toBe(false);
  });
});
