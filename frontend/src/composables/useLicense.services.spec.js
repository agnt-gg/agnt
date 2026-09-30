// The Emails and Webhooks pages unlock on useLicense().hasMail and
// .hasHostedWebhooks. Those read the `services` map through the real
// userAuth getter, which treated the map as an { enabled } toggle and returned
// false, so both pages stayed locked on an active enterprise plan. This runs
// the composable over the real getters so the whole path is covered.
import { describe, it, expect, vi } from 'vitest';

let getters;
vi.mock('vuex', () => ({ useStore: () => ({ getters }) }));

import userAuth from '@/store/auth/userAuth.js';
import { useLicense } from './useLicense.js';

const SERVICES = { models: true, search: true, scrape: true, sandbox: true, mail: true, hostedWebhooks: true };

/** Wire the real userAuth getters over a given state, the way Vuex would. */
function storeFor(state, hasValidLicense) {
  const local = { hasValidLicense };
  local.getLicenseFeature = userAuth.getters.getLicenseFeature(state, local);
  return {
    'userAuth/isPremium': userAuth.getters.isPremium(state),
    'userAuth/getLicenseFeature': local.getLicenseFeature,
    'userAuth/isAuthenticated': true,
  };
}

const license = (services) => ({
  license: { userId: 'u1', planType: 'enterprise', features: { apiAccess: { enabled: true, tier: 'enterprise' }, services } },
  signature: 's',
});

describe('useLicense hosted services', () => {
  it('unlocks Mail and Webhooks on a verified paid license', () => {
    getters = storeFor({ planType: 'enterprise', signedLicense: license(SERVICES), subscription: null }, true);
    const { hasMail, hasHostedWebhooks, hasApiAccess } = useLicense();
    expect(hasMail.value).toBe(true);
    expect(hasHostedWebhooks.value).toBe(true);
    expect(hasApiAccess.value).toBe(true);
  });

  it('unlocks them from the subscription when the license is unavailable', () => {
    getters = storeFor({ planType: 'enterprise', signedLicense: null, subscription: { planType: 'enterprise', features: { services: SERVICES } } }, false);
    const { hasMail, hasHostedWebhooks } = useLicense();
    expect(hasMail.value).toBe(true);
    expect(hasHostedWebhooks.value).toBe(true);
  });

  it('keeps a service the license disables locked', () => {
    getters = storeFor({ planType: 'enterprise', signedLicense: license({ ...SERVICES, hostedWebhooks: false }), subscription: null }, true);
    const { hasMail, hasHostedWebhooks } = useLicense();
    expect(hasMail.value).toBe(true);
    expect(hasHostedWebhooks.value).toBe(false);
  });

  it('keeps everything locked on the free plan', () => {
    getters = storeFor({ planType: 'free', signedLicense: null, subscription: { planType: 'free', features: { services: SERVICES } } }, false);
    const { hasMail, hasHostedWebhooks } = useLicense();
    expect(hasMail.value).toBe(false);
    expect(hasHostedWebhooks.value).toBe(false);
  });
});
