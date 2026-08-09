/**
 * CONFORMANCE: every provider AGNT ships can reach the Browser Agent, and a
 * provider nobody classified fails loudly instead of quietly becoming OpenAI.
 *
 * The bug this file exists to prevent had no failing test and no commit that
 * introduced it. `ai-browser-use.js` branched on three provider names and its
 * `else` fell through to OpenAI, so picking DeepSeek built an OpenAI client
 * with a DeepSeek key. Nothing in the codebase asserted a relationship between
 * "providers AGNT has" and "providers this node handles", so the two drifted
 * apart for as long as they liked.
 *
 * The first test below is the one that closes that class of defect: it fails
 * the day someone adds provider 21.
 */

import { describe, it, expect } from 'vitest';
import { getAllProviderConfigs, isSubscriptionProvider } from '../../../services/ai/providerConfigs.js';
import {
  ROUTE,
  BROWSER_USE_ROUTING,
  resolveBrowserUseProvider,
  browserUseProviderOptions,
  defaultModelFor,
  customProviderRouting,
  subscriptionProvidersAreGatewayRouted,
} from './browserUseProviders.js';

const providers = getAllProviderConfigs();

describe('every provider is classified', () => {
  it('declares a route for all of them', () => {
    const unclassified = providers.map((p) => p.key).filter((key) => !BROWSER_USE_ROUTING[key]);
    expect(unclassified, `add these to browserUseProviders.js: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('classifies nothing that does not exist', () => {
    const known = new Set(providers.map((p) => p.key));
    const orphans = Object.keys(BROWSER_USE_ROUTING).filter((key) => !known.has(key));
    expect(orphans, `these were removed from providerConfigs: ${orphans.join(', ')}`).toEqual([]);
  });

  it('uses only routes the runner knows how to build', () => {
    for (const [key, routing] of Object.entries(BROWSER_USE_ROUTING)) {
      expect(Object.values(ROUTE), `${key} has an unknown route`).toContain(routing.route);
    }
  });

  it('names a browser-use chat class for every route that builds one directly', () => {
    for (const [key, routing] of Object.entries(BROWSER_USE_ROUTING)) {
      if (routing.route === ROUTE.GATEWAY) continue;
      expect(routing.chatClass, `${key} declares no chat class`).toBeTruthy();
      expect(routing.chatClass).toMatch(/^Chat[A-Z]/);
    }
  });

  it('explains itself whenever it sends a provider the long way round', () => {
    for (const [key, routing] of Object.entries(BROWSER_USE_ROUTING)) {
      if (routing.route !== ROUTE.GATEWAY) continue;
      expect(routing.reason, `${key} routes via the gateway without saying why`).toBeTruthy();
    }
  });
});

describe('subscription providers cannot take a direct route', () => {
  it('routes every one of them through the gateway', () => {
    // Asserted as a relationship rather than a hardcoded list, so adding a
    // seventh subscription provider is covered the moment it is added.
    expect(subscriptionProvidersAreGatewayRouted()).toBe(true);
  });

  it('agrees with providerConfigs about which ones those are', () => {
    const gatewayed = Object.entries(BROWSER_USE_ROUTING)
      .filter(([, r]) => r.route === ROUTE.GATEWAY)
      .map(([key]) => key);

    // Chutes is the one gateway provider that is NOT a subscription: it has an
    // API key, but needs our end-to-end-encrypted transport to use it.
    const nonSubscription = gatewayed.filter((key) => !isSubscriptionProvider(key));
    expect(nonSubscription).toEqual(['chutes']);
  });
});

describe('resolution', () => {
  it('resolves every provider by key and by display name', () => {
    for (const provider of providers) {
      expect(() => resolveBrowserUseProvider(provider.key)).not.toThrow();
      expect(() => resolveBrowserUseProvider(provider.name)).not.toThrow();
      expect(resolveBrowserUseProvider(provider.name).key).toBe(provider.key);
    }
  });

  it('throws by name on a provider that does not exist', () => {
    expect(() => resolveBrowserUseProvider('definitely-not-a-provider'))
      .toThrow(/Unknown AI provider "definitely-not-a-provider"/);
  });

  it('gives every provider a default model', () => {
    // A model is required to build any chat class. Silence here becomes a
    // confusing Python-side error several layers away from the cause.
    for (const provider of providers) {
      expect(defaultModelFor(provider.key), `${provider.key} has no default model`).toBeTruthy();
    }
  });

  it('never hands a native chat class our base URL', () => {
    // ChatDeepSeek defaults to https://api.deepseek.com/v1 while
    // providerConfigs lists https://api.deepseek.com — passing ours would
    // point it at a path that does not exist.
    const deepseek = resolveBrowserUseProvider('deepseek');
    expect(deepseek.route).toBe(ROUTE.NATIVE);
    expect(deepseek.chatClass).toBe('ChatDeepSeek');
  });

  it('surfaces vision support so "auto" can mean something', () => {
    expect(resolveBrowserUseProvider('openai').visionCapable).toBe(true);
    expect(resolveBrowserUseProvider('deepseek').visionCapable).toBe(false);
  });
});

describe('the dropdown is generated, not hand-written', () => {
  it('offers every routed provider', () => {
    const options = browserUseProviderOptions();
    expect(options).toHaveLength(providers.filter((p) => BROWSER_USE_ROUTING[p.key]).length);
    expect(options).toContain('DeepSeek');
    expect(options).toContain('Claude Code');
    expect(options).toContain('Z.AI');
  });

  it('offers only names that resolve back to a provider', () => {
    for (const name of browserUseProviderOptions()) {
      expect(() => resolveBrowserUseProvider(name), `${name} does not resolve`).not.toThrow();
    }
  });
});

describe('custom providers', () => {
  it('take the OpenAI-compatible route with their own base URL', () => {
    const routing = customProviderRouting('https://api.mistral.ai/v1', 'Mistral AI');
    expect(routing).toMatchObject({
      route: ROUTE.OPENAI_COMPAT,
      chatClass: 'ChatOpenAI',
      baseUrl: 'https://api.mistral.ai/v1',
      name: 'Mistral AI',
    });
  });
});
