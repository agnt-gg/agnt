/**
 * Installed plugins work in the chat by default.
 *
 * Reported 2026-10-20: "when we install a plugin it should IMMEDIATELY be
 * available to the chat". A plugin lived behind discover_tools, and AGNT One
 * has no tool selector, so the only way to it was the model choosing to
 * discover it. The chat now carries the account's plugins itself: all of
 * them when they fit, otherwise the ones named in the message and the newest
 * first, and once one is in a conversation it stays.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({ buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT') }));
vi.mock('./workspaceContext.js', () => ({ loadWorkspaceContextSection: vi.fn(async () => '') }));
vi.mock('./pluginToolIndex.js', async (importOriginal) => ({ ...(await importOriginal()), getPluginToolIndex: vi.fn() }));

import { getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { getPluginToolIndex, choosePluginResidency, messageNamesPlugin, PLUGIN_RESIDENT_BUDGET_TOKENS } from './pluginToolIndex.js';
import { DEFAULT_TOOLS, TOOL_GROUPS } from './toolSelector.js';
import { estimateToolTokens } from '../../utils/contextManager.js';

// Realistic size (~200 tokens a tool), as in chatConfigs.autoMode.test.js:
// the rule is a cost rule, so toy schemas would fit any budget.
const FILLER = ('Performs the operation described by this tool. Accepts a target identifier and an options object, '
  + 'validates them against the current workspace state, and returns a structured result describing what changed. ').repeat(3);
const schema = (name) => ({
  type: 'function',
  function: { name, description: `${name}: ${FILLER}`, parameters: { type: 'object', properties: { target: { type: 'string', description: 'The identifier.' } }, required: ['target'] } },
});
const plugin = (name, displayName, toolNames, installedAt) => ({ name, displayName, category: `plugin:${name}`, toolNames, installedAt });
const range = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);

const ATLAS = plugin('atlas-cloud', 'Atlas Cloud', ['atlas_image', 'atlas_video', 'atlas_upload', 'atlas_chat'], '2026-10-01 10:00:00');
const GMAIL = plugin('gmail-plugin', 'Gmail', ['gmail_api'], '2026-09-01 10:00:00');
// ~8k tokens each: one fits the budget, two do not.
const BIG_NEW = plugin('big-new', 'Big New', range('bignew', 40), '2026-10-20 10:00:00');
const BIG_OLD = plugin('big-old', 'Big Old', range('bigold', 40), '2026-08-01 10:00:00');

function registryWith(...plugins) {
  const names = new Set([...DEFAULT_TOOLS]);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) names.add(n);
  for (const p of plugins) for (const n of p.toolNames) names.add(n);
  return [...names].map(schema);
}
const surface = async (ctx) => new Set((await getChatConfig('orchestrator').getToolSchemas(ctx)).map((s) => s.function.name));
const turn = (latestUserMessage, extra = {}) => ({ userId: 'user-1', latestUserMessage, enabledTools: null, ...extra });

beforeEach(() => {
  getAvailableToolSchemas.mockReset();
  getPluginToolIndex.mockReset();
});

describe('fixtures', () => {
  it('one big plugin fits the budget, two do not (anti-vacuity)', () => {
    const cost = (p) => estimateToolTokens(p.toolNames.map(schema));
    expect(cost(BIG_NEW)).toBeLessThan(PLUGIN_RESIDENT_BUDGET_TOKENS);
    expect(cost(BIG_NEW) + cost(BIG_OLD)).toBeGreaterThan(PLUGIN_RESIDENT_BUDGET_TOKENS);
  });
});

describe('installed plugins in the chat', () => {
  it('a few installed plugins are all there, on a message that names none of them', async () => {
    getAvailableToolSchemas.mockResolvedValue(registryWith(ATLAS, GMAIL));
    getPluginToolIndex.mockResolvedValue([ATLAS, GMAIL]);
    const names = await surface(turn('hello there'));
    for (const tool of [...ATLAS.toolNames, ...GMAIL.toolNames]) expect(names.has(tool), tool).toBe(true);
  });

  it('when they do not all fit, the newest install is there and an older one waits', async () => {
    getAvailableToolSchemas.mockResolvedValue(registryWith(BIG_NEW, BIG_OLD));
    getPluginToolIndex.mockResolvedValue([BIG_NEW, BIG_OLD]);
    const names = await surface(turn('hello there'));
    expect(names.has('bignew_0')).toBe(true);
    expect(names.has('bigold_0')).toBe(false);
  });

  it('a plugin named in the message is there whatever the budget', async () => {
    getAvailableToolSchemas.mockResolvedValue(registryWith(BIG_NEW, BIG_OLD, ATLAS));
    getPluginToolIndex.mockResolvedValue([BIG_NEW, BIG_OLD, ATLAS]);
    const names = await surface(turn('Use Big Old to tidy the files'));
    expect(names.has('bigold_0')).toBe(true);
  });

  it('once in a conversation, a plugin stays when a newer install would have pushed it out', async () => {
    getAvailableToolSchemas.mockResolvedValue(registryWith(BIG_OLD));
    getPluginToolIndex.mockResolvedValue([BIG_OLD]);
    const ctx = turn('hello there');
    expect((await surface(ctx)).has('bigold_0')).toBe(true);
    // A newer big plugin is installed mid-conversation.
    getAvailableToolSchemas.mockResolvedValue(registryWith(BIG_NEW, BIG_OLD));
    getPluginToolIndex.mockResolvedValue([BIG_NEW, BIG_OLD]);
    ctx.latestUserMessage = 'and now?';
    expect((await surface(ctx)).has('bigold_0')).toBe(true);
  });

  it('asks for THIS user\u2019s plugins', async () => {
    getAvailableToolSchemas.mockResolvedValue(registryWith(ATLAS));
    getPluginToolIndex.mockResolvedValue([ATLAS]);
    await surface(turn('hello there'));
    expect(getPluginToolIndex).toHaveBeenCalledWith('user-1');
    expect(getAvailableToolSchemas).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('a channel ceiling still wins: an unpermitted plugin tool is never resident', async () => {
    const registry = registryWith(ATLAS, BIG_OLD);
    getAvailableToolSchemas.mockResolvedValue(registry);
    getPluginToolIndex.mockResolvedValue([ATLAS, BIG_OLD]);
    // Expensive enough to take the gated path (not the verbatim whitelist),
    // and it permits Big Old but not Atlas.
    const permitted = registry.map((s) => s.function.name).filter((n) => !n.startsWith('atlas_'));
    const names = await surface(turn('Use Atlas Cloud please', { enabledTools: new Set(permitted) }));
    expect(names.has('atlas_image')).toBe(false);
    expect(names.has('bigold_0')).toBe(true);
  });
});

describe('choosePluginResidency (pure)', () => {
  const byName = (...plugins) => new Map(plugins.flatMap((p) => p.toolNames.map((n) => [n, schema(n)])));

  it('fills by recency and keeps going past a plugin that does not fit', () => {
    const SMALL_OLD = plugin('small-old', 'Small Old', ['small_0'], '2026-01-01 00:00:00');
    const chosen = choosePluginResidency({ index: [BIG_NEW, BIG_OLD, SMALL_OLD], schemasByName: byName(BIG_NEW, BIG_OLD, SMALL_OLD) });
    expect(chosen.map((p) => p.name)).toEqual(['big-new', 'small-old']);
  });

  it('skips a plugin whose tools are not in the registry', () => {
    expect(choosePluginResidency({ index: [ATLAS], schemasByName: new Map() })).toEqual([]);
  });
});

describe('messageNamesPlugin', () => {
  it.each([
    ['Use Atlas Cloud to do something', ATLAS, true],
    ['try atlas-cloud', ATLAS, true],
    ['atlascloud image please', ATLAS, true],
    ['check my gmail', GMAIL, true],
    ['an atlas of the world', ATLAS, false],
    ['the cloud is down', ATLAS, false],
  ])('%j names %s: %s', (message, p, expected) => {
    expect(messageNamesPlugin(message, p)).toBe(expected);
  });

  it('never matches a name shorter than three letters', () => {
    expect(messageNamesPlugin('use AI for this', plugin('ai-plugin', 'AI', ['ai_x'], ''))).toBe(false);
  });
});
