/**
 * The nonce is the only credential guarding a session token here, because the
 * endpoints that use it cannot require a session — the user is in the middle
 * of getting one. So these tests are mostly about what the store REFUSES.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createHandoff,
  completeHandoff,
  claimHandoff,
  __resetHandoffsForTests,
  __pendingCountForTests,
  HANDOFF_TTL_MS,
  MAX_PENDING_HANDOFFS,
} from './desktopHandoffStore.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1LTEifQ.c2ln';

beforeEach(() => __resetHandoffsForTests());
afterEach(() => vi.useRealTimers());

describe('the happy path', () => {
  it('carries a token from the browser to the app', () => {
    const nonce = createHandoff();

    expect(claimHandoff(nonce)).toEqual({ status: 'pending' });
    expect(completeHandoff(nonce, TOKEN)).toBe(true);
    expect(claimHandoff(nonce)).toEqual({ status: 'ready', token: TOKEN });
  });

  it('distinguishes "not yet" from "gone"', () => {
    // A polling client has to tell these apart, or it stops on a sign-in that
    // is merely slow and spins forever on one that has expired.
    const nonce = createHandoff();
    expect(claimHandoff(nonce).status).toBe('pending');
    expect(claimHandoff('never-issued').status).toBe('unknown');
  });
});

describe('the nonce is treated as a credential', () => {
  it('is unguessable, and never repeats', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createHandoff()));
    // The cap evicts, but every value handed out must still be distinct.
    expect(nonces.size).toBe(200);
    for (const n of nonces) expect(n).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is single use', () => {
    const nonce = createHandoff();
    completeHandoff(nonce, TOKEN);

    expect(claimHandoff(nonce)).toEqual({ status: 'ready', token: TOKEN });
    // A second claim gets nothing — the token is not left lying around for
    // whatever else on this machine might come asking.
    expect(claimHandoff(nonce)).toEqual({ status: 'unknown' });
  });

  it('cannot be answered twice', () => {
    // Otherwise anything that learned the nonce could swap the token out
    // between delivery and claim, and the app would adopt the replacement.
    const nonce = createHandoff();

    expect(completeHandoff(nonce, TOKEN)).toBe(true);
    expect(completeHandoff(nonce, 'attacker-token')).toBe(false);
    expect(claimHandoff(nonce).token).toBe(TOKEN);
  });

  it('refuses a nonce it never issued', () => {
    expect(completeHandoff('a'.repeat(64), TOKEN)).toBe(false);
  });

  it('refuses non-string input without throwing', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(completeHandoff(bad, TOKEN)).toBe(false);
      expect(claimHandoff(bad)).toEqual({ status: 'unknown' });
    }
  });

  it('refuses an empty or non-string token', () => {
    const nonce = createHandoff();
    for (const bad of ['', null, undefined, 42, {}]) {
      expect(completeHandoff(nonce, bad)).toBe(false);
    }
    expect(claimHandoff(nonce).status).toBe('pending');
  });
});

describe('it cannot be made to grow or linger', () => {
  it('expires a sign-in that was never completed', () => {
    vi.useFakeTimers();
    const nonce = createHandoff();

    vi.advanceTimersByTime(HANDOFF_TTL_MS + 1);

    expect(claimHandoff(nonce)).toEqual({ status: 'unknown' });
  });

  it('expires a completed sign-in that was never claimed', () => {
    // A token sitting in memory for the life of the process is the thing to
    // avoid; the browser answered, but nobody came for it.
    vi.useFakeTimers();
    const nonce = createHandoff();
    completeHandoff(nonce, TOKEN);

    vi.advanceTimersByTime(HANDOFF_TTL_MS + 1);

    expect(claimHandoff(nonce)).toEqual({ status: 'unknown' });
  });

  it('is bounded however many sign-ins are started', () => {
    for (let i = 0; i < MAX_PENDING_HANDOFFS * 10; i += 1) createHandoff();
    expect(__pendingCountForTests()).toBeLessThanOrEqual(MAX_PENDING_HANDOFFS);
  });

  it('evicts the oldest, so the sign-in in progress survives', () => {
    const first = createHandoff();
    for (let i = 0; i < MAX_PENDING_HANDOFFS - 1; i += 1) createHandoff();
    const newest = createHandoff(); // pushes the cap, evicting `first`

    expect(claimHandoff(first).status).toBe('unknown');
    expect(claimHandoff(newest).status).toBe('pending');
  });

  it('sweeps expired entries rather than counting them against the cap', () => {
    vi.useFakeTimers();
    for (let i = 0; i < MAX_PENDING_HANDOFFS; i += 1) createHandoff();
    vi.advanceTimersByTime(HANDOFF_TTL_MS + 1);

    const fresh = createHandoff();

    expect(__pendingCountForTests()).toBe(1);
    expect(claimHandoff(fresh).status).toBe('pending');
  });
});
