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
const { registerSurface, _resetSurfaces } = await import('../../../services/browserSurfaces.js');

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

  it('inherits only the provider, never the chat model', async () => {
    // The chat model is chosen for conversation; browser-use reads screenshots.
    // Letting defaultModelFor choose keeps the run on a vision-capable model.
    const llm = await action.buildLlmSpec(
      { provider: action.resolveProvider({}, chat('Gemini', { model: 'gemini-3.1-pro-preview' })) },
      'u1',
    );
    expect(llm.spec.class).toBe('ChatGoogle');
    expect(llm.spec.kwargs.model).toBe('gemini-2.5-flash');
  });
});

describe('the browser comes from the canvas', () => {
  it('adopts the Browser widget that is open', async () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    expect(await action.resolveSurface({}, chat('Gemini'), 'u1', 50)).toBe(CDP);
  });

  it('never adopts another user\'s window', async () => {
    registerSurface('u2', 'w_1', { cdpUrl: CDP });
    expect(await action.resolveSurface({}, chat('Gemini'), 'u1', 50)).toBe('');
  });

  it('launches its own browser when no window is open', async () => {
    // Chat outside a workspace, or a non-desktop client. Launching is the
    // honest fallback — refusing would make the tool unusable off-canvas.
    expect(await action.resolveSurface({}, chat('Gemini'), 'u1', 50)).toBe('');
  });

  it('leaves the visible browser alone during a workflow run', async () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    // A background automation seizing the window the user is reading is worse
    // than it launching one of its own.
    expect(await action.resolveSurface({}, workflow(), 'u1', 50)).toBe('');
  });

  it('honours an explicitly supplied surface', async () => {
    const other = 'ws://127.0.0.1:9999/explicit';
    expect(await action.resolveSurface({ cdpUrl: other }, chat('Gemini'), 'u1', 50)).toBe(other);
  });
});
