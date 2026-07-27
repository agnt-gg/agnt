import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  resolveSocketIdentity,
  isStrictSocketAuth,
  extractUserId,
  SocketAuthFailure,
  SocketIdentitySource,
} from './socketIdentity.js';

const SECRET = 'test-secret-do-not-use';
const LOCAL = { JWT_SECRET: SECRET, NODE_ENV: 'development' };
const HOSTED = { JWT_SECRET: SECRET, NODE_ENV: 'production', TRUST_REMOTE_AUTH: 'true' };

const localToken = (payload, opts) => jwt.sign(payload, SECRET, opts);
/** A token signed by someone else — i.e. what an attacker can always produce. */
const foreignToken = (payload) => jwt.sign(payload, 'a-different-secret');

describe('extractUserId', () => {
  it.each([
    ['id', { id: 'u1' }],
    ['userId', { userId: 'u1' }],
    ['user_id', { user_id: 'u1' }],
    ['sub', { sub: 'u1' }],
  ])('reads %s', (_label, payload) => {
    expect(extractUserId(payload)).toBe('u1');
  });

  it('prefers id over sub when both are present', () => {
    expect(extractUserId({ id: 'winner', sub: 'loser' })).toBe('winner');
  });

  it.each([[null], [undefined], ['string'], [{}], [{ id: '   ' }]])(
    'returns null for %p',
    (input) => expect(extractUserId(input)).toBeNull(),
  );
});

describe('isStrictSocketAuth', () => {
  it('is lenient for a plain local desktop install', () => {
    expect(isStrictSocketAuth({ NODE_ENV: 'development' })).toBe(false);
  });

  it('is strict in production', () => {
    expect(isStrictSocketAuth({ NODE_ENV: 'production' })).toBe(true);
  });

  it('is strict in hosted remote-auth mode', () => {
    expect(isStrictSocketAuth({ TRUST_REMOTE_AUTH: 'true' })).toBe(true);
  });

  it('honours an explicit opt-in override', () => {
    expect(isStrictSocketAuth({ NODE_ENV: 'development', SOCKET_AUTH_STRICT: 'true' })).toBe(true);
  });

  it('honours an explicit opt-out override even in production', () => {
    expect(isStrictSocketAuth({ NODE_ENV: 'production', SOCKET_AUTH_STRICT: 'false' })).toBe(false);
  });
});

describe('resolveSocketIdentity — the vulnerability that prompted this module', () => {
  it('REGRESSION: a bare userId claim can never impersonate in strict mode', () => {
    const result = resolveSocketIdentity({ userId: 'victim-user-id' }, HOSTED);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SocketAuthFailure.TOKEN_REQUIRED);
  });

  it('REGRESSION: a valid token for A cannot claim to be B', () => {
    const result = resolveSocketIdentity(
      { token: localToken({ id: 'attacker' }), userId: 'victim' },
      LOCAL,
    );
    expect(result.ok).toBe(true);
    expect(result.userId).toBe('attacker'); // token wins; the claim is ignored outright
  });

  it('REGRESSION: a forged token is rejected, never downgraded to the claim', () => {
    // The downgrade attack: send garbage token + victim id, hoping the
    // server falls back to legacy behaviour. It must not, in EITHER mode.
    for (const env of [LOCAL, { ...LOCAL, SOCKET_AUTH_STRICT: 'false' }]) {
      const result = resolveSocketIdentity({ token: foreignToken({ id: 'victim' }), userId: 'victim' }, env);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(SocketAuthFailure.INVALID_TOKEN);
    }
  });

  it('rejects a malformed token string', () => {
    const result = resolveSocketIdentity({ token: 'not-a-jwt' }, LOCAL);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SocketAuthFailure.INVALID_TOKEN);
  });
});

describe('resolveSocketIdentity — happy paths', () => {
  it('accepts a locally-signed token', () => {
    const result = resolveSocketIdentity({ token: localToken({ id: 'u1' }) }, LOCAL);
    expect(result).toMatchObject({ ok: true, userId: 'u1', source: SocketIdentitySource.TOKEN, verified: true });
  });

  it('accepts a remote-issued token in hosted mode via decode', () => {
    const remote = foreignToken({ sub: 'remote-user', email: 'a@b.c' });
    const result = resolveSocketIdentity({ token: remote }, HOSTED);
    expect(result).toMatchObject({ ok: true, userId: 'remote-user', verified: true });
  });

  it('does NOT decode unverifiable tokens outside hosted mode', () => {
    const result = resolveSocketIdentity({ token: foreignToken({ sub: 'remote-user' }) }, LOCAL);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SocketAuthFailure.INVALID_TOKEN);
  });

  it('still prefers local verification when hosted mode is on', () => {
    const result = resolveSocketIdentity({ token: localToken({ id: 'local-user' }) }, HOSTED);
    expect(result).toMatchObject({ ok: true, userId: 'local-user', verified: true });
  });
});

describe('resolveSocketIdentity — expiry', () => {
  it('rejects an expired locally-signed token', () => {
    const expired = localToken({ id: 'u1' }, { expiresIn: '-1h' });
    const result = resolveSocketIdentity({ token: expired }, LOCAL);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SocketAuthFailure.EXPIRED_TOKEN);
  });

  it('rejects an expired remote token in hosted mode (stronger than the HTTP path)', () => {
    const expired = foreignToken({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 60 });
    const result = resolveSocketIdentity({ token: expired }, HOSTED);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SocketAuthFailure.EXPIRED_TOKEN);
  });

  it('accepts an unexpired remote token in hosted mode', () => {
    const live = foreignToken({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(resolveSocketIdentity({ token: live }, HOSTED)).toMatchObject({ ok: true, userId: 'u1' });
  });

  it('never lets an expired local token fall through to decode in hosted mode', () => {
    const expired = localToken({ id: 'u1' }, { expiresIn: '-1h' });
    const result = resolveSocketIdentity({ token: expired }, HOSTED);
    expect(result.reason).toBe(SocketAuthFailure.EXPIRED_TOKEN);
  });
});

describe('resolveSocketIdentity — lenient legacy path', () => {
  it('accepts a bare claim on local desktop, flagged unverified', () => {
    const result = resolveSocketIdentity({ userId: 'u1' }, LOCAL);
    expect(result).toMatchObject({
      ok: true,
      userId: 'u1',
      source: SocketIdentitySource.UNVERIFIED_CLAIM,
      verified: false,
    });
  });

  it.each([['null'], ['undefined'], ['']])('treats the placeholder token %p as absent', (token) => {
    expect(resolveSocketIdentity({ token, userId: 'u1' }, LOCAL)).toMatchObject({ ok: true, userId: 'u1' });
    expect(resolveSocketIdentity({ token, userId: 'u1' }, HOSTED)).toMatchObject({
      ok: false,
      reason: SocketAuthFailure.TOKEN_REQUIRED,
    });
  });

  it.each([[{}], [null], [undefined], [{ userId: '  ' }]])('rejects empty payload %p', (payload) => {
    const result = resolveSocketIdentity(payload, LOCAL);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(SocketAuthFailure.NO_IDENTITY);
  });
});
