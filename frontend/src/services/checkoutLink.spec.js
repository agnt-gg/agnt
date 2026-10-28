/**
 * A purchase started in the app opens the agnt.gg checkout bridge, so the payment joins the buyer's
 * website visit (api.agnt.gg services/checkoutAttribution.js). Anything else falls back to Stripe:
 * attribution must never stand between a buyer and checkout.
 */
import { describe, it, expect, vi } from 'vitest';
import { checkoutUrl, openCheckout } from './checkoutLink.js';

const STRIPE = 'https://checkout.stripe.com/c/pay/cs_live_a1B2c3D4e5F6g7H8i9J0#fidkdWxOYHwnPyd1blpx';
const BRIDGE = 'https://agnt.gg/api/checkout/go/c1.eyJ2IjoxfQ.AAAAAAAAAAAAAAAAAAAAAA';

describe('checkoutUrl', () => {
  it('prefers the signed agnt.gg bridge the server returned', () => {
    expect(checkoutUrl({ url: STRIPE, bridgeUrl: BRIDGE })).toBe(BRIDGE);
  });

  it('falls back to Stripe for an older server, or a bridge that is not a well-formed https bridge link', () => {
    for (const bridgeUrl of [undefined, null, '', 'not a url', 'http://agnt.gg/api/checkout/go/c1.x.y', 'https://agnt.gg/somewhere/else',
      'https://user:pw@agnt.gg/api/checkout/go/c1.x.y', 'javascript:alert(1)', 42, { href: BRIDGE }]) {
      expect(checkoutUrl({ url: STRIPE, bridgeUrl })).toBe(STRIPE);
    }
  });

  it('is null when there is nothing to open', () => {
    expect(checkoutUrl({})).toBeNull();
    expect(checkoutUrl(null)).toBeNull();
    expect(checkoutUrl({ url: '' })).toBeNull();
  });
});

describe('openCheckout', () => {
  it('opens the bridge in the real browser on desktop', () => {
    const openExternalUrl = vi.fn();
    expect(openCheckout({ url: STRIPE, bridgeUrl: BRIDGE }, { electron: { openExternalUrl }, open: vi.fn() })).toBe(BRIDGE);
    expect(openExternalUrl).toHaveBeenCalledWith(BRIDGE);
  });

  it('opens a new tab on the web and cloud instances', () => {
    const open = vi.fn();
    openCheckout({ url: STRIPE, bridgeUrl: BRIDGE }, { open });
    expect(open).toHaveBeenCalledWith(BRIDGE, '_blank');
  });

  it('opens nothing when the server returned no URL', () => {
    const open = vi.fn();
    expect(openCheckout({ error: 'nope' }, { open })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
