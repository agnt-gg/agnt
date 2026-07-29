import { describe, expect, it } from 'vitest';
import {
  capToolsToBudget,
  computeToolBudget,
  getToolCountLimit,
  CHAT_COMPLETIONS_TOOL_COUNT_LIMIT,
  DEFAULT_TOOLS,
} from './toolSelector.js';

/**
 * The tool surface is infrastructure; the conversation is the product.
 *
 * A 295-tool surface is ~120k real tokens — alone larger than the entire window
 * of a 128k model. Without a cap the context manager was forced into emergency
 * recovery and deleted the user's chat. The cap must fix that WITHOUT breaking
 * prompt caching, which keys on the longest common prefix of the serialized
 * request (and the tools array sits at the front of it).
 */

function makeTools(count) {
  const named = [...DEFAULT_TOOLS];
  return Array.from({ length: count }, (_, i) => ({
    type: 'function',
    function: {
      name: i < named.length ? named[i] : `bulk_tool_${i}`,
      description: `Tool ${i}. ${'Detailed description of behaviour and constraints. '.repeat(18)}`,
      parameters: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] },
    },
  }));
}

describe('capToolsToBudget', () => {
  it('is a strict no-op when the full surface fits', () => {
    const tools = makeTools(40);
    const r = capToolsToBudget(tools, { budgetTokens: 10_000_000 });
    expect(r.capped).toBe(false);
    // Identity, not a copy — large-window models must be completely unaffected.
    expect(r.schemas).toBe(tools);
    expect(r.pinnedNames).toBeNull();
  });

  it('caps to the budget and always keeps the discover_tools escape hatch', () => {
    const tools = makeTools(300);
    const budget = 8_000;
    const r = capToolsToBudget(tools, { budgetTokens: budget });

    expect(r.capped).toBe(true);
    expect(r.schemas.length).toBeLessThan(tools.length);
    expect(r.hiddenCount).toBeGreaterThan(0);
    const names = r.schemas.map((s) => s.function.name);
    expect(names).toContain('discover_tools');
  });

  it('produces a byte-identical array across turns when pinned', () => {
    const tools = makeTools(300);
    const budget = 8_000;

    let pinned = null;
    const serialized = [];
    for (let turn = 0; turn < 4; turn++) {
      const r = capToolsToBudget(tools, { budgetTokens: budget, pinnedNames: pinned });
      pinned = r.pinnedNames;
      serialized.push(JSON.stringify(r.schemas));
    }
    // Any drift here is a cache miss on EVERY subsequent request.
    expect(new Set(serialized).size).toBe(1);
  });

  it('appends discovered tools without disturbing the existing prefix', () => {
    const tools = makeTools(300);
    const budget = 8_000;

    const first = capToolsToBudget(tools, { budgetTokens: budget });
    const hidden = tools.map((t) => t.function.name).find((n) => !first.pinnedNames.includes(n));
    expect(hidden).toBeDefined();

    const second = capToolsToBudget(tools, {
      budgetTokens: budget,
      pinnedNames: [...first.pinnedNames, hidden],
      loadedToolNames: new Set([hidden]),
    });

    // The previously-sent names must remain an exact ordered prefix so the
    // cached tools block extends rather than being invalidated.
    expect(second.schemas.map((s) => s.function.name).slice(0, first.schemas.length))
      .toEqual(first.schemas.map((s) => s.function.name));
    expect(second.schemas.map((s) => s.function.name)).toContain(hidden);
  });
});

