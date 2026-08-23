/**
 * The OAuth callback's failure vocabulary.
 *
 * The assertion that matters most is the LAST one: no message this module can
 * produce may contain server internals. The endpoint used to answer
 * `SQLITE_CONSTRAINT: NOT NULL constraint failed: oauth_tokens.user_id`, the
 * client printed it verbatim, and that is what a user saw for a failure they
 * did not cause and could do nothing about.
 */
import { describe, it, expect } from 'vitest';

import {
  oauthCallbackError,
  oauthCallbackMessage,
  __REASON_COPY_FOR_TESTS,
} from './oauthCallbackErrors.js';

const SERVER_REASONS = [
  'invalid_request',
  'invalid_state',
  'provider_unknown',
  'exchange_failed',
  'storage_failed',
];

describe('every reason the server can send has copy', () => {
  it.each(SERVER_REASONS)('%s produces a specific message', (reason) => {
    const message = oauthCallbackMessage(reason, 'GitHub');
    expect(message).toBeTruthy();
    // Not the fallback — that would mean the reason is unhandled in practice
    // while looking handled in the table.
    expect(message).not.toContain('We could not complete the connection');
  });

  it.each(SERVER_REASONS)('%s tells the user what to do next', (reason) => {
    // A failure screen with no instruction leaves a dead window. Every message
    // must contain an imperative.
    const message = oauthCallbackMessage(reason, 'GitHub');
    expect(message.toLowerCase()).toMatch(/try|start|again|renamed|removed/);
  });

  it('the copy table covers exactly the documented reasons — no more, no less', () => {
    // Anti-drift: a reason added to the server without copy here silently
    // degrades to the fallback, and copy left here for a reason the server
    // stopped sending is dead weight nobody will ever delete.
    expect(new Set(Object.keys(__REASON_COPY_FOR_TESTS))).toEqual(new Set(SERVER_REASONS));
  });
});

describe('exchange_failed names the provider, because the refusal was theirs', () => {
  it('attributes the refusal to the named provider', () => {
    const message = oauthCallbackMessage('exchange_failed', 'GitHub');
    expect(message).toContain('GitHub');
    expect(message).toContain('declined the authorization');
    // The actionable half: this one is nearly always fixed by retrying.
    expect(message).toContain('try connecting again');
  });

  it('degrades to a neutral subject when the provider is unknown', () => {
    const message = oauthCallbackMessage('exchange_failed', null);
    expect(message).toMatch(/^The provider declined/);
    expect(message).not.toContain('null');
    expect(message).not.toContain('undefined');
  });
});

describe('an unknown reason falls back rather than inventing one', () => {
  it.each([null, undefined, '', 'something_new', 42])('%j yields the fallback', (reason) => {
    expect(oauthCallbackMessage(reason, 'GitHub')).toBe(
      'We could not complete the connection. Please try again from Settings.',
    );
  });
});

describe('oauthCallbackError', () => {
  it('carries the reason and status for callers that want to branch', () => {
    const error = oauthCallbackError({ error: 'Provider rejected the authorization', reason: 'exchange_failed' }, 'GitHub', 502);

    expect(error).toBeInstanceOf(Error);
    expect(error.reason).toBe('exchange_failed');
    expect(error.status).toBe(502);
    expect(error.message).toContain('GitHub');
  });

  it('survives a body that is absent or not JSON-shaped', () => {
    for (const body of [null, undefined, {}, 'a string', 0]) {
      const error = oauthCallbackError(body, 'GitHub', 500);
      expect(error.reason).toBeNull();
      expect(error.message).toBeTruthy();
    }
  });

  it('NEVER SURFACES THE SERVER MESSAGE, WHATEVER IT CONTAINS', () => {
    // The regression this file exists for. Even if the server regresses and
    // starts sending driver text again, this layer must not print it.
    const hostile = {
      error: 'SQLITE_CONSTRAINT: NOT NULL constraint failed: oauth_tokens.user_id',
      reason: 'storage_failed',
      stack: 'at AuthManager._saveTokens (/var/www/api.agnt.gg/src/oauth/AuthManager.js:298)',
    };

    const error = oauthCallbackError(hostile, 'GitHub', 500);

    for (const leak of ['SQLITE', 'oauth_tokens', 'user_id', 'NOT NULL', 'constraint', '/var/www', '.js:']) {
      expect(error.message, `the message disclosed "${leak}"`).not.toContain(leak);
    }
  });

  it('no message in the table leaks internals either', () => {
    // Belt and braces: the check above tests one hostile body, this tests the
    // whole vocabulary at once.
    const all = SERVER_REASONS.map((r) => oauthCallbackMessage(r, 'GitHub')).join(' ');
    for (const leak of ['SQLITE', 'oauth_tokens', 'undefined', 'null', 'Error:']) {
      expect(all).not.toContain(leak);
    }
  });
});
