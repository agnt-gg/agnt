/**
 * Which URL to open for a Stripe checkout the AGNT API created.
 *
 * Checkout responses carry the Stripe URL and, from api.agnt.gg 27ebdc7 on, a
 * signed agnt.gg "bridge" link that wraps it (api.agnt.gg
 * services/checkoutAttribution.js). Opened in the buyer's own browser, the
 * bridge records which website visitor opened the checkout, then redirects to
 * Stripe. That is the only way a purchase made from the app can be traced to
 * the website visit that brought the buyer in: the app itself never sees the
 * agnt.gg visitor cookie.
 *
 * Older servers return no bridge, and anything that is not a well-formed https
 * bridge link falls back to the Stripe URL: attribution must never stand
 * between a buyer and checkout.
 */
const BRIDGE_PATH = '/api/checkout/go/';

export function checkoutUrl(data) {
  const bridge = typeof data?.bridgeUrl === 'string' ? data.bridgeUrl : '';
  if (bridge) {
    try {
      const url = new URL(bridge);
      if (url.protocol === 'https:' && url.pathname.startsWith(BRIDGE_PATH) && !url.username && !url.password) return bridge;
    } catch {
      /* not a URL: fall back to Stripe */
    }
  }
  return typeof data?.url === 'string' && data.url ? data.url : null;
}

/** Open a checkout in the user's real browser (Electron) or a new tab (web and cloud instances). */
export function openCheckout(data, win = window) {
  const url = checkoutUrl(data);
  if (!url) return null;
  if (win.electron?.openExternalUrl) win.electron.openExternalUrl(url);
  else win.open(url, '_blank');
  return url;
}
