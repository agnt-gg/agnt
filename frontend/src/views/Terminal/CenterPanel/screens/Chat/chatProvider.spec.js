import { describe, it, expect } from 'vitest';
import { providerUsable, chatHasModel, shouldSwitchToFlash } from './chatProvider.js';

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

describe('switching to AGNT Flash', () => {
  it('switches when the chosen provider is known not to work, or none is chosen', () => {
    expect(shouldSwitchToFlash({ ...base, provider: 'OpenAI' })).toBe(true);
    expect(shouldSwitchToFlash({ ...base, provider: null })).toBe(true);
  });

  it('never throws away a choice before connections have loaded', () => {
    expect(shouldSwitchToFlash({ ...base, provider: 'OpenAI', connectionsSettled: false })).toBe(false);
  });

  it('leaves a working choice, Flash itself, Local, and signed-out installs alone', () => {
    expect(shouldSwitchToFlash({ ...base, provider: 'OpenAI', connectedApps: ['openai'] })).toBe(false);
    expect(shouldSwitchToFlash({ ...base, provider: 'AGNT' })).toBe(false);
    expect(shouldSwitchToFlash({ ...base, provider: 'Local' })).toBe(false);
    expect(shouldSwitchToFlash({ ...base, authenticated: false, provider: 'OpenAI' })).toBe(false);
  });
});
