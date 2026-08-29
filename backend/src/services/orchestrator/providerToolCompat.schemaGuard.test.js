/**
 * CONTRACT: a malformed tool schema costs you that tool, never the conversation.
 *
 * This is a regression test for a production outage. An MCP server — a
 * third-party process this repo neither writes nor reviews — advertised a tool
 * whose input-schema property key was outside Anthropic's permitted pattern.
 * Anthropic validates the WHOLE tools array and refuses the entire request:
 *
 *     400 tools.357.custom.input_schema.properties:
 *         Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'
 *
 * Every retry failed identically, the chat failed over to a second provider and
 * then a third, and the turn completed with zero tool calls. From the user's
 * side the assistant simply stopped working, and the only clue was an index
 * into an array that exists for one request.
 *
 * MCP servers are user-installed and arbitrary, so this input class is
 * permanent. Resilience to it has to be a property of the code, not a fix
 * applied once to whichever server happened to be at fault.
 */

import { describe, it, expect, vi } from 'vitest';
import { stripProviderIncompatibleTools } from './providerToolCompat.js';

const openAiShaped = (name, properties) => ({
  type: 'function',
  function: { name, description: 'x', parameters: { type: 'object', properties } },
});

const GOOD = openAiShaped('web_search', { query: { type: 'string' }, num: { type: 'number' } });

describe('a tool with an illegal property key is dropped, not sent', () => {
  // Every one of these is a real shape an MCP server can legitimately produce,
  // and every one of them 400s the entire request.
  const illegal = {
    'a space': openAiShaped('mcp__vendor__search', { 'search query': { type: 'string' } }),
    'a slash': openAiShaped('mcp__vendor__read', { 'path/to/file': { type: 'string' } }),
    'a colon': openAiShaped('mcp__vendor__ns', { 'ns:field': { type: 'string' } }),
    'a bracket': openAiShaped('mcp__vendor__idx', { 'items[0]': { type: 'string' } }),
    'non-ascii': openAiShaped('mcp__vendor__i18n', { 'consulta_año': { type: 'string' } }),
    'over 64 chars': openAiShaped('mcp__vendor__long', { ['x'.repeat(65)]: { type: 'string' } }),
    'an empty key': openAiShaped('mcp__vendor__blank', { '': { type: 'string' } }),
  };

  for (const [label, tool] of Object.entries(illegal)) {
    it(`drops a property key containing ${label}`, () => {
      const kept = stripProviderIncompatibleTools([GOOD, tool], 'anthropic');

      expect(kept).toHaveLength(1);
      expect(kept[0]).toBe(GOOD);
    });
  }

  it('names the tool AND the key in the log, because the provider will not', () => {
    // "tools.357" is unactionable. The name is what tells you which MCP server
    // to go and fix.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    stripProviderIncompatibleTools([GOOD, illegal['a space']], 'anthropic');

    const message = warn.mock.calls[0][0];
    expect(message).toContain('mcp__vendor__search');
    expect(message).toContain('search query');
    warn.mockRestore();
  });

  it('applies to claude-code as well as anthropic', () => {
    expect(stripProviderIncompatibleTools([GOOD, illegal['a space']], 'claude-code')).toHaveLength(1);
  });

  it('keeps the legacy name rule working alongside it', () => {
    const mcpClient = openAiShaped('mcp_client', { serverName: { type: 'string' } });
    const kept = stripProviderIncompatibleTools([GOOD, mcpClient], 'claude-code');
    expect(kept).toEqual([GOOD]);
  });
});

describe('it does not throw away tools that are fine', () => {
  it('leaves a clean list untouched, by reference', () => {
    const schemas = [GOOD, openAiShaped('mcp__notion__search', { query: { type: 'string' } })];
    // Same reference: the common path must not allocate.
    expect(stripProviderIncompatibleTools(schemas, 'anthropic')).toBe(schemas);
  });

  it('accepts every character the pattern actually permits', () => {
    const edge = openAiShaped('mcp__vendor__ok', {
      'dot.separated': { type: 'string' },
      'dash-separated': { type: 'string' },
      snake_case: { type: 'string' },
      MiXed123: { type: 'string' },
      [('y').repeat(64)]: { type: 'string' },
    });
    expect(stripProviderIncompatibleTools([edge], 'anthropic')).toHaveLength(1);
  });

  it('leaves providers that do not enforce the pattern alone', () => {
    // OpenAI accepts these. Dropping a working tool to satisfy a rule that
    // provider does not have would be its own bug.
    const schemas = [GOOD, openAiShaped('mcp__vendor__search', { 'search query': { type: 'string' } })];
    expect(stripProviderIncompatibleTools(schemas, 'openai')).toBe(schemas);
  });

  it('tolerates tools with no parameters at all', () => {
    const bare = { type: 'function', function: { name: 'ping' } };
    expect(stripProviderIncompatibleTools([bare], 'anthropic')).toHaveLength(1);
  });

  it('reads the native Anthropic shape too', () => {
    // So a future caller cannot bypass the check by passing input_schema.
    const native = { name: 'mcp__vendor__x', input_schema: { type: 'object', properties: { 'bad key': {} } } };
    expect(stripProviderIncompatibleTools([native], 'anthropic')).toHaveLength(0);
  });
});
