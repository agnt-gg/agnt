import { describe, it, expect } from 'vitest';
import { isHostedWebhookUrl } from './webhookUrl.js';

describe('isHostedWebhookUrl', () => {
  it('accepts a hosted endpoint address', () => {
    expect(isHostedWebhookUrl('https://webhooks.agnt.gg/in/3cfifwj5azw6')).toBe(true);
  });

  it('rejects the legacy relay address, which nothing reads any more', () => {
    expect(isHostedWebhookUrl('https://api.agnt.gg/webhook/4f87fc18-9771-4329-9551-7ca0a4610872')).toBe(false);
  });

  it('rejects placeholders and junk', () => {
    for (const value of ['pending', '', null, undefined, 'https://webhooks.agnt.gg/in/', 'http://webhooks.agnt.gg/in/3cfifwj5azw6']) {
      expect(isHostedWebhookUrl(value)).toBe(false);
    }
  });
});
