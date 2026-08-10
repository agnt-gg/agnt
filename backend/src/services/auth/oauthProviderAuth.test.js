import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const claude = { checkApiUsable: vi.fn(), getAccessToken: vi.fn() };
const geminiCli = { checkApiUsable: vi.fn(), getAccessToken: vi.fn() };
const antigravity = { checkApiUsable: vi.fn(), getAccessToken: vi.fn() };
const codex = { checkApiUsable: vi.fn(), getAccessToken: vi.fn(), getOAuthToken: vi.fn() };

vi.mock('./ClaudeCodeAuthManager.js', () => ({ default: claude }));
vi.mock('./GeminiCliAuthManager.js', () => ({ default: geminiCli }));
vi.mock('./AntigravityAuthManager.js', () => ({ default: antigravity }));
vi.mock('./CodexAuthManager.js', () => ({ default: codex }));

const { resolveOAuthApiKey, isOAuthProvider, oauthProviderKeys } = await import('./oauthProviderAuth.js');

/**
 * One place decides how a subscription provider's token is obtained.
 *
 * ModelRoutes carried this ladder TWICE — once in the model-list route and
 * once in the refresh route — four hand-written arms each. Duplicated auth
 * logic is the shape of a real defect: one path can gain a check the other
 * never gets, and nothing announces the difference.
 */
beforeEach(() => {
  for (const m of [claude, geminiCli, antigravity, codex]) {
    for (const fn of Object.values(m)) fn.mockReset();
  }
});

describe('resolveOAuthApiKey', () => {
  it('covers exactly the four OAuth providers', () => {
    expect(oauthProviderKeys().sort()).toEqual(['antigravity', 'claude-code', 'gemini-cli', 'openai-codex']);
    expect(isOAuthProvider('claude-code')).toBe(true);
    expect(isOAuthProvider('CLAUDE-CODE')).toBe(true);
    // Key-based providers must NOT route through here.
    for (const p of ['openai', 'anthropic', 'groq', 'gemini', 'grokai']) {
      expect(isOAuthProvider(p), p).toBe(false);
    }
  });

  it('returns the token when the provider is connected', async () => {
    claude.checkApiUsable.mockResolvedValue({ available: true });
    claude.getAccessToken.mockResolvedValue('cc-token');
    await expect(resolveOAuthApiKey('claude-code')).resolves.toEqual({ ok: true, apiKey: 'cc-token' });
  });

  it('reports not-connected as a value, never a throw', async () => {
    // A disconnected provider is an expected state the caller turns into a
    // 400. Throwing would make every call site need a try/catch to render a
    // message it already knows.
    geminiCli.checkApiUsable.mockResolvedValue({ available: false });
    const r = await resolveOAuthApiKey('gemini-cli');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Gemini CLI is not connected/);
  });

  it('passes forceRefresh through only when asked', async () => {
    antigravity.checkApiUsable.mockResolvedValue({ available: true });
    antigravity.getAccessToken.mockResolvedValue('ag');

    await resolveOAuthApiKey('antigravity');
    expect(antigravity.checkApiUsable).toHaveBeenCalledWith(undefined);

    await resolveOAuthApiKey('antigravity', { forceRefresh: true });
    expect(antigravity.checkApiUsable).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it('Codex uses its OAuth token, NOT getAccessToken', async () => {
    // getAccessToken returns the platform `sk-` key whenever OPENAI_API_KEY is
    // set, and chatgpt.com rejects it with a 401 — which silently degraded
    // every Codex model list to the hardcoded fallback.
    codex.checkApiUsable.mockResolvedValue({ available: true, apiUsable: true });
    codex.getOAuthToken.mockReturnValue('codex-oauth');
    codex.getAccessToken.mockResolvedValue('sk-platform-key');

    const r = await resolveOAuthApiKey('openai-codex');
    expect(r).toEqual({ ok: true, apiKey: 'codex-oauth' });
    expect(codex.getAccessToken).not.toHaveBeenCalled();
  });

  it('Codex connected-but-unusable is rejected with the service status', async () => {
    codex.checkApiUsable.mockResolvedValue({ available: true, apiUsable: false, apiStatus: 503 });
    const r = await resolveOAuthApiKey('openai-codex');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not usable \(status: 503\)/);
  });

  it('an empty token is a failure, not a success carrying undefined', async () => {
    claude.checkApiUsable.mockResolvedValue({ available: true });
    claude.getAccessToken.mockResolvedValue(null);
    const r = await resolveOAuthApiKey('claude-code');
    expect(r.ok).toBe(false);
  });

  it('a non-OAuth provider is rejected rather than silently handled', async () => {
    const r = await resolveOAuthApiKey('groq');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not an OAuth provider/);
  });
});

describe('ModelRoutes uses the shared resolver', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../../routes/ModelRoutes.js'), 'utf8');

  it('the refresh route no longer hand-rolls the ladder', () => {
    expect(SRC).toMatch(/isOAuthProvider\(providerLower\)/);
    expect(SRC).toMatch(/resolveOAuthApiKey\(providerLower, \{ forceRefresh: true \}\)/);
  });

  it('ANTI-VACUITY: the refresh route still resolves a key at all', () => {
    // A "fix" that deleted the branch would satisfy the assertion above.
    expect(SRC).toMatch(/apiKey = resolved\.apiKey;/);
  });

  it('the duplicated per-provider auth arms are gone from the refresh route', () => {
    // The list route still has its own arms (it also does CLI model listing);
    // what must not survive is the second COPY of the pure auth ladder.
    const refresh = SRC.slice(SRC.indexOf('forceRefresh: true'));
    expect(refresh).not.toMatch(/ClaudeCodeAuthManager\.checkApiUsable\(\{ forceRefresh: true \}\)/);
    expect(refresh).not.toMatch(/GeminiCliAuthManager\.checkApiUsable\(\{ forceRefresh: true \}\)/);
    expect(refresh).not.toMatch(/AntigravityAuthManager\.checkApiUsable\(\{ forceRefresh: true \}\)/);
  });
});
