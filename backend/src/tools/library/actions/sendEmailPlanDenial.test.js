/**
 * Send Email goes through the account's inbox on mail.agnt.gg. A free plan is
 * refused by the service (or, when gates are enforced, before the call), and
 * the tool reports that as `pro_required` with the upgrade message — never as
 * a generic network failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const callService = vi.fn();
vi.mock('../../../services/agntServices.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, callService: (...args) => callService(...args) };
});
vi.mock('../../../services/auth/sessionTokenCache.js', () => ({
  authHeader: () => ({ Authorization: 'Bearer test-session' }),
  getSessionToken: () => 'test-session',
}));

describe('send-email plan denial', () => {
  beforeEach(() => {
    callService.mockReset();
    vi.resetModules();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders a 402 from mail.agnt.gg as pro_required with the upgrade message', async () => {
    const { ServiceError } = await import('../../../services/agntServices.js');
    callService.mockImplementation(async (service, path) => {
      if (path === '/inboxes') return { inboxes: [{ id: 'inb-1', address: 'agent-1@mail.agnt.gg', state: 'active', created_at: 1 }] };
      throw new ServiceError('mail', 402, 'pro_required', { message: 'Your agent inbox is included with AGNT Pro. Upgrade at agnt.gg/pricing.' });
    });
    const { default: SendEmail } = await import('./send-email.js');
    const out = await new SendEmail().execute({ to: 'a@b.co', subject: 's', body: 'b' });
    const result = out.output ?? out;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/AGNT Pro/);
    expect(result.status).toBe(402);
  });

  it('sends from the default inbox and returns the delivery id', async () => {
    callService.mockImplementation(async (service, path, opts) => {
      if (path === '/inboxes') return { inboxes: [{ id: 'inb-1', address: 'agent-1@mail.agnt.gg', state: 'active', created_at: 1 }] };
      expect(path).toBe('/inboxes/inb-1/messages');
      expect(opts.body.to).toBe('a@b.co');
      return { id: 'dlv-1', state: 'queued' };
    });
    const { default: SendEmail } = await import('./send-email.js');
    const out = await new SendEmail().execute({ to: 'a@b.co', subject: 's', body: 'b' });
    const result = out.output ?? out;
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('dlv-1');
    expect(result.from).toBe('agent-1@mail.agnt.gg');
  });
});
