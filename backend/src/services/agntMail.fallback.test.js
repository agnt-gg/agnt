import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Send Email falls back to the api.agnt.gg relay ONLY when mail.agnt.gg could
 * not be connected to. Any other failure may mean the message was accepted,
 * and a second send would deliver it twice.
 */
const legacySend = vi.fn(async () => ({ success: true, messageId: 'legacy-1' }));
vi.mock('./legacyRelay.js', () => ({ legacyMail: { send: (...a) => legacySend(...a) } }));
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({ Authorization: 'Bearer t' }), getSessionToken: () => 't' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: () => true, isEnforcing: () => false }));
const callService = vi.fn();
vi.mock('./agntServices.js', async (orig) => ({ ...(await orig()), callService: (...a) => callService(...a) }));

const { ServiceError, neverReached } = await import('./agntServices.js');
const { sendMail, resetInboxCache } = await import('./agntMail.js');

const unreachable = (causeCode, timedOut = false) => new ServiceError('mail', 0, 'unreachable', { causeCode, timedOut });

describe('sendMail fallback', () => {
  beforeEach(() => {
    legacySend.mockClear();
    callService.mockReset();
    resetInboxCache();
  });

  it('mail.agnt.gg refused the connection: sent once through the legacy relay', async () => {
    callService.mockRejectedValue(unreachable('ECONNREFUSED'));
    const result = await sendMail({ to: 'a@b.com', subject: 'S', text: 'T', workflowId: 'wf-1' });
    expect(legacySend).toHaveBeenCalledTimes(1);
    expect(legacySend).toHaveBeenCalledWith({ to: 'a@b.com', subject: 'S', text: 'T', html: undefined, workflowId: 'wf-1' });
    expect(result).toMatchObject({ via: 'legacy', id: 'legacy-1' });
  });

  it('a send that fails after the inbox was reached is not rerouted on a reset or timeout', async () => {
    for (const error of [unreachable('ECONNRESET'), unreachable(null, true), new ServiceError('mail', 502, 'http_502', {})]) {
      callService.mockReset();
      callService.mockResolvedValueOnce({ inboxes: [{ id: 'i', address: 'me@mail.agnt.gg', state: 'active' }] }).mockRejectedValueOnce(error);
      resetInboxCache();
      await expect(sendMail({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toBe(error);
    }
    expect(legacySend).not.toHaveBeenCalled();
  });

  it('a plan refusal is not rerouted', async () => {
    const refusal = new ServiceError('mail', 402, 'pro_required', {});
    callService.mockRejectedValue(refusal);
    await expect(sendMail({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toBe(refusal);
    expect(legacySend).not.toHaveBeenCalled();
  });

  it('a message with attachments is never rerouted (the relay cannot carry them)', async () => {
    callService.mockRejectedValue(unreachable('ENOTFOUND'));
    await expect(sendMail({ to: 'a@b.com', subject: 'S', text: 'T', attachments: [{ filename: 'f', content: 'eA==' }] })).rejects.toMatchObject({ code: 'unreachable' });
    expect(legacySend).not.toHaveBeenCalled();
  });

  it('if the relay also fails, the primary failure is what the caller sees', async () => {
    const primary = unreachable('ECONNREFUSED');
    callService.mockRejectedValue(primary);
    legacySend.mockRejectedValueOnce(new Error('legacy mail: retired'));
    await expect(sendMail({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toBe(primary);
  });
});

describe('neverReached', () => {
  it('is true only for connection-level failures that prove nothing was sent', () => {
    expect(neverReached(unreachable('ECONNREFUSED'))).toBe(true);
    expect(neverReached(unreachable('ENOTFOUND'))).toBe(true);
    expect(neverReached(unreachable('UND_ERR_CONNECT_TIMEOUT'))).toBe(true);
    expect(neverReached(unreachable('ECONNRESET'))).toBe(false);
    expect(neverReached(unreachable('ECONNREFUSED', true))).toBe(false);
    expect(neverReached(new ServiceError('mail', 502, 'http_502', {}))).toBe(false);
    expect(neverReached(new Error('plain'))).toBe(false);
  });
});
