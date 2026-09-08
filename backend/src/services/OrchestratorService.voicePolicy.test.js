import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ settings: vi.fn(), update: vi.fn(), chain: vi.fn(), route: vi.fn(), client: vi.fn(), tools: vi.fn() }));
vi.mock('../models/UserModel.js', () => ({ default: { getUserSettings: mocks.settings, updateUserSettings: mocks.update } }));
vi.mock('./ai/LlmService.js', () => ({ createLlmClient: mocks.client }));
vi.mock('./orchestrator/tools.js', () => ({ executeTool: mocks.tools }));
vi.mock('./orchestrator/DynamicRouter.js', () => ({ buildRoutedChain: mocks.route }));
vi.mock('./orchestrator/ProviderFallback.js', async importOriginal => ({ ...(await importOriginal()), buildProviderChain: mocks.chain }));
import handler from './OrchestratorService.js';

const body = () => ({ provider: 'OpenAI-Codex', model: 'selected-model' });
async function request(overrides = {}, headers = { 'x-agnt-voice-request-id': 'TEST-voice-policy' }, user = { id: 'TEST-user' }) {
  const req = { user, headers, body: { ...body(), ...overrides }, files: [], path: '/chat', originalUrl: '/api/orchestrator/chat' };
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res); res.json.mockReturnValue(res);
  await handler(req, res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ selectedProvider: 'anthropic', selectedModel: 'other', fallbackEnabled: true, fallbackProviders: [{ provider: 'anthropic', model: 'other' }], routingMode: 'dynamic' });
  mocks.update.mockResolvedValue({});
  mocks.chain.mockReturnValue([{ provider: 'openai-codex', model: 'selected-model', primary: true, tier: 0 }, { provider: 'anthropic', model: 'other', tier: 1 }]);
  mocks.route.mockResolvedValue(null);
});
describe('actual handler voice pre-execution policy (mocked dependencies, no inference)', () => {
  it.each([
    [{ provider: undefined }, undefined, undefined, 'voice_destination_required'],
    [{ model: undefined }, undefined, undefined, 'voice_destination_required'],
    [{ provider: ' ' }, undefined, undefined, 'voice_destination_required'],
    [{ routingMode: 'dynamic' }, undefined, undefined, 'voice_routing_requires_selection'],
    [{ routingMode: 'default' }, undefined, undefined, 'voice_routing_requires_selection'],
    [{}, { 'x-agnt-voice-request-id': '' }, undefined, 'voice_request_identity_invalid'],
    [{}, { 'x-agnt-voice-request-id': ['a', 'b'] }, undefined, 'voice_request_identity_invalid'],
    [{}, undefined, null, 'voice_authenticated_user_required'],
    [{ voiceAccountId: 'client-claimed-account' }, undefined, undefined, 'voice_account_selection_unsupported'],
  ])('rejects unsafe request before routing or effects %#', async (override, headers, user, code) => {
    const res = await request(override, headers, user);
    expect(res.status).toHaveBeenCalledWith(code === 'voice_authenticated_user_required' ? 401 : 409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code, accepted: false }));
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.tools).not.toHaveBeenCalled();
  });
  it('voice pin never resolves global dynamic routing, fallbacks or default write-back', async () => {
    // Missing message stops the real handler AFTER provider-chain construction,
    // before SSE/execution. This probe intentionally does not claim completion.
    const res = await request();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.chain).not.toHaveBeenCalled(); expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it('ordinary text retains configured fallback and default persistence', async () => {
    mocks.settings.mockResolvedValue({ fallbackEnabled: true });
    const res = await request({}, {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.chain).toHaveBeenCalledOnce(); expect(mocks.update).toHaveBeenCalledOnce();
  });
});
