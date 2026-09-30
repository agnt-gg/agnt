import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Google is mocked at the HTTP boundary: axios.post carries loadCodeAssist,
// the OAuth2Client carries retrieveUserQuota. Everything between is real.
const axiosPost = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { post: axiosPost, get: vi.fn() } }));
vi.mock('../../src/services/ai/clientVersions.js', () => ({ getClientVersion: vi.fn(async () => '0.62.0') }));

const { default: manager } = await import('../../src/services/auth/GeminiCliAuthManager.js');

const LICENSE_403 = Object.assign(new Error('Request failed with status code 403'), {
  response: { status: 403, data: { error: { code: 403, message: 'You do not have a valid license of this product. (#3501)' } } },
});

let quotaRequest;
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  manager._lastApiCheck = null;
  manager._lastApiStatus = null;
  vi.spyOn(manager, '_readApiKey').mockReturnValue(null);
  vi.spyOn(manager, '_readGcpProject').mockReturnValue(null);
  vi.spyOn(manager, 'getAccessToken').mockResolvedValue('access-token');
  vi.spyOn(manager, 'ensureOnboarded').mockResolvedValue('aicode-consumers');
  quotaRequest = vi.fn();
  vi.spyOn(manager, 'getOAuth2Client').mockReturnValue({ request: quotaRequest });
  axiosPost.mockResolvedValue({ status: 200, data: { currentTier: { id: 'free-tier' } } });
});
afterEach(() => vi.restoreAllMocks());

// checkApiUsable's first gate reads ~/.gemini/oauth_creds.json directly; serve
// a signed-in session so the test never depends on this machine's real login.
async function check() {
  const fs = await import('fs');
  const realRead = fs.default.readFileSync;
  vi.spyOn(fs.default, 'readFileSync').mockImplementation((file, ...rest) => (
    String(file).endsWith('oauth_creds.json')
      ? JSON.stringify({ access_token: 'a', refresh_token: 'r', expiry_date: Date.now() + 3_600_000 })
      : realRead(file, ...rest)
  ));
  return manager.checkApiUsable({ forceRefresh: true });
}

describe('Gemini CLI OAuth health check', () => {
  it('REGRESSION: a 200 from loadCodeAssist no longer masks an unlicensed account', async () => {
    quotaRequest.mockRejectedValue(LICENSE_403);
    const status = await check();

    expect(axiosPost).toHaveBeenCalledOnce(); // loadCodeAssist still said 200
    expect(status).toMatchObject({ available: true, apiUsable: false, unlicensed: true, deprecated: true, apiStatus: 403, entitledModels: [] });
    expect(status.hint).toMatch(/discontinued Gemini CLI for consumer accounts/);
  });

  it('names the GCP project when an enterprise project has no license', async () => {
    manager._readGcpProject.mockReturnValue('acme-prod');
    quotaRequest.mockRejectedValue(LICENSE_403);
    const status = await check();
    expect(status).toMatchObject({ apiUsable: false, unlicensed: true });
    expect(status.deprecated).toBeUndefined();
    expect(status.hint).toMatch(/"acme-prod" has no Gemini Code Assist license/);
  });

  it('exposes the live entitlement list for a licensed account, sending the Gemini CLI identity', async () => {
    quotaRequest.mockResolvedValue({ status: 200, data: { buckets: [{ modelId: 'gemini-3.8-flash' }, { modelId: 'gemini-2.5-pro' }] } });
    const status = await check();

    expect(status).toMatchObject({ apiUsable: true, entitledModels: ['gemini-3.8-flash', 'gemini-2.5-pro'] });
    expect(status.unlicensed).toBeUndefined();
    const [request] = quotaRequest.mock.calls[0];
    expect(request).toMatchObject({
      url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      method: 'POST',
      data: { project: 'aicode-consumers' },
    });
    expect(request.headers['User-Agent']).toMatch(/^GeminiCLI\/0\.62\.0 \(/);
  });

  it('stays usable on a transient quota failure (callers fall back, nothing is hidden)', async () => {
    quotaRequest.mockRejectedValue(Object.assign(new Error('socket hang up'), { response: undefined }));
    const status = await check();
    expect(status).toMatchObject({ apiUsable: true, entitledModels: [] });
    expect(status.unlicensed).toBeUndefined();
  });
});
