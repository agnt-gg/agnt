/**
 * Upgrading from the app (plans and the lifetime deal) and buying from the marketplace open the
 * agnt.gg checkout bridge when the API returns one, and Stripe otherwise: the two store actions
 * that start every in-app Stripe checkout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from 'vuex';

function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(String(k), String(v)), removeItem: (k) => map.delete(k), clear: () => map.clear() },
    configurable: true,
  });
}
ensureLocalStorage();

const post = vi.fn();
vi.mock('axios', () => ({ default: { get: vi.fn(), post: (...args) => post(...args) } }));

const { default: userAuth } = await import('./userAuth.js');
const { default: marketplace } = await import('../features/marketplace.js');

const STRIPE = 'https://checkout.stripe.com/c/pay/cs_live_a1B2c3D4e5F6g7H8i9J0#fidkdWxOYHwnPyd1blpx';
const BRIDGE = 'https://agnt.gg/api/checkout/go/c1.eyJ2IjoxfQ.AAAAAAAAAAAAAAAAAAAAAA';
let openExternalUrl;

beforeEach(() => {
  openExternalUrl = vi.fn();
  vi.stubGlobal('electron', { openExternalUrl });
  window.electron = { openExternalUrl };
  localStorage.setItem('token', 'token-1');
});
afterEach(() => {
  delete window.electron;
  vi.unstubAllGlobals();
  post.mockReset();
});

describe('in-app upgrade (userAuth.createSubscription)', () => {
  const upgrade = () => userAuth.actions.createSubscription({ commit: vi.fn(), state: { token: 'token-1' } }, { planType: 'personal', interval: 'monthly' });

  it('opens the agnt.gg bridge so the purchase joins the buyer’s website visit', async () => {
    post.mockResolvedValue({ data: { sessionId: 'cs_live_a1B2c3D4e5F6g7H8i9J0', url: STRIPE, bridgeUrl: BRIDGE } });
    await upgrade();
    expect(openExternalUrl).toHaveBeenCalledWith(BRIDGE);
  });

  it('opens Stripe directly when the server sends no bridge', async () => {
    post.mockResolvedValue({ data: { sessionId: 'cs_live_a1B2c3D4e5F6g7H8i9J0', url: STRIPE } });
    await upgrade();
    expect(openExternalUrl).toHaveBeenCalledWith(STRIPE);
  });
});

describe('marketplace purchase (marketplace.purchaseItem)', () => {
  const store = () => createStore({ modules: { marketplace: { ...marketplace, namespaced: true, state: JSON.parse(JSON.stringify(marketplace.state)) } } });
  const respond = (body) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));

  it('opens the agnt.gg bridge', async () => {
    respond({ sessionId: 'cs_live_a1B2c3D4e5F6g7H8i9J0', url: STRIPE, bridgeUrl: BRIDGE });
    await store().dispatch('marketplace/purchaseItem', { itemId: 'item-1' });
    expect(openExternalUrl).toHaveBeenCalledWith(BRIDGE);
  });

  it('opens Stripe directly when the bridge is missing or malformed', async () => {
    respond({ sessionId: 'cs_live_a1B2c3D4e5F6g7H8i9J0', url: STRIPE, bridgeUrl: 'https://evil.example/pay' });
    await store().dispatch('marketplace/purchaseItem', { itemId: 'item-1' });
    expect(openExternalUrl).toHaveBeenCalledWith(STRIPE);
  });
});
