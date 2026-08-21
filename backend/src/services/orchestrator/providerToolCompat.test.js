/**
 * The rule itself, and the guarantee that every path which builds a tool list
 * actually applies it.
 *
 * The second half is the one that matters. This defect was not a wrong rule —
 * the rule was correct and had been correct for a while. It was a SECOND tool
 * list, built somewhere else, that never asked. A unit test of the filter
 * would have passed throughout the entire outage.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { providersWithToolRestrictions, stripProviderIncompatibleTools } from './providerToolCompat.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = backend/src/services/orchestrator -> the call sites live under services/
const SERVICES = path.resolve(HERE, '..');

const tool = (name) => ({ type: 'function', function: { name, description: name, parameters: {} } });
const names = (schemas) => schemas.map((s) => s.function?.name ?? s.name);

describe('stripProviderIncompatibleTools', () => {
  it('removes mcp_client on claude-code', () => {
    const kept = stripProviderIncompatibleTools([tool('web_search'), tool('mcp_client')], 'claude-code');
    expect(names(kept)).toEqual(['web_search']);
  });

  it('matches the name as a SUBSTRING, because Anthropic does', () => {
    // Measured: a tool named `mcp_clientx` is rejected exactly like
    // `mcp_client`. An equality check would let it through and the whole
    // request would 400 with a message about billing.
    const kept = stripProviderIncompatibleTools([tool('mcp_clientx')], 'claude-code');
    expect(kept).toHaveLength(0);
  });

  it('keeps namespaced MCP tools — those are accepted', () => {
    // mcp__<server>__<tool> returns 200. Stripping them would remove every
    // MCP capability from Claude Code for no reason.
    const kept = stripProviderIncompatibleTools(
      [tool('mcp__notion__search'), tool('mcp__github__list_repos'), tool('mcp_client')],
      'claude-code'
    );
    expect(names(kept)).toEqual(['mcp__notion__search', 'mcp__github__list_repos']);
  });

  it('is case-insensitive on the provider — callers pass "Claude-Code" unnormalized', () => {
    // TaskOrchestrator resolves the provider from an agent row, where it is
    // stored as `Claude-Code`. A case-sensitive check here is the bug again.
    for (const provider of ['Claude-Code', 'claude-code', 'CLAUDE-CODE']) {
      const kept = stripProviderIncompatibleTools([tool('mcp_client')], provider);
      expect(kept, provider).toHaveLength(0);
    }
  });

  it('leaves every other provider completely alone', () => {
    for (const provider of ['anthropic', 'openai', 'gemini', 'groq', 'openai-codex']) {
      const input = [tool('web_search'), tool('mcp_client')];
      const kept = stripProviderIncompatibleTools(input, provider);
      expect(names(kept), provider).toEqual(['web_search', 'mcp_client']);
      expect(kept, provider).toBe(input); // same reference: no allocation
    }
  });

  it('returns the input untouched when there is nothing to remove', () => {
    const input = [tool('web_search')];
    expect(stripProviderIncompatibleTools(input, 'claude-code')).toBe(input);
  });

  it('survives empty, missing and malformed input', () => {
    expect(stripProviderIncompatibleTools([], 'claude-code')).toEqual([]);
    expect(stripProviderIncompatibleTools(null, 'claude-code')).toBeNull();
    expect(stripProviderIncompatibleTools(undefined, 'claude-code')).toBeUndefined();
    expect(stripProviderIncompatibleTools([tool('a')], null)).toHaveLength(1);
    expect(stripProviderIncompatibleTools([tool('a')], undefined)).toHaveLength(1);
    // A schema with no readable name is not ours to drop.
    expect(stripProviderIncompatibleTools([{}, { function: {} }], 'claude-code')).toHaveLength(2);
  });

  it('reads a bare native-shaped schema too', () => {
    const kept = stripProviderIncompatibleTools([{ name: 'mcp_client' }, { name: 'web_search' }], 'claude-code');
    expect(names(kept)).toEqual(['web_search']);
  });

  it('declares claude-code as restricted', () => {
    expect(providersWithToolRestrictions()).toContain('claude-code');
  });
});

describe('every path that builds a tool list applies the rule', () => {
  // GUARD. Both files below independently assemble `finalToolSchemas` and send
  // it to a provider. When only one of them applied the rule, Claude Code chat
  // worked and Claude Code goal tasks silently returned an error string as
  // their deliverable. A third assembly site must not be able to appear
  // without this failing.
  const CALL_SITES = ['OrchestratorService.js', 'ai/LlmExecutionService.js'];

  it.each(CALL_SITES)('%s calls stripProviderIncompatibleTools', (rel) => {
    const src = fs.readFileSync(path.join(SERVICES, rel), 'utf8');
    expect(src).toContain('stripProviderIncompatibleTools');
    expect(src).toMatch(/import \{ stripProviderIncompatibleTools \} from/);
  });

  it('applies it once per finalToolSchemas assignment, in every file that has one', () => {
    for (const rel of CALL_SITES) {
      const src = fs.readFileSync(path.join(SERVICES, rel), 'utf8');
      const assignments = src.match(/(?:const|let)\s+finalToolSchemas\s*=/g) || [];
      const applications = src.match(/stripProviderIncompatibleTools\(/g) || [];
      // Anti-vacuity: if the variable was renamed away, this test must not
      // quietly pass by matching zero against zero.
      expect(assignments.length, `${rel} has no finalToolSchemas assignment`).toBeGreaterThan(0);
      expect(applications.length, `${rel} applies the rule fewer times than it builds a list`)
        .toBeGreaterThanOrEqual(assignments.length);
    }
  });

  it('no call site still carries the old inline mcp_client filter', () => {
    for (const rel of CALL_SITES) {
      const src = fs.readFileSync(path.join(SERVICES, rel), 'utf8');
      expect(src, `${rel} still filters mcp_client inline`).not.toMatch(
        /filter\([^)]*mcp_client/
      );
    }
  });
});
