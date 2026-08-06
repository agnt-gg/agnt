import { describe, it, expect } from 'vitest';
import { applyEnvDefaults, ENV_DEFAULTS } from './envDefaults.js';

/**
 * The non-secret half of the deleted backend/.env.
 *
 * These values were never configuration in any meaningful sense — they never
 * varied per install — but ten call sites read them straight off process.env,
 * and a missing REMOTE_URL silently builds `undefined/webhook/<id>` rather
 * than failing anywhere near the cause.
 */

describe('applyEnvDefaults', () => {
  it('fills a value that is missing', () => {
    const env = {};
    applyEnvDefaults(env);

    expect(env.REMOTE_URL).toBe('https://api.agnt.gg');
    expect(env.FRONTEND_DEV_URL).toBe('http://localhost:5173');
    expect(env.FRONTEND_DIST_URL).toBe('http://localhost:4173');
  });

  it('never overrides a real environment variable', () => {
    // Docker -e, CI and a user's shell must keep working exactly as before.
    const env = { REMOTE_URL: 'https://staging.example.com' };
    applyEnvDefaults(env);

    expect(env.REMOTE_URL).toBe('https://staging.example.com');
  });

  it('treats an empty value as missing', () => {
    // `-e REMOTE_URL=` and a blank .env line both mean "unset", not "use ''".
    const env = { REMOTE_URL: '' };
    applyEnvDefaults(env);

    expect(env.REMOTE_URL).toBe('https://api.agnt.gg');
  });

  it('is idempotent', () => {
    const env = {};
    applyEnvDefaults(env);
    const first = { ...env };
    applyEnvDefaults(env);

    expect(env).toEqual(first);
  });

  it('touches nothing outside its own list', () => {
    const env = { UNRELATED: 'x' };
    applyEnvDefaults(env);

    expect(env.UNRELATED).toBe('x');
    expect(Object.keys(env).sort()).toEqual(['UNRELATED', ...Object.keys(ENV_DEFAULTS)].sort());
  });

  it('carries no secrets — that is the entire reason the file could be deleted', () => {
    // If a credential ever lands in this table it becomes a committed secret
    // again, which is the exact defect being closed.
    for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
      expect(key).not.toMatch(/SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL/i);
      expect(value).toMatch(/^https?:\/\//);
    }
  });
});
