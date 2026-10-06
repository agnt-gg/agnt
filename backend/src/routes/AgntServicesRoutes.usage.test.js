import { describe, it, expect, vi } from 'vitest';
import express from 'express';

/**
 * The Usage page's Text Annie card: texts, phone slots and media storage come
 * from mobile.agnt.gg itself (the numbers it enforces), and a service being
 * down never blanks the others. The services are fakes; the route is real.
 */
const replies = {
  models: { usedCredits: 10, includedCredits: 100 },
  search: { usedSearches: 1, includedSearches: 10 },
  sandbox: { hosting: { usedUnits: 2, includedUnits: 60 } },
  mail: { hosting: { usedUnits: 0, includedUnits: 10 } },
  webhooks: { hosting: { usedUnits: 0, includedUnits: 10 } },
  mobile: { available: 0, credit: 0, hosting: { planName: 'Business', period: '2026-10', usedUnits: 43, includedUnits: 5000, maxInboxes: 5, storedBytes: 2666308, storageBytes: 10737418240, allowOverage: false } },
};
let mobileDown = false;

vi.mock('./Middleware.js', () => ({ authenticateToken: (_req, _res, next) => next() }));
vi.mock('../models/WebhookModel.js', () => ({ default: {} }));
vi.mock('../services/agntMail.js', () => ({ defaultInbox: async () => null }));
vi.mock('../services/mailAddressing.js', () => ({ workflowAddress: () => null }));
vi.mock('../services/legacyRelay.js', () => ({ legacyWebhooks: async () => [] }));
vi.mock('../services/agntFlashAccount.js', () => ({ getFlashAccount: async () => ({}), startTopUp: async () => ({}) }));
vi.mock('../services/agntServices.js', () => ({
  SERVICES: { models: {}, search: {}, sandbox: {}, mail: {}, webhooks: {}, mobile: {} },
  serviceAllowed: async () => true,
  hostedInstanceSlug: () => null,
  serviceFailure: (error) => ({ error: error.message, message: error.message }),
  callService: async (name, route) => {
    if (name === 'mobile' && mobileDown) throw new Error('mobile down');
    if (route === '/usage') return replies[name];
    if (route === '/phones') return { phones: [{ state: 'active' }, { state: 'paused' }, { state: 'revoked' }] };
    if (route === '/inboxes') return { inboxes: [] };
    if (route === '/endpoints') return { endpoints: [] };
    throw new Error(`unexpected ${name} ${route}`);
  },
}));

const { default: AgntServicesRoutes } = await import('./AgntServicesRoutes.js');

async function getUsage() {
  const app = express().use('/api/agnt-services', AgntServicesRoutes);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/agnt-services/usage`);
    return res.json();
  } finally {
    server.close();
  }
}

describe('GET /agnt-services/usage — Text Annie', () => {
  it('reports texts, phone slots (paused still counts, unlinked does not) and media storage', async () => {
    mobileDown = false;
    const mobile = (await getUsage()).services.find((s) => s.service === 'mobile');
    expect(mobile).toMatchObject({ ok: true, plan: 'Business', period: '2026-10', allowOverage: false });
    expect(mobile.meters).toEqual([
      { key: 'texts', label: 'Texts', used: 43, included: 5000, unit: 'texts' },
      { key: 'phones', label: 'Phones', used: 2, included: 5, unit: 'phones' },
      { key: 'storage', label: 'Media storage', used: 2666308, included: 10737418240, unit: 'bytes' },
    ]);
  });

  it('mobile.agnt.gg being down marks only its card unavailable', async () => {
    mobileDown = true;
    const { services } = await getUsage();
    expect(services.find((s) => s.service === 'mobile')).toMatchObject({ ok: false, meters: [] });
    expect(services.filter((s) => s.ok).map((s) => s.service)).toEqual(['models', 'search', 'sandbox', 'mail', 'webhooks']);
  });
});
