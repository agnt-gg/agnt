// The lean resident surface for conversations that START in deferred mode.
// See promptElements.DEFERRED_MODE_RESIDENT_TOOLS for the measurements.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({ buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT') }));
vi.mock('./workspaceContext.js', () => ({ loadWorkspaceContextSection: vi.fn(async () => '') }));

import { getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { DEFAULT_TOOLS, TOOL_GROUPS } from './toolSelector.js';
import { DEFERRED_MODE_RESIDENT_TOOLS } from './system-prompts/promptElements.js';
import { MAIN_CHAT_ONLY_TOOLS } from './system-prompts/conversationRole.js';

const schema = (name) => ({ type: 'function', function: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } } });
const registryNames = () => [...new Set([...DEFAULT_TOOLS, ...Object.values(TOOL_GROUPS).flat(), 'plugin_tool_1', 'mcp__srv__tool_1'])];
const namesOf = (schemas) => schemas.map((s) => s.function.name);
const surface = (ctx) => getChatConfig('orchestrator').getToolSchemas(ctx);
const conversation = (extra) => ({ latestUserMessage: 'hello there', enabledTools: null, ...extra });

beforeEach(() => {
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockResolvedValue(registryNames().map(schema));
});

describe('lean resident surface (deferred mode, lean profile)', () => {
  it('is exactly the measured core', async () => {
    const ctx = conversation({ _toolLoadingMode: 'deferred', _residentProfile: 'lean' });
    const resident = new Set(namesOf(await surface(ctx)));
    // An ordinary conversation: no Main-chat-only tools (start_chat).
    const expected = DEFERRED_MODE_RESIDENT_TOOLS.filter((n) => registryNames().includes(n) && !MAIN_CHAT_ONLY_TOOLS.has(n));
    expect([...resident].sort()).toEqual([...expected].sort());
  });

  it('keeps every other permitted tool reachable as a deferred definition', async () => {
    const ctx = conversation({ _toolLoadingMode: 'deferred', _residentProfile: 'lean' });
    const resident = new Set(namesOf(await surface(ctx)));
    const deferred = new Set(namesOf(ctx._deferredToolCatalog));
    for (const name of registryNames().filter((n) => !MAIN_CHAT_ONLY_TOOLS.has(n))) expect(resident.has(name) || deferred.has(name), name).toBe(true);
    for (const name of MAIN_CHAT_ONLY_TOOLS) expect(resident.has(name) || deferred.has(name), name).toBe(false);
    for (const name of ['generate_widget', 'computer_use', 'send_email', 'create_and_run_goal']) expect(deferred.has(name), name).toBe(true);
  });

  it('is stable turn over turn (the tool array never changes mid-conversation)', async () => {
    const first = conversation({ _toolLoadingMode: 'deferred', _residentProfile: 'lean' });
    const turnOne = namesOf(await surface(first));
    const second = conversation({ _toolLoadingMode: 'deferred', _residentProfile: 'lean',
      _loadedToolGroups: first._loadedToolGroups, latestUserMessage: 'now generate an image and email it' });
    expect(namesOf(await surface(second))).toEqual(turnOne);
  });
});

describe('every other conversation keeps the surface it had', () => {
  it('deferred, full profile (started before profiles existed): every static group resident', async () => {
    const resident = new Set(namesOf(await surface(conversation({ _toolLoadingMode: 'deferred', _residentProfile: 'full' }))));
    for (const name of ['generate_widget', 'create_and_run_goal', ...DEFAULT_TOOLS].filter((n) => !MAIN_CHAT_ONLY_TOOLS.has(n))) expect(resident.has(name), name).toBe(true);
  });

  it('no profile ever makes the browser or the desktop resident — they arrive on intent or discovery', async () => {
    for (const extra of [
      { _toolLoadingMode: 'deferred', _residentProfile: 'lean' },
      { _toolLoadingMode: 'deferred', _residentProfile: 'full' },
      { _toolLoadingMode: 'legacy', _residentProfile: 'full' },
    ]) {
      const ctx = conversation(extra);
      const resident = new Set(namesOf(await surface(ctx)));
      expect(resident.has('browser'), JSON.stringify(extra)).toBe(false);
      expect(resident.has('computer_use'), JSON.stringify(extra)).toBe(false);
      if (ctx._deferredToolCatalog) expect(namesOf(ctx._deferredToolCatalog)).toContain('browser');
    }
  });

  it('deferred with no profile recorded is treated as full', async () => {
    const resident = new Set(namesOf(await surface(conversation({ _toolLoadingMode: 'deferred' }))));
    expect(resident.has('generate_widget')).toBe(true);
  });

  it('legacy transports: unchanged floor, no deferred catalog', async () => {
    const ctx = conversation({ _toolLoadingMode: 'legacy', _residentProfile: 'full' });
    const resident = new Set(namesOf(await surface(ctx)));
    expect(resident.has('generate_widget')).toBe(true);
    expect(ctx._deferredToolCatalog).toBeNull();
  });
});
