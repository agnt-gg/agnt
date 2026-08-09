/**
 * CONTRACT: a gateway grant opens one provider, one model, for a short time,
 * and stops existing the moment it is revoked.
 *
 * These are the properties the Browser Agent leans on when it hands a token to
 * a Python child process. If any one of them stops holding, a workflow node has
 * quietly been given a longer-lived or wider-reaching credential than the thing
 * it was minted for.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  mintGatewayToken,
  verifyGatewayToken,
  revokeGatewayToken,
  _resetGatewayTokens,
  _liveGatewayTokenCount,
} from './localGatewayTokens.js';

const grant = (overrides = {}) => mintGatewayToken({
  userId: 'user-1',
  provider: 'claude-code',
  model: 'claude-sonnet-5',
  label: 'test',
  ...overrides,
});

beforeEach(() => _resetGatewayTokens());
afterEach(() => vi.useRealTimers());

describe('gateway token grants', () => {
  it('binds the user, provider and model chosen at mint time', () => {
    const { token } = grant();
    expect(verifyGatewayToken(token)).toMatchObject({
      userId: 'user-1',
      provider: 'claude-code',
      model: 'claude-sonnet-5',
    });
  });

  it('mints unguessable, distinct tokens', () => {
    const a = grant().token;
    const b = grant().token;
    expect(a).not.toBe(b);
    // 32 random bytes, base64url — no padding, no separators.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects anything it did not mint', () => {
    grant();
    expect(verifyGatewayToken('not-a-real-token')).toBeNull();
    expect(verifyGatewayToken('')).toBeNull();
    expect(verifyGatewayToken(null)).toBeNull();
    expect(verifyGatewayToken(undefined)).toBeNull();
  });

  it('stops accepting a token the moment it is revoked', () => {
    const { token } = grant();
    expect(verifyGatewayToken(token)).not.toBeNull();

    expect(revokeGatewayToken(token)).toBe(true);
    expect(verifyGatewayToken(token)).toBeNull();
    // Revoking twice is what a `finally` block does after an early return.
    expect(revokeGatewayToken(token)).toBe(false);
  });

  it('expires on its own when nothing revokes it', () => {
    vi.useFakeTimers();
    const { token } = grant({ ttlMs: 1000 });

    vi.advanceTimersByTime(999);
    expect(verifyGatewayToken(token)).not.toBeNull();

    vi.advanceTimersByTime(2);
    expect(verifyGatewayToken(token)).toBeNull();
    expect(_liveGatewayTokenCount()).toBe(0);
  });

  it('clamps a caller that asks for an unreasonable lifetime', () => {
    vi.useFakeTimers();
    const { token, expiresAt } = grant({ ttlMs: 30 * 24 * 60 * 60 * 1000 });
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(verifyGatewayToken(token)).toBeNull();
  });

  it('refuses to mint a grant that is not fully bound', () => {
    expect(() => mintGatewayToken({ provider: 'openai', model: 'gpt-4.1' })).toThrow(/userId/);
    expect(() => mintGatewayToken({ userId: 'u', model: 'gpt-4.1' })).toThrow(/provider/);
    expect(() => mintGatewayToken({ userId: 'u', provider: 'openai' })).toThrow(/model/);
  });

  it('keeps grants isolated from each other', () => {
    const cheap = grant({ model: 'claude-haiku-5' });
    const dear = grant({ model: 'claude-opus-5' });

    revokeGatewayToken(cheap.token);

    expect(verifyGatewayToken(cheap.token)).toBeNull();
    expect(verifyGatewayToken(dear.token)).toMatchObject({ model: 'claude-opus-5' });
  });
});
