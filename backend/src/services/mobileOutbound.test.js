import { describe, it, expect } from 'vitest';
import { textUser, hasLinkedPhone, textQueueReceipt } from './mobileOutbound.js';

/** mobile.agnt.gg is the fake here: every call it receives is recorded. */
function fakeService(handlers = {}) {
  const calls = [];
  const callService = async (service, route, options = {}) => {
    calls.push({ service, route, ...options });
    const handler = handlers[route];
    if (typeof handler === 'function') return handler(options);
    if (handler) return handler;
    return { id: 'out-1' };
  };
  return { calls, callService };
}

const refusal = (code) => () => { const error = new Error(code); error.code = code; throw error; };

describe('textUser', () => {
  it('sends to /outbound with the key, shaped like a reply: no code blocks or local paths', async () => {
    const { calls, callService } = fakeService();
    const result = await textUser({ text: 'Pricing research finished.\n```js\nx()\n```\nSee [report](file:///C:/r.md).', key: 'subchat-abc123' }, { callService });
    expect(result).toEqual({ sent: true, id: 'out-1', duplicate: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ service: 'mobile', route: '/outbound', method: 'POST', planGate: false });
    expect(calls[0].body.key).toBe('subchat-abc123');
    expect(calls[0].body.text).not.toContain('```');
    expect(calls[0].body.text).not.toContain('file:///');
    expect(calls[0].body.text).toContain('Pricing research finished.');
    expect(calls[0].body.media).toEqual([]);
  });

  it('a retried key the service already sent is reported as a duplicate, not a failure', async () => {
    const { callService } = fakeService({ '/outbound': { id: 'out-1', duplicate: true } });
    expect(await textUser({ text: 'x', key: 'subchat-abc123' }, { callService })).toEqual({ sent: true, id: 'out-1', duplicate: true });
  });

  it('maps the service\'s refusals to reasons and never throws', async () => {
    for (const [code, reason] of [['phone_not_found', 'no_phone'], ['monthly_allowance_exhausted', 'allowance_exhausted'], ['pro_required', 'not_subscribed'], ['rate_limited', 'rate_limited']]) {
      const { callService } = fakeService({ '/outbound': refusal(code) });
      expect(await textUser({ text: 'x', key: 'subchat-abc123' }, { callService })).toEqual({ sent: false, reason });
    }
  });

  it('refuses to send without an idempotency key', async () => {
    const { calls, callService } = fakeService();
    expect(await textUser({ text: 'x' }, { callService })).toEqual({ sent: false, reason: 'idempotency_key_required' });
    expect(calls).toEqual([]);
  });

  it('attaches generated images through /outbound/media', async () => {
    const { calls, callService } = fakeService({ '/outbound/media': { mediaId: 'med-1', uploadUrl: 'https://upload.example/x' } });
    const fetchImpl = async () => ({ status: 201 });
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'outbound-')), 'chart.png');
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await textUser({ text: 'Chart attached.', imageIds: ['img-1'], key: 'subchat-abc123' }, { callService, fetchImpl, resolveImage: async () => file });
    expect(result.sent).toBe(true);
    expect(calls.map((c) => c.route)).toEqual(['/outbound/media', '/outbound']);
    expect(calls[1].body.media).toEqual(['med-1']);
  });
});

describe('text delivery evidence', () => {
  it('reports queue acceptance, never phone delivery, even for duplicate entries', async () => {
    for (const duplicate of [false, true]) {
      const { callService } = fakeService({ '/outbound': { id: 'out-1', duplicate } });
      const result = await textUser({ text: 'test', key: 'diagnostic-test' }, { callService });
      expect(textQueueReceipt(result)).toEqual({
        success: true, id: 'out-1', queued: true, deliveryConfirmed: false, duplicate,
        message: 'Queued the text for delivery. This is not confirmation that the phone received it.',
      });
    }
  });

  it('does not report success for an empty or malformed gateway acknowledgement', async () => {
    for (const response of [null, {}, { id: '' }, { id: '  ' }, { id: 123 }]) {
      const { calls, callService } = fakeService({ '/outbound': () => response });
      const result = await textUser({ text: 'test', key: 'diagnostic-test' }, { callService });
      expect(result).toEqual({ sent: false, reason: 'queue_unconfirmed' });
      expect(textQueueReceipt(result)).toMatchObject({ success: false, deliveryConfirmed: false });
      expect(calls).toHaveLength(1); // No blind retry of an ambiguous send.
    }
    expect(textQueueReceipt({ sent: true })).toMatchObject({ success: false, deliveryConfirmed: false });
  });
});

describe('hasLinkedPhone', () => {
  it('is true only for an active phone, and false when the service cannot be reached', async () => {
    expect(await hasLinkedPhone({ callService: fakeService({ '/phones': { phones: [{ state: 'active' }] } }).callService })).toBe(true);
    expect(await hasLinkedPhone({ callService: fakeService({ '/phones': { phones: [{ state: 'paused' }, { state: 'pending' }] } }).callService })).toBe(false);
    expect(await hasLinkedPhone({ callService: fakeService({ '/phones': refusal('authentication_required') }).callService })).toBe(false);
  });
});
