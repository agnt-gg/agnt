import { beforeEach, describe, expect, it, vi } from 'vitest';

const antigravity = vi.hoisted(() => ({
  checkApiUsable: vi.fn(),
  getAccessToken: vi.fn(),
  getOAuth2Client: vi.fn(),
  fetchAvailableModels: vi.fn(),
}));
const geminiCli = vi.hoisted(() => ({
  isUsingApiKey: vi.fn(),
  checkApiUsable: vi.fn(),
  hasPaidTier: vi.fn(),
}));
vi.mock('../../src/services/auth/AntigravityAuthManager.js', () => ({ default: antigravity }));
vi.mock('../../src/services/auth/GeminiCliAuthManager.js', () => ({ default: geminiCli }));

const { listGoogleSubscriptionModels } = await import('../../src/services/ai/googleSubscriptionModels.js');
const { getModelMetadata, getProviderConfig } = await import('../../src/services/ai/providerConfigs.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  antigravity.checkApiUsable.mockResolvedValue({ available: true, apiUsable: true });
  antigravity.getAccessToken.mockResolvedValue('token');
  antigravity.getOAuth2Client.mockReturnValue({});
  geminiCli.isUsingApiKey.mockReturnValue(false);
  geminiCli.hasPaidTier.mockReturnValue(false);
});

describe('Antigravity listing', () => {
  it('serves the live catalog and registers Google metadata for newly discovered models', async () => {
    antigravity.fetchAvailableModels.mockResolvedValue([
      { id: 'gemini-4-argon-test', maxTokens: 2097152, maxOutputTokens: 131072, supportsImages: true, supportsThinking: true },
      { id: 'gemini-3.6-flash-high', maxTokens: 1048576, maxOutputTokens: 65536, supportsImages: true, supportsThinking: true },
    ]);

    const { status, body } = await listGoogleSubscriptionModels('antigravity', { forceRefresh: true });

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, dynamic: true, models: ['gemini-4-argon-test', 'gemini-3.6-flash-high'], count: 2 });
    expect(antigravity.checkApiUsable).toHaveBeenCalledWith({ forceRefresh: true });
    expect(getModelMetadata('antigravity', 'gemini-4-argon-test')).toMatchObject({
      contextWindow: 2097152, maxOutputTokens: 131072, supportsVision: true, reasoning: true, inputCostPer1M: 0, outputCostPer1M: 0,
    });
  });

  it('falls back to the static list, marked non-dynamic, when Google is unreachable', async () => {
    antigravity.fetchAvailableModels.mockResolvedValue([]);
    const { status, body } = await listGoogleSubscriptionModels('antigravity');
    expect(status).toBe(200);
    expect(body.dynamic).toBe(false);
    expect(body.models).toEqual(getProviderConfig('antigravity').fallbackModels);
  });

  it('never hits Google while cooling down', async () => {
    antigravity.checkApiUsable.mockResolvedValue({ available: true, coolingDown: true, retryAfterMs: 1000, hint: 'cooling' });
    const { status, body } = await listGoogleSubscriptionModels('antigravity');
    expect(status).toBe(429);
    expect(body).toMatchObject({ coolingDown: true, retryAfterMs: 1000 });
    expect(antigravity.fetchAvailableModels).not.toHaveBeenCalled();
  });

  it('reports not-connected without listing anything', async () => {
    antigravity.checkApiUsable.mockResolvedValue({ available: false });
    const { status } = await listGoogleSubscriptionModels('antigravity');
    expect(status).toBe(400);
    expect(antigravity.fetchAvailableModels).not.toHaveBeenCalled();
  });
});

describe('Gemini CLI (OAuth) listing', () => {
  it("serves the account's live entitlement list", async () => {
    geminiCli.checkApiUsable.mockResolvedValue({ available: true, apiUsable: true, entitledModels: ['gemini-3.8-flash', 'gemini-2.5-pro'] });
    const { status, body } = await listGoogleSubscriptionModels('gemini-cli');
    expect(status).toBe(200);
    expect(body).toMatchObject({ dynamic: true, models: ['gemini-3.8-flash', 'gemini-2.5-pro'] });
  });

  it('refuses to list models for an unlicensed account (every one of them would 403)', async () => {
    geminiCli.checkApiUsable.mockResolvedValue({
      available: true, apiUsable: false, unlicensed: true, deprecated: true, hint: 'Google discontinued Gemini CLI for consumer accounts', entitledModels: [],
    });
    const { status, body } = await listGoogleSubscriptionModels('gemini-cli');
    expect(status).toBe(400);
    expect(body).toMatchObject({ success: false, deprecated: true, unlicensed: true });
    expect(body.error).toMatch(/discontinued/);
    expect(body.models).toBeUndefined();
  });

  it('falls back on a transient entitlement failure, adding the Pro preview for paid tiers', async () => {
    geminiCli.checkApiUsable.mockResolvedValue({ available: true, apiUsable: true, entitledModels: [] });
    geminiCli.hasPaidTier.mockReturnValue(true);
    const { status, body } = await listGoogleSubscriptionModels('gemini-cli');
    expect(status).toBe(200);
    expect(body.dynamic).toBe(false);
    expect(body.models).toEqual(['gemini-3.1-pro-preview', ...getProviderConfig('gemini-cli').fallbackModels]);
  });

  it('defers to the caller in API-key mode (public Gemini API lists dynamically)', async () => {
    geminiCli.isUsingApiKey.mockReturnValue(true);
    expect(await listGoogleSubscriptionModels('gemini-cli')).toBeNull();
    expect(geminiCli.checkApiUsable).not.toHaveBeenCalled();
  });
});

describe('scope', () => {
  it('returns null for providers it does not own', async () => {
    expect(await listGoogleSubscriptionModels('openai')).toBeNull();
  });
});
