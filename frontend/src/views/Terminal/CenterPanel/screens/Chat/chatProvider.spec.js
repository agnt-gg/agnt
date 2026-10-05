import { describe, it, expect } from 'vitest';
import * as chatProvider from './chatProvider.js';

const { providerUsable, chatHasModel } = chatProvider;

const base = { authenticated: true, connectedApps: [], customProviders: [], localRunning: false, connectionsSettled: true };

describe('the chat always has AGNT Flash when signed in', () => {
  // Reported: the connect card showed on a signed-in account whose chosen
  // provider was not connected, though Flash was available.
  it('a signed-in account has a model whatever provider is chosen', () => {
    for (const provider of [null, '', 'OpenAI', 'Anthropic', 'Local', 'AGNT']) {
      expect(chatHasModel({ ...base, provider }), String(provider)).toBe(true);
    }
  });

  it('only a signed-out install with nothing usable needs the connect card', () => {
    expect(chatHasModel({ ...base, authenticated: false, provider: 'OpenAI' })).toBe(false);
    expect(chatHasModel({ ...base, authenticated: false, provider: null })).toBe(false);
    expect(chatHasModel({ ...base, authenticated: false, provider: 'OpenAI', connectedApps: ['openai'] })).toBe(true);
  });
});

describe('which provider can answer', () => {
  it('reads each kind of provider', () => {
    expect(providerUsable({ ...base, provider: 'AGNT' })).toBe(true);
    expect(providerUsable({ ...base, provider: 'agnt', authenticated: false })).toBe(false);
    expect(providerUsable({ ...base, provider: 'Local', localRunning: true })).toBe(true);
    expect(providerUsable({ ...base, provider: 'Local' })).toBe(false);
    expect(providerUsable({ ...base, provider: 'my-llm', customProviders: [{ id: 'my-llm' }] })).toBe(true);
    expect(providerUsable({ ...base, provider: 'Z-AI', connectedApps: ['ZAI'], resolveKey: () => 'zai' })).toBe(true);
    expect(providerUsable({ ...base, provider: 'OpenAI' })).toBe(false);
  });
});

describe('the chat never decides the global default', () => {
  // Reported: an automatic "provider looks disconnected" switch saved AGNT
  // Flash over a working Claude-Code default on every restart.
  it('offers no automatic provider switch', () => {
    expect(chatProvider.shouldSwitchToFlash).toBeUndefined();
  });
});
