import { describe, it, expect } from 'vitest';
import { getProviderConfig } from '../ai/providerConfigs.js';
import { getAuthEntry, getCapabilities } from './AuthDispatcher.js';
import { ENV_KEY_MAP } from './envKeyMap.js';

describe('connector catalog (TypeSafe)', () => {
  it('is not an LLM providerConfigs row — AuthDispatcher still resolves it', () => {
    expect(getProviderConfig('typesafe'), 'must not enter the chat model picker').toBeFalsy();
    const entry = getAuthEntry('typesafe');
    expect(entry, 'typesafe must resolve so local /auth/connect works').toBeTruthy();
    expect(entry.local).toBe(false);
    // remote:true is what routes POST /:id/auth/connect to the branch that
    // encrypts the key into the local api_keys table. It does NOT proxy to
    // agnt.gg, which is the point: the remote has no such provider.
    expect(entry.remote).toBe(true);
    expect(entry.config.authScheme).toBe('api-key');
    expect(entry.config.name).toBe('TypeSafe AI');
  });

  it('capabilities expose connect-apikey, not a chat session', () => {
    const caps = getCapabilities('TYPESAFE');
    expect(caps.providerId).toBe('TYPESAFE');
    expect(caps.local).toBe(false);
    expect(caps.capabilities).toContain('connect-apikey');
  });

  it('resolves TYPESAFE_API_KEY from the environment like any other API-key provider', () => {
    expect(ENV_KEY_MAP.typesafe).toBe('TYPESAFE_API_KEY');
  });

  it('unknown ids still miss', () => {
    expect(getAuthEntry('not-a-real-connector')).toBeNull();
  });
});
