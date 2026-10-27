import { describe, it, expect } from 'vitest';
import SchemaValidator from './SchemaValidator.js';

// Two plugins on a customer instance (tracerfy-api, erpnext-api) never loaded:
// their manifests say `authRequired: "apikey"` and the check was case-sensitive.
const authErrors = (authRequired) => new SchemaValidator()
  .validate({ title: 'T', category: 'action', type: 'probe', icon: 'x', description: 'd', authRequired, authProvider: 'probe', parameters: {}, outputs: {} })
  .errors.filter((error) => /authRequired/.test(error));

describe('authRequired', () => {
  it('accepts apiKey and oauth in any case', () => {
    for (const value of ['apiKey', 'apikey', 'APIKEY', 'oauth', 'OAuth']) expect(authErrors(value), value).toEqual([]);
  });
  it('still refuses anything else', () => {
    expect(authErrors('password')).toHaveLength(1);
  });
});
