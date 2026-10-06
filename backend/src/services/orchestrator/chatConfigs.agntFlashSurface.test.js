// AGNT Flash starts from keyword-matched tool groups, not every static group.
//
// Measured 2026-10-06 on a brand-new account: a one-line first message to AGNT
// Flash sent 27,847 fresh input tokens, ~19k of them definitions for ~105 tools
// it never used, billed at the full fresh-input rate. Other providers keep the
// resident-from-turn-1 surface (their cache economics are different).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({ buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT') }));
vi.mock('./workspaceContext.js', () => ({ loadWorkspaceContextSection: vi.fn(async () => '') }));

import { getChatConfig, isKeywordResidentProvider } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { DEFAULT_TOOLS, TOOL_GROUPS, GROUP_TRIGGERS } from './toolSelector.js';
import { ORCHESTRATOR_RESIDENT_GROUPS } from './system-prompts/promptElements.js';
import { estimateToolTokens } from '../../utils/contextManager.js';

// Realistically sized schemas (~200 tokens each), as in chatConfigs.autoMode.test.js.
const FILLER = ('Performs the operation described by this tool. Accepts a target identifier and an options object, '
  + 'validates them against the current workspace state, and returns a structured result describing what changed. ').repeat(3);
const schema = (name) => ({ type: 'function', function: { name, description: `${name}: ${FILLER}`, parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } } });
function buildRegistry() {
  const names = new Set([...DEFAULT_TOOLS]);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) names.add(n);
  for (let i = 0; i < 40; i++) names.add(`plugin_tool_${i}`);
  return [...names].map(schema);
}
const namesOf = (schemas) => schemas.map((s) => s.function?.name);
const surface = (ctx) => getChatConfig('orchestrator').getToolSchemas(ctx);
const NEUTRAL = 'Prep me for a job interview with likely questions and strong answers.';
const MEDIA = 'please generate an image of a sunset';

let registry;
beforeEach(() => {
  registry = buildRegistry();
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockResolvedValue(registry);
});

describe('AGNT Flash first-turn tool surface', () => {
  it('fixture: the neutral message matches no group, the media one does', () => {
    expect(Object.values(GROUP_TRIGGERS).every((p) => !p || !p.test(NEUTRAL))).toBe(true);
    expect(GROUP_TRIGGERS.media.test(MEDIA)).toBe(true);
    expect(ORCHESTRATOR_RESIDENT_GROUPS.length).toBeGreaterThan(3);
  });

  it('only AGNT Flash is keyword-resident', () => {
    expect(isKeywordResidentProvider('agnt')).toBe(true);
    expect(isKeywordResidentProvider('AGNT')).toBe(true);
    for (const p of ['anthropic', 'openai', 'openai-codex', 'openrouter', 'claude-code', '', undefined]) expect(isKeywordResidentProvider(p)).toBe(false);
  });

  it('sends far fewer tool tokens than the resident surface, and keeps discovery', async () => {
    const flash = await surface({ latestUserMessage: NEUTRAL, enabledTools: null, normalizedProvider: 'agnt' });
    const other = await surface({ latestUserMessage: NEUTRAL, enabledTools: null, normalizedProvider: 'anthropic' });
    const flashTokens = estimateToolTokens(flash), otherTokens = estimateToolTokens(other);
    expect(flashTokens).toBeLessThan(otherTokens * 0.6);
    const names = new Set(namesOf(flash));
    expect(names.has('discover_tools')).toBe(true);
    for (const n of DEFAULT_TOOLS) if (registry.some((s) => s.function.name === n)) expect(names.has(n), n).toBe(true);
  });

  it('a keyword still loads its group, and a loaded group stays on later turns (cache-stable)', async () => {
    const ctx = { latestUserMessage: MEDIA, enabledTools: null, normalizedProvider: 'agnt' };
    const first = new Set(namesOf(await surface(ctx)));
    const mediaTools = TOOL_GROUPS.media.filter((n) => registry.some((s) => s.function.name === n));
    for (const n of mediaTools) expect(first.has(n), n).toBe(true);
    ctx.latestUserMessage = NEUTRAL;
    const second = new Set(namesOf(await surface(ctx)));
    for (const n of first) expect(second.has(n), 'still resident: ' + n).toBe(true);
  });

  it('other providers keep every static group resident from turn 1', async () => {
    const other = new Set(namesOf(await surface({ latestUserMessage: NEUTRAL, enabledTools: null, normalizedProvider: 'anthropic' })));
    for (const group of ORCHESTRATOR_RESIDENT_GROUPS) {
      for (const n of (TOOL_GROUPS[group] || []).filter((t) => registry.some((s) => s.function.name === t))) expect(other.has(n), `${group}:${n}`).toBe(true);
    }
  });
});
