/**
 * The node grant. Every test here is an attack that must not work.
 *
 * AGNT has already paid once for a JWT mistake — a symmetric secret published
 * for 197 days, which was forced by a design where the verifier had to hold the
 * signing key. This module is symmetric too, and that is fine for a completely
 * different reason (issuer and verifier are the same process). Because the two
 * situations LOOK identical and are not, the properties that make this one safe
 * are pinned rather than assumed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';

import {
  CLUSTER_TOKEN_AUDIENCE,
  mintNodeToken,
  presentedToken,
  verifyNodeToken,
} from './clusterToken.js';
import { __resetSecretCacheForTests, resolveSecret } from '../../utils/secretResolver.js';

const USER = 'user-cluster-1';

beforeEach(() => {
  __resetSecretCacheForTests();
});

afterEach(() => {
  __resetSecretCacheForTests();
});

describe('mint / verify', () => {
  it('round-trips an identity the primary chose', () => {
    const { token, nodeId } = mintNodeToken({ userId: USER, label: 'hetzner-1' });

    expect(nodeId).toMatch(/^node_[0-9a-f]{24}$/);
    const grant = verifyNodeToken(token);
    expect(grant).toMatchObject({ nodeId, userId: USER, label: 'hetzner-1' });
  });

  it('mints a distinct id per node', () => {
    const a = mintNodeToken({ userId: USER });
    const b = mintNodeToken({ userId: USER });
    expect(a.nodeId).not.toBe(b.nodeId);
  });

  it('refuses to mint a grant with no owner', () => {
    // A grant with no userId would scope to nothing — or, worse, to everything
    // if a later query treated the null as "unfiltered".
    expect(() => mintNodeToken({})).toThrow(/userId/);
  });

  it('rejects junk without throwing', () => {
    for (const bad of [null, undefined, '', 'not-a-jwt', 'a.b.c', 42, {}]) {
      expect(verifyNodeToken(bad)).toBeNull();
    }
  });
});

describe('the attacks', () => {
  it('rejects alg:none', () => {
    // jsonwebtoken honours the token's own `alg` header unless an allowlist is
    // passed. Without one, this forgery verifies.
    const forged = jwt.sign(
      { nodeId: 'node_forged', userId: USER, aud: CLUSTER_TOKEN_AUDIENCE, iss: 'agnt-primary' },
      '',
      { algorithm: 'none' }
    );
    expect(verifyNodeToken(forged)).toBeNull();
  });

  it('rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign({ nodeId: 'node_x', userId: USER }, 'not-the-cluster-secret', {
      algorithm: 'HS256',
      audience: CLUSTER_TOKEN_AUDIENCE,
      issuer: 'agnt-primary',
    });
    expect(verifyNodeToken(forged)).toBeNull();
  });

  it('rejects a correctly-signed token for a different audience', () => {
    // This is the one that matters if CLUSTER_SECRET and JWT_SECRET ever get
    // merged by a well-meaning refactor: without an audience check, a stolen
    // user session token becomes a licence to claim work.
    const sameSecret = resolveSecret('CLUSTER_SECRET', { onPersistFailure: 'ephemeral' });
    const wrongAudience = jwt.sign({ nodeId: 'node_x', userId: USER }, sameSecret, {
      algorithm: 'HS256',
      audience: 'agnt-user-session',
      issuer: 'agnt-primary',
    });
    expect(verifyNodeToken(wrongAudience)).toBeNull();
  });

  it('rejects an expired grant', () => {
    const { token } = mintNodeToken({ userId: USER, ttlDays: -1 });
    expect(verifyNodeToken(token)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const { token } = mintNodeToken({ userId: USER });
    const [header, payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    decoded.userId = 'somebody-else';
    const swapped = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    expect(verifyNodeToken(`${header}.${swapped}.${signature}`)).toBeNull();
  });

  it('rejects a validly-signed grant that carries no identity', () => {
    const secret = resolveSecret('CLUSTER_SECRET', { onPersistFailure: 'ephemeral' });
    const empty = jwt.sign({}, secret, {
      algorithm: 'HS256',
      audience: CLUSTER_TOKEN_AUDIENCE,
      issuer: 'agnt-primary',
    });
    // Accepting this would produce claims owned by `undefined`.
    expect(verifyNodeToken(empty)).toBeNull();
  });
});

describe('CLUSTER_SECRET is its own key', () => {
  it('does not verify a token signed with JWT_SECRET', () => {
    // Reusing JWT_SECRET would mean a leak of either credential compromised
    // both — and JWT_SECRET is the one that has already been published once.
    process.env.JWT_SECRET = 'a-shared-user-token-secret';
    const crossSigned = jwt.sign({ nodeId: 'node_x', userId: USER }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      audience: CLUSTER_TOKEN_AUDIENCE,
      issuer: 'agnt-primary',
    });
    expect(verifyNodeToken(crossSigned)).toBeNull();
  });
});

describe('presentedToken', () => {
  it('reads a bearer token regardless of header casing', () => {
    expect(presentedToken({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(presentedToken({ headers: { authorization: 'bearer abc' } })).toBe('abc');
  });

  it('returns null for anything that is not a bearer scheme', () => {
    expect(presentedToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(presentedToken({ headers: {} })).toBeNull();
    expect(presentedToken({})).toBeNull();
    expect(presentedToken(null)).toBeNull();
  });
});