describe('capToolsToBudget — provider COUNT ceiling', () => {
  // Live 2026-07-26: openai/gpt-4o and groq/llama-3.3-70b both returned
  //   400 Invalid 'tools': array too long. Expected an array with maximum
  //       length 128, but got an array with length 158 instead.
  // The count limit is a hard TRANSPORT constraint, independent of tokens.
  const LIMIT = 128;

  it('never exceeds the provider tool-count limit', () => {
    const tools = makeTools(300);
    const r = capToolsToBudget(tools, { budgetTokens: 10_000_000, maxToolCount: LIMIT });
    expect(r.capped).toBe(true);
    expect(r.schemas.length).toBeLessThanOrEqual(LIMIT);
  });

  it('is still a no-op by identity when both axes fit', () => {
    const tools = makeTools(40);
    const r = capToolsToBudget(tools, { budgetTokens: 10_000_000, maxToolCount: LIMIT });
    expect(r.capped).toBe(false);
    expect(r.schemas).toBe(tools);
  });

  it('admits a discover_tools load even when the ceiling is already full', () => {
    // REGRESSION: the pin already held LIMIT names and was replayed with
    // force:true, so the freshly-loaded tool sat at index LIMIT and was
    // silently discarded. The request succeeded, the model got no error, and
    // the tool it had just asked for was simply absent — making discover_tools
    // a no-op exactly at the ceiling.
    const tools = makeTools(300);
    const first = capToolsToBudget(tools, { budgetTokens: 10_000_000, maxToolCount: LIMIT });
    expect(first.schemas.length).toBe(LIMIT);

    const names = first.pinnedNames;
    const wanted = tools.map((t) => t.function.name).find((n) => !names.includes(n));
    const second = capToolsToBudget(tools, {
      budgetTokens: 10_000_000,
      pinnedNames: [...names, wanted],
      loadedToolNames: new Set([wanted]),
      maxToolCount: LIMIT,
    });

    expect(second.schemas.map((s) => s.function.name)).toContain(wanted);
    expect(second.schemas.length).toBeLessThanOrEqual(LIMIT);
    expect(second.schemas.map((s) => s.function.name)).toContain('discover_tools');
  });

  it('keeps earlier loads across repeated discover_tools calls at the ceiling', () => {
    // The reserve is self-referential — a previously-loaded tool sitting at the
    // TAIL of the pin falls outside the shortened replay and consumes one of the
    // reserved slots. A single-pass reserve under-counts and drops the newest
    // load; the fixed-point solve is what makes this hold.
    const tools = makeTools(300);
    let result = capToolsToBudget(tools, { budgetTokens: 10_000_000, maxToolCount: LIMIT });
    const loaded = new Set();

    for (let round = 0; round < 3; round++) {
      const present = result.pinnedNames;
      const wanted = tools.map((t) => t.function.name).filter((n) => !present.includes(n)).slice(0, 2);
      wanted.forEach((n) => loaded.add(n));
      result = capToolsToBudget(tools, {
        budgetTokens: 10_000_000,
        pinnedNames: [...present, ...wanted],
        loadedToolNames: new Set(loaded),
        maxToolCount: LIMIT,
      });
      const got = result.schemas.map((s) => s.function.name);
      for (const n of loaded) expect(got).toContain(n);
      expect(result.schemas.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('stays byte-identical between turns when nothing new is loaded', () => {
    const tools = makeTools(300);
    const loaded = new Set();
    let pinned = null;
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const r = capToolsToBudget(tools, {
        budgetTokens: 10_000_000, pinnedNames: pinned,
        loadedToolNames: loaded, maxToolCount: LIMIT,
      });
      pinned = r.pinnedNames;
      seen.push(JSON.stringify(r.schemas));
    }
    // Any drift here is a full cache miss on every subsequent request.
    expect(new Set(seen).size).toBe(1);
  });
});

describe('getToolCountLimit', () => {
  it('caps Chat Completions transports and exempts the rest', () => {
    expect(getToolCountLimit('openai')).toBe(CHAT_COMPLETIONS_TOOL_COUNT_LIMIT);
    expect(getToolCountLimit('groq')).toBe(CHAT_COMPLETIONS_TOOL_COUNT_LIMIT);
    // Responses API accepted all 296 tools live in the same session.
    expect(getToolCountLimit('openai-codex', { usesResponsesApi: true })).toBeNull();
    // Anthropic / Gemini use their own tool schemas, no comparable cap.
    expect(getToolCountLimit('anthropic')).toBeNull();
    expect(getToolCountLimit('gemini')).toBeNull();
  });
});

describe('computeToolBudget', () => {
  it('always reserves conversation headroom', () => {
    // Reserve = max(32k floor, 15%). The 32k floor is one full-size tool result
    // under the default 100,000-char toolOutputCap.
    expect(computeToolBudget(400_000)).toBe(340_000); // 15% dominates
    expect(computeToolBudget(200_000)).toBe(168_000); // 32k floor dominates
    expect(computeToolBudget(90_000)).toBe(58_000);   // floor
    expect(computeToolBudget(20_000)).toBe(0);        // never negative
  });

  it('reserves at least one full-size tool result', () => {
    // AGNT's default toolOutputCap is 100,000 chars; the shared estimator
    // scores that at 100_000 / 3.5 * 1.12 = 32,000 tokens. A single tool round
    // must always be able to land in the conversation.
    // Math.floor, not ceil: (100_000 / 3.5) * 1.12 evaluates to 32000.0000000005
    // in IEEE-754, so ceil would assert 32,001 and fail by one phantom token.
    const ONE_TOOL_RESULT = Math.floor((100_000 / 3.5) * 1.12); // 32,000
    for (const available of [90_000, 128_000, 200_000, 400_000, 1_000_000]) {
      expect(available - computeToolBudget(available)).toBeGreaterThanOrEqual(ONE_TOOL_RESULT);
    }
  });

  it('also reserves the system prompt, which ships on every request', () => {
    // Live gpt-4o numbers: 112,800 available, 31,645-token system prompt.
    // Without this reservation the tool budget was 84,600, leaving 28,307 for
    // messages — less than the system prompt itself — so the context manager
    // fired emergency recovery and dropped the conversation regardless.
    const withoutSystem = computeToolBudget(112_800);
    const withSystem = computeToolBudget(112_800, { reservedTokens: 31_645 });
    expect(withSystem).toBe(withoutSystem - 31_645);

    const messageHeadroom = 112_800 - withSystem;
    expect(messageHeadroom).toBeGreaterThan(31_645);
  });
});

describe('getToolCountLimit', () => {
  it('caps OpenAI-compatible Chat Completions providers at 128 functions', () => {
    // Verified live 2026-07-26: both returned HTTP 400 "array too long".
    expect(getToolCountLimit('openai')).toBe(CHAT_COMPLETIONS_TOOL_COUNT_LIMIT);
    expect(getToolCountLimit('groq')).toBe(CHAT_COMPLETIONS_TOOL_COUNT_LIMIT);
    expect(getToolCountLimit('deepseek')).toBe(CHAT_COMPLETIONS_TOOL_COUNT_LIMIT);
  });

  it('exempts the Responses API, which accepted 296 tools in the same session', () => {
    expect(getToolCountLimit('openai-codex', { usesResponsesApi: true })).toBeNull();
    expect(getToolCountLimit('openai', { usesResponsesApi: true })).toBeNull();
  });

  it('exempts providers with their own tool schema', () => {
    expect(getToolCountLimit('anthropic')).toBeNull();
    expect(getToolCountLimit('gemini')).toBeNull();
    expect(getToolCountLimit('antigravity')).toBeNull();
  });
});

describe('capToolsToBudget — provider tool-count limit', () => {
  it('enforces the count limit even when the token budget is ample', () => {
    const tools = makeTools(300);
    const r = capToolsToBudget(tools, { budgetTokens: 10_000_000, maxToolCount: 128 });

    expect(r.capped).toBe(true);
    expect(r.schemas).toHaveLength(128);
    expect(r.hiddenCount).toBe(172);
    expect(r.schemas.map((s) => s.function.name)).toContain('discover_tools');
  });

  it('never exceeds the count limit even when the pin is longer', () => {
    const tools = makeTools(300);
    const oversizedPin = tools.map((t) => t.function.name); // all 300, force-added
    const r = capToolsToBudget(tools, { budgetTokens: 10_000_000, maxToolCount: 128, pinnedNames: oversizedPin });

    // A missing tool is recoverable via discover_tools; a 400 is not.
    expect(r.schemas.length).toBeLessThanOrEqual(128);
  });

  it('stays a no-op when both axes fit', () => {
    const tools = makeTools(40);
    const r = capToolsToBudget(tools, { budgetTokens: 10_000_000, maxToolCount: 128 });
    expect(r.capped).toBe(false);
    expect(r.schemas).toBe(tools);
  });
});

/**
 * Regression: a budget of ZERO is a real answer, not a missing one.
 *
 * Found by the full 111-model sweep. On windows small enough that the system
 * prompt plus the conversation reserve consume everything (kimi/moonshot-v1-32k
 * at 32,768 and chutes/Qwen3-32B-TEE at 40,960), computeToolBudget correctly
 * returned 0 — but capToolsToBudget's fast path treated `budgetTokens <= 0` as
 * "caller specified no budget" and skipped the token cap entirely. Those two
 * models shipped 128 tools / ~64,419 estimated tokens into windows of 32,768 and
 * 40,960 — 190% and 152% of the whole window — and still lost the conversation.
 * The sentinel for "unspecified" had collided with the legitimate value 0.
 */
describe('capToolsToBudget — zero budget means no room, not no limit', () => {
  it('caps to the force-added minimum when the budget is exactly 0', () => {
    const tools = makeTools(300);
    const r = capToolsToBudget(tools, { budgetTokens: 0 });

    expect(r.capped).toBe(true);
    // Only force-added tools survive: DEFAULT_TOOLS (which carry the
    // discover_tools escape hatch). Nothing from the registry fill.
    expect(r.schemas.length).toBeLessThanOrEqual(DEFAULT_TOOLS.size);
    expect(r.schemas.length).toBeGreaterThan(0);
    expect(r.schemas.map((s) => s.function.name)).toContain('discover_tools');
    expect(r.hiddenCount).toBeGreaterThan(200);
  });

  it('still treats a NON-FINITE budget as unspecified (no-op)', () => {
    const tools = makeTools(40);
    for (const budgetTokens of [undefined, null, NaN, Infinity]) {
      const r = capToolsToBudget(tools, { budgetTokens });
      expect(r.capped).toBe(false);
      expect(r.schemas).toBe(tools);
    }
  });

  it('honours the count ceiling even when the token budget is 0', () => {
    const tools = makeTools(300);
    const r = capToolsToBudget(tools, { budgetTokens: 0, maxToolCount: 5 });
    expect(r.schemas.length).toBeLessThanOrEqual(5);
    expect(r.schemas.map((s) => s.function.name)).toContain('discover_tools');
  });

  it('keeps discover_tools when there is room for exactly ONE tool', () => {
    // The recovery hatch is the single unrecoverable omission: every other
    // tool is merely deferred behind it. At maxToolCount 5 this could pass by
    // luck of DEFAULT_TOOLS ordering (it regressed exactly that way when five
    // read-only primitives were prepended to the set); at 1 it cannot.
    const tools = makeTools(300);
    const r = capToolsToBudget(tools, { budgetTokens: 0, maxToolCount: 1 });
    expect(r.schemas.map((s) => s.function.name)).toEqual(['discover_tools']);
  });
});

describe('computeToolBudget — tiny windows', () => {
  it('clamps the reserve to what the model actually has', () => {
    // 32k window: availableTokens ~23,281, system prompt ~9,285. The 32,000
    // reserve floor exceeds the entire budget, so the honest answer is 0 —
    // every available token is already spoken for.
    expect(computeToolBudget(23_281, { reservedTokens: 9_285 })).toBe(0);
    expect(computeToolBudget(23_281, { reservedTokens: 9_285 })).not.toBeLessThan(0);
  });

  it('leaves real room on a window that can afford tools', () => {
    expect(computeToolBudget(112_800, { reservedTokens: 9_285 })).toBeGreaterThan(60_000);
  });
});
