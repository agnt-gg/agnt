import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * A hosted instance woken with nobody signed in presents its instance key.
 *
 * Measured on charlie 2026-09-27: woken by the fleet for a webhook and an
 * email, then "Sign in to AGNT to use webhooks/mail" every 10 s until someone
 * visited, because the only credential was a session token held in memory.
 */
import {
  getSessionToken, getSessionUserId, authHeader, rememberSessionToken, __resetSessionTokenCacheForTests,
} from './sessionTokenCache.js';

const KEY = 'agnt_ik_' + 'a'.repeat(64);
const ENV = ['AGNT_INSTANCE_KEY', 'AGNT_TENANT_OWNER', 'AGNT_TENANT_SLUG'];
const jwtFor = (id, expSeconds) => ['x', Buffer.from(JSON.stringify({ id, exp: expSeconds })).toString('base64url'), 'y'].join('.');

describe('sessionTokenCache falls back to the instance key', () => {
  const saved = {};
  beforeEach(() => { for (const k of ENV) saved[k] = process.env[k]; __resetSessionTokenCacheForTests(); });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  const hosted = () => Object.assign(process.env, { AGNT_INSTANCE_KEY: KEY, AGNT_TENANT_OWNER: 'owner-1', AGNT_TENANT_SLUG: 'charlie' });

  it('with nobody signed in, a hosted instance presents its key as its owner', () => {
    hosted();
    expect(getSessionToken()).toBe(KEY);
    expect(getSessionUserId()).toBe('owner-1');
    expect(authHeader()).toEqual({ Authorization: 'Bearer ' + KEY });
  });

  it('a live signed-in token still wins', () => {
    hosted();
    const token = jwtFor('owner-1', Math.floor(Date.now() / 1000) + 3600);
    rememberSessionToken(token, 'owner-1');
    expect(getSessionToken()).toBe(token);
    expect(getSessionUserId()).toBe('owner-1');
  });

  it('a second member poisons the session slot; the instance key still carries background work', () => {
    hosted();
    rememberSessionToken(jwtFor('owner-1', Math.floor(Date.now() / 1000) + 3600), 'owner-1');
    rememberSessionToken(jwtFor('member-2', Math.floor(Date.now() / 1000) + 3600), 'member-2');
    expect(getSessionToken()).toBe(KEY);
    expect(getSessionUserId()).toBe('owner-1');
  });

  it('a desktop (no tenant) never uses one, even if the variable leaks in', () => {
    process.env.AGNT_INSTANCE_KEY = KEY; process.env.AGNT_TENANT_OWNER = 'owner-1'; delete process.env.AGNT_TENANT_SLUG;
    expect(getSessionToken()).toBeNull();
    expect(authHeader()).toEqual({});
  });

  it('a malformed key is ignored rather than sent', () => {
    hosted(); process.env.AGNT_INSTANCE_KEY = 'agnt_sk_' + 'a'.repeat(64);
    expect(getSessionToken()).toBeNull();
  });
});
