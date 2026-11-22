import { describe, it, expect } from 'vitest';
import { PLAIN_SERVICES } from './plainWords.js';

describe('each metered service, explained', () => {
  it('names every service, says what it is, and what happens at its limit', () => {
    for (const key of ['models', 'search', 'sandbox', 'mail', 'webhooks', 'mobile']) {
      const s = PLAIN_SERVICES[key];
      expect(s.name, key).toBeTruthy();
      expect(s.what, key).toBeTruthy();
      expect(s.atLimit, key).toMatch(/^At the limit, /);
    }
    expect(PLAIN_SERVICES.sandbox.name).toBe('Sandbox');
  });
});
