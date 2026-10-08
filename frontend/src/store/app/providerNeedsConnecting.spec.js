/**
 * One connected check for every provider picker. The copy in ModelSelector
 * lower-cased the store name instead of resolving it, so connected Cursor and
 * Z.AI accounts read as unconnected there.
 */
import { describe, it, expect } from 'vitest';
import { providerNeedsConnecting } from './aiProvider.js';

describe('providerNeedsConnecting', () => {
  it('resolves store names whose key differs from the lower-cased name', () => {
    expect(providerNeedsConnecting('Cursor', ['cursor-cli'])).toBe(false);
    expect(providerNeedsConnecting('Z.AI', ['zai'])).toBe(false);
    expect(providerNeedsConnecting('Claude-Code', ['claude-code'])).toBe(false);
  });

  it('asks to connect a provider that is not in the connected list', () => {
    expect(providerNeedsConnecting('OpenAI', ['anthropic'])).toBe(true);
    expect(providerNeedsConnecting('Gemini-CLI', [])).toBe(true);
  });

  it('matches connected ids case-insensitively', () => {
    expect(providerNeedsConnecting('OpenAI', ['OpenAI'])).toBe(false);
  });

  it('never asks to connect Local, which has no account', () => {
    expect(providerNeedsConnecting('Local', [])).toBe(false);
  });

  it('treats a missing connected list as nothing connected rather than throwing', () => {
    expect(providerNeedsConnecting('OpenAI', undefined)).toBe(true);
    expect(providerNeedsConnecting('', [])).toBe(false);
  });
});
