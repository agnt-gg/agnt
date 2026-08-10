/**
 * CONTRACT: the workspace chat drives the browser the user can see, on the
 * provider the user chose.
 *
 * The Browser widget is a bare surface — no task box, no provider picker — so
 * both of those decisions are made here, and both have a wrong answer that is
 * easy to ship:
 *
 *   - taking the provider the MODEL asked for would spend credits on a vendor
 *     the user did not select for this workspace;
 *   - letting a background workflow adopt the visible browser would seize the
 *     window the user is reading, mid-task.
 *
 * The orchestrator executes library actions with `{ userId, ...context }` as
 * the engine (tools.js), so a chat turn arrives carrying its conversation's
 * provider and a workflow run does not. That difference is the whole test.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-browser-chat-'));

vi.mock('../../../services/auth/AuthManager.js', () => ({
  default: { getValidAccessToken: vi.fn().mockResolvedValue('sk-test-key') },
}));
vi.mock('../../../services/ai/CustomOpenAIProviderService.js', () => ({
  default: { isCustomProvider: vi.fn().mockResolvedValue(false), getProviderCredentials: vi.fn() },
}));
vi.mock('../../../utils/PathManager.js', () => ({
  default: { getUserDataPath: () => tmpDir, getPath: (...p) => path.join(tmpDir, ...p) },
}));

const { default: action } = await import('./ai-browser-use.js');
const {
  registerSurface, getActiveSurface, _resetSurfaces,
} = await import('../../../services/browserSurfaces.js');

const CDP = 'ws://127.0.0.1:51234/tok3n-value';
const chat = (provider, extra = {}) => ({ userId: 'u1', provider, ...extra });
const workflow = () => ({ userId: 'u1', currentTriggerData: {}, outputs: {} });

beforeEach(() => _resetSurfaces());
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('telling a chat turn from a workflow run', () => {
  it('recognises a conversation by the provider it carries', () => {
    expect(action.isChatRun(chat('Gemini'))).toBe(true);
    expect(action.isChatRun({ userId: 'u1', normalizedProvider: 'claude-code' })).toBe(true);
  });

  it('does not mistake a workflow engine for a conversation', () => {
    expect(action.isChatRun(workflow())).toBe(false);
    expect(action.isChatRun(undefined)).toBe(false);
  });
});

describe('the provider comes from the conversation', () => {
  it('uses the workspace/global provider the user selected', () => {
    expect(action.resolveProvider({}, chat('Claude Code'))).toBe('Claude Code');
  });

  it('falls back to the normalized provider when that is all there is', () => {
    expect(action.resolveProvider({}, { normalizedProvider: 'groq' })).toBe('groq');
  });

  it('ignores a provider the MODEL asked for', () => {
    // Same rule analyze_image enforces: session defaults are authoritative.
    // A model picking its own vendor spends credits the user did not choose.
    expect(action.resolveProvider({ provider: 'OpenAI' }, chat('Gemini'))).toBe('Gemini');
  });

  it('still obeys the node dropdown in a workflow', () => {
    // There is no conversation to inherit from, and the dropdown IS a user
    // choice — so it wins outright.
    expect(action.resolveProvider({ provider: 'DeepSeek' }, workflow())).toBe('DeepSeek');
    expect(action.resolveProvider({}, workflow())).toBe('OpenAI');
  });

});

describe('the model comes from the conversation too', () => {
  // The user selects NOTHING. Whatever the workspace is set to — or the account
  // default when the workspace overrides nothing — drives the browser, exactly
  // as it drives the conversation.
  it('uses the session model exactly as chosen', () => {
    expect(action.resolveModel({}, chat('Gemini', { model: 'gemini-3.1-pro-preview' })))
      .toBe('gemini-3.1-pro-preview');
  });

  it('never substitutes a model of its own choosing', async () => {
    // This is the regression. The tool used to override the session model with
    // its own vision default, which is precisely what analyze_image's source
    // warns against: substituting behind the user's back hides the real fix
    // (change the model in settings) behind behaviour nobody can see.
    const engine = chat('Gemini', { model: 'gemini-3.1-pro-preview' });
    const llm = await action.buildLlmSpec(
      {
        provider: action.resolveProvider({}, engine),
        model: action.resolveModel({}, engine),
      },
      'u1',
    );
    expect(llm.spec.class).toBe('ChatGoogle');
    expect(llm.spec.kwargs.model).toBe('gemini-3.1-pro-preview');
  });

  it('ignores a model the MODEL asked for', () => {
    expect(action.resolveModel({ model: 'gpt-4o-mini' }, chat('Gemini', { model: 'gemini-2.5-pro' })))
      .toBe('gemini-2.5-pro');
  });

  it('falls back to the provider default when the session names no model', async () => {
    // Blank, not broken: defaultModelFor supplies the provider's own default
    // rather than sending an empty model id to the wire.
    expect(action.resolveModel({}, chat('Gemini'))).toBe('');
    const llm = await action.buildLlmSpec({ provider: 'Gemini', model: '' }, 'u1');
    expect(llm.spec.kwargs.model).toBeTruthy();
  });

  it('still obeys the node field in a workflow', () => {
    expect(action.resolveModel({ model: 'gpt-4.1' }, workflow())).toBe('gpt-4.1');
    expect(action.resolveModel({}, workflow())).toBe('');
  });

  it('carries the session model into a gateway grant', async () => {
    // Subscription providers mint a token bound to one model. Inheriting the
    // session model means the grant is for the model the user actually chose.
    const engine = chat('Claude Code', { model: 'claude-opus-5' });
    const llm = await action.buildLlmSpec(
      { provider: action.resolveProvider({}, engine), model: action.resolveModel({}, engine) },
      'u1',
    );
    const { verifyGatewayToken } = await import('../../../services/ai/localGatewayTokens.js');
    expect(verifyGatewayToken(llm.spec.kwargs.api_key)).toMatchObject({ model: 'claude-opus-5' });
  });
});

describe('the browser comes from the canvas', () => {
  // These assert IDENTITY — which browser a turn owns. Whether that browser is
  // still listening is a separate question, proved against a real socket in
  // services/browserSurfaces.test.js. Passing an explicit probe keeps a
  // liveness change from silently turning these green for the wrong reason.
  const alive = () => true;

  it('adopts the exact Browser widget captured by the chat turn', async () => {
    registerSurface('u1', 'w_a', { workspaceId: 'ws_a', cdpUrl: CDP });
    registerSurface('u1', 'w_b', { workspaceId: 'ws_b', cdpUrl: 'ws://127.0.0.1:4444/other' });
    const engine = chat('Gemini', {
      workspaceState: { id: 'ws_a', browserInstanceId: 'w_a' },
    });
    expect(await action.resolveSurface({}, engine, 'u1', 50, alive)).toBe(CDP);
  });

  it('launches instead of handing back a browser that has closed', async () => {
    // The reported failure: a registry entry outlived its bridge, so the run
    // died on "[WinError 1225] The remote computer refused the network
    // connection" with zero steps taken. Now an unreachable surface resolves
    // to nothing, and the run proceeds in a browser that exists.
    registerSurface('u1', 'w_a', { workspaceId: 'ws_a', cdpUrl: CDP });
    const engine = chat('Gemini', {
      workspaceState: { id: 'ws_a', browserInstanceId: 'w_a' },
    });
    expect(await action.resolveSurface({}, engine, 'u1', 50, () => false)).toBe('');
  });

  it('does not let another workspace steal the turn', async () => {
    registerSurface('u1', 'w_b', { workspaceId: 'ws_b', cdpUrl: CDP });
    const engine = chat('Gemini', {
      workspaceState: { id: 'ws_a', browserInstanceId: 'w_a' },
    });
    expect(await action.resolveSurface({}, engine, 'u1', 50, alive)).toBe('');
  });

  it('never adopts another user\'s window', async () => {
    registerSurface('u2', 'w_1', { cdpUrl: CDP });
    expect(await action.resolveSurface({}, chat('Gemini'), 'u1', 50, alive)).toBe('');
  });

  it('launches its own browser when no window is open', async () => {
    // Chat outside a workspace, or a non-desktop client. Launching is the
    // honest fallback — refusing would make the tool unusable off-canvas.
    expect(await action.resolveSurface({}, chat('Gemini'), 'u1', 50, alive)).toBe('');
  });

  it('leaves the visible browser alone during a workflow run', async () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    // A background automation seizing the window the user is reading is worse
    // than it launching one of its own.
    expect(await action.resolveSurface({}, workflow(), 'u1', 50, alive)).toBe('');
  });

  it('opens a separate window only when explicitly asked', async () => {
    // The tool ALREADY opens real Chromium windows — an empty cdpUrl makes the
    // runner call Browser(), which launches one. That is the default whenever
    // no canvas surface is found, so the user sees external windows they never
    // asked for. externalWindow makes it a DECISION instead of a fallback, and
    // is the lever the schema description points the model at.
    registerSurface('u1', 'w_a', { workspaceId: 'ws_a', cdpUrl: CDP });
    const engine = chat('Gemini', {
      workspaceState: { id: 'ws_a', browserInstanceId: 'w_a' },
    });

    expect(await action.resolveSurface({}, engine, 'u1', 50, alive)).toBe(CDP);
    expect(await action.resolveSurface({ externalWindow: 'true' }, engine, 'u1', 50, alive)).toBe('');
  });

  it('lets an explicit external-window request beat plumbing', async () => {
    // "Give me a separate window" is a human instruction; cdpUrl is plumbing.
    // They can only disagree when someone asked for both, and the person wins.
    const explicit = 'ws://127.0.0.1:9999/explicit';
    expect(await action.resolveSurface(
      { externalWindow: 'true', cdpUrl: explicit },
      chat('Gemini'),
      'u1',
      50,
      alive,
    )).toBe('');
  });

  it('treats an unset externalWindow as off', async () => {
    registerSurface('u1', 'w_a', { workspaceId: 'ws_a', cdpUrl: CDP });
    const engine = chat('Gemini', { workspaceState: { id: 'ws_a', browserInstanceId: 'w_a' } });
    // A checkbox arrives as the STRING 'false' when cleared, which is truthy.
    for (const off of [undefined, '', 'false', false]) {
      expect(await action.resolveSurface({ externalWindow: off }, engine, 'u1', 50, alive)).toBe(CDP);
    }
  });

  it('restores launch-time options for an external window', async () => {
    // headless/allowedDomains are meaningless against a browser we did not
    // launch, so they are dropped when attached — but they must come BACK when
    // the user deliberately asked for a window of our own.
    const config = action.buildRunnerConfig(
      { headless: 'true', allowedDomains: 'example.com', generateGif: 'false' },
      'do a thing',
      { spec: { class: 'ChatGoogle', kwargs: {} }, visionCapable: true, providerName: 'Gemini' },
    );
    expect(config.cdpUrl).toBeNull();
    expect(config.browser).toEqual({ headless: true, allowed_domains: ['example.com'] });
  });

  it('forgets a browser that refused the connection, so a retry works', async () => {
    // The probe closes almost all of this, but a window can still close between
    // the probe and the attach. Without the prune, every later turn would be
    // handed the same refused socket and the user would be stuck.
    registerSurface('u1', 'w_a', { workspaceId: 'ws_a', cdpUrl: CDP });

    const guidance = action.describeLostSurface(
      'Failed to establish CDP connection to browser: [WinError 1225] The remote computer refused the network connection',
      CDP,
      'u1',
    );

    expect(guidance).toMatch(/no longer open/);
    expect(guidance).toMatch(/run the task again/);
    expect(await action.resolveSurface({}, chat('Gemini'), 'u1', 50, alive)).toBe('');
  });

  it('does not blame the browser for an unrelated failure', () => {
    // Mislabelling a quota error as a dead window would send the user to fix
    // the wrong thing, and would drop a perfectly good surface on the way.
    registerSurface('u1', 'w_a', { workspaceId: 'ws_a', cdpUrl: CDP });
    expect(action.describeLostSurface('429 RESOURCE_EXHAUSTED', CDP, 'u1')).toBeNull();
    expect(action.describeLostSurface('Insufficient Balance', CDP, 'u1')).toBeNull();
    // ...and the surface it was NOT about is still there.
    expect(getActiveSurface('u1', { workspaceId: 'ws_a' }).instanceId).toBe('w_a');
  });

  it('honours an explicitly supplied surface', async () => {
    const other = 'ws://127.0.0.1:9999/explicit';
    expect(await action.resolveSurface({ cdpUrl: other }, chat('Gemini'), 'u1', 50)).toBe(other);
  });
});
