import { describe, it, expect } from 'vitest';
import aiProvider, { PROVIDER_FETCH_ACTIONS } from './aiProvider.js';

/**
 * PROVIDER_FETCH_ACTIONS is GENERATED from BUILT_IN_PROVIDERS, but the actions
 * it names are hand-written. When a provider is added without its wrapper,
 * dispatching the name is not an error — Vuex logs "unknown action type" and
 * returns undefined — so every caller (the picker's refresh button, Settings,
 * Onboarding) silently does nothing for that provider. Grok-Build, Cursor and
 * Antigravity were in exactly that state.
 */
describe('PROVIDER_FETCH_ACTIONS', () => {
  const entries = Object.entries(PROVIDER_FETCH_ACTIONS);

  it('is not vacuous', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries)('%s → %s is a real action', (_provider, fullName) => {
    const name = fullName.replace(/^aiProvider\//, '');
    expect(typeof aiProvider.actions[name]).toBe('function');
  });
});
